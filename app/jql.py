"""Pure-Python JQL evaluation for the mock Jira Server API.

This module implements a small, best-effort subset of JQL used by the
mock server. It operates directly over the full stored issue dicts
(reading ``issue["fields"][...]``) and NEVER raises on malformed input:
on any parse/eval error it degrades gracefully and returns a best-effort
filtered + sorted list.

Supported clauses (case-insensitive on field names and unquoted values;
string values may be single- or double-quoted):

    project = X            (matches issue project key OR name)
    status = X / status != X
    assignee = X           (username)
    assignee = currentUser()
    assignee is EMPTY
    issuetype = X
    priority = X
    summary ~ "X"          (substring, case-insensitive)
    text ~ "X"             (substring over summary + description)
    key = X                (exact issue key, case-insensitive)

Predicates combine with AND / OR. OR has the lowest precedence: the
condition is split into OR groups, each group is split into AND
predicates, and an issue matches if ANY group fully matches. Unrecognized
or unparseable clauses are ignored (treated as no-ops within their AND
group).

ORDER BY created|updated|key with ASC|DESC (default ASC) is applied last.
Only the stdlib is used.
"""

from __future__ import annotations

import re

# Operators recognized inside a single predicate, longest first so that
# "!=" is matched before "=".
_OP_RE = re.compile(r"^([A-Za-z_][\w]*)\s*(!=|~|=)\s*(.+)$", re.IGNORECASE | re.DOTALL)
_EMPTY_RE = re.compile(r"^([A-Za-z_][\w]*)\s+is\s+(not\s+)?empty\s*$", re.IGNORECASE)
_ORDER_BY_RE = re.compile(r"\border\s+by\b", re.IGNORECASE)


def execute_jql(jql: str, all_issues: list, current_username: str) -> list:
    """Filter and sort ``all_issues`` according to ``jql``.

    Returns a best-effort list; never raises.
    """
    issues = list(all_issues) if all_issues else []
    try:
        if not jql or not str(jql).strip():
            return issues

        conditions_text, order_field, order_dir = _split_order_by(str(jql))

        groups = _parse_conditions(conditions_text)
        if groups:
            result = [
                issue
                for issue in issues
                if _matches_any_group(issue, groups, current_username)
            ]
        else:
            result = issues

        if order_field:
            result = _sort_issues(result, order_field, order_dir)

        return result
    except Exception:
        # Absolute safety net: never raise on malformed JQL.
        return issues


# --------------------------------------------------------------------------
# ORDER BY handling
# --------------------------------------------------------------------------

def _split_order_by(jql: str):
    """Split the raw JQL into (conditions_text, order_field, order_dir)."""
    parts = _ORDER_BY_RE.split(jql, maxsplit=1)
    conditions_text = parts[0]
    order_field = None
    order_dir = "ASC"

    if len(parts) > 1:
        order_part = parts[1].strip()
        if order_part:
            # Only the first ORDER BY field is honoured.
            first = order_part.split(",")[0].strip()
            tokens = first.split()
            if tokens:
                candidate = tokens[0].strip().strip('"').strip("'").lower()
                if candidate in ("created", "updated", "key"):
                    order_field = candidate
                if len(tokens) > 1 and tokens[1].upper() == "DESC":
                    order_dir = "DESC"

    return conditions_text, order_field, order_dir


def _sort_issues(issues: list, field: str, direction: str) -> list:
    reverse = direction == "DESC"

    if field == "key":
        def key_fn(issue):
            return _natural_key(issue.get("key") or "")
    else:  # created / updated
        def key_fn(issue):
            fields = issue.get("fields") or {}
            return fields.get(field) or ""

    try:
        return sorted(issues, key=key_fn, reverse=reverse)
    except Exception:
        return issues


def _natural_key(key: str):
    """Human/natural sort key so APIRE-2 sorts before APIRE-10."""
    chunks = re.split(r"(\d+)", key or "")
    parsed = []
    for chunk in chunks:
        if chunk.isdigit():
            parsed.append((1, int(chunk), ""))
        else:
            parsed.append((0, 0, chunk.lower()))
    return parsed


# --------------------------------------------------------------------------
# Condition parsing
# --------------------------------------------------------------------------

def _parse_conditions(text: str) -> list:
    """Return a list of OR-groups, each a list of AND predicate strings."""
    text = (text or "").strip()
    if not text:
        return []

    groups = []
    for or_part in _split_keyword(text, "OR"):
        preds = [p.strip() for p in _split_keyword(or_part, "AND") if p.strip()]
        groups.append(preds)
    return groups


def _split_keyword(text: str, keyword: str) -> list:
    """Split ``text`` on a whole-word keyword, ignoring quoted regions."""
    parts = []
    current = []
    quote = None
    kw = keyword.lower()
    klen = len(keyword)
    n = len(text)
    i = 0

    while i < n:
        ch = text[i]

        if quote is not None:
            current.append(ch)
            if ch == quote:
                quote = None
            i += 1
            continue

        if ch in ("'", '"'):
            quote = ch
            current.append(ch)
            i += 1
            continue

        if text[i:i + klen].lower() == kw:
            before = text[i - 1] if i > 0 else " "
            after = text[i + klen] if i + klen < n else " "
            if not _is_word_char(before) and not _is_word_char(after):
                parts.append("".join(current))
                current = []
                i += klen
                continue

        current.append(ch)
        i += 1

    parts.append("".join(current))
    return parts


def _is_word_char(ch: str) -> bool:
    return ch.isalnum() or ch == "_"


def _parse_predicate(pred: str):
    """Parse a single predicate string into (field, op, value).

    op is one of: "=", "!=", "~", "empty", "empty_not".
    For empty ops, value is None. Returns None if unparseable.
    """
    pred = (pred or "").strip()
    if not pred:
        return None

    m = _EMPTY_RE.match(pred)
    if m:
        field = m.group(1).lower()
        negated = bool(m.group(2))
        return (field, "empty_not" if negated else "empty", None)

    m = _OP_RE.match(pred)
    if m:
        field = m.group(1).lower()
        op = m.group(2)
        value = _unquote(m.group(3).strip())
        return (field, op, value)

    return None


def _unquote(value: str) -> str:
    value = (value or "").strip()
    if len(value) >= 2 and value[0] in ("'", '"') and value[-1] == value[0]:
        return value[1:-1]
    return value


# --------------------------------------------------------------------------
# Matching
# --------------------------------------------------------------------------

def _matches_any_group(issue, groups, current_username) -> bool:
    return any(_matches_group(issue, group, current_username) for group in groups)


def _matches_group(issue, group, current_username) -> bool:
    for pred_str in group:
        pred = _parse_predicate(pred_str)
        if pred is None:
            # Ignore unrecognized / unparseable clauses.
            continue
        try:
            if not _match_predicate(issue, pred, current_username):
                return False
        except Exception:
            # Defensive: a broken predicate is ignored, not fatal.
            continue
    return True


def _match_predicate(issue, pred, current_username) -> bool:
    field, op, value = pred
    fields = issue.get("fields") or {}

    if op in ("empty", "empty_not"):
        empty = _field_is_empty(fields, field)
        return empty if op == "empty" else (not empty)

    value = value if value is not None else ""

    if field == "project":
        proj = fields.get("project") or {}
        return _eq_match([proj.get("key"), proj.get("name")], value, op)

    if field == "status":
        st = fields.get("status") or {}
        return _eq_match([st.get("name")], value, op)

    if field in ("issuetype", "type"):
        it = fields.get("issuetype") or {}
        return _eq_match([it.get("name")], value, op)

    if field == "priority":
        pr = fields.get("priority") or {}
        return _eq_match([pr.get("name")], value, op)

    if field == "assignee":
        assignee = fields.get("assignee")
        name = assignee.get("name") if isinstance(assignee, dict) else None
        return _eq_match([name], _resolve_user_value(value, current_username), op)

    if field == "reporter":
        reporter = fields.get("reporter")
        name = reporter.get("name") if isinstance(reporter, dict) else None
        return _eq_match([name], _resolve_user_value(value, current_username), op)

    if field == "creator":
        creator = fields.get("creator")
        name = creator.get("name") if isinstance(creator, dict) else None
        return _eq_match([name], _resolve_user_value(value, current_username), op)

    if field == "key":
        return _eq_match([issue.get("key")], value, op)

    if field == "summary":
        summary = fields.get("summary") or ""
        if op == "~":
            return value.lower() in summary.lower()
        return _eq_match([summary], value, op)

    if field == "description":
        desc = fields.get("description") or ""
        if op == "~":
            return value.lower() in desc.lower()
        return _eq_match([desc], value, op)

    if field == "text":
        summary = fields.get("summary") or ""
        desc = fields.get("description") or ""
        blob = (summary + " " + desc).lower()
        return value.lower() in blob

    if field == "labels":
        labels = fields.get("labels") or []
        labels_lower = [str(lbl).lower() for lbl in labels]
        matched = value.lower() in labels_lower
        return (not matched) if op == "!=" else matched

    # Unrecognized field: ignore (no-op within its AND group).
    return True


def _resolve_user_value(value: str, current_username: str) -> str:
    if value and value.strip().lower().replace(" ", "") == "currentuser()":
        return current_username or ""
    return value


def _eq_match(candidates, value, op) -> bool:
    """Equality (or negated equality) against a set of candidate strings."""
    v = (value or "").strip().lower()
    cand = [str(c).lower() for c in candidates if c]
    matched = v in cand
    return (not matched) if op == "!=" else matched


def _field_is_empty(fields, field) -> bool:
    if field == "assignee":
        return fields.get("assignee") is None
    if field == "reporter":
        return fields.get("reporter") is None
    if field == "creator":
        return fields.get("creator") is None
    value = fields.get(field)
    return value is None or value == "" or value == [] or value == {}
