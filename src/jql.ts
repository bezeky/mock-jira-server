/**
 * Pure-TypeScript JQL evaluation for the mock Jira Server API.
 *
 * This module implements a small, best-effort subset of JQL used by the
 * mock server. It operates directly over the full stored issue dicts
 * (reading issue.fields[...]) and NEVER throws on malformed input: on any
 * parse/eval error it degrades gracefully and returns a best-effort
 * filtered + sorted list.
 *
 * Supported clauses (case-insensitive on field names and unquoted values;
 * string values may be single- or double-quoted):
 *
 *     project = X            (matches issue project key OR name)
 *     status = X / status != X
 *     assignee = X           (username)
 *     assignee = currentUser()
 *     assignee is EMPTY
 *     issuetype = X
 *     priority = X
 *     summary ~ "X"          (substring, case-insensitive)
 *     text ~ "X"             (substring over summary + description)
 *     key = X                (exact issue key, case-insensitive)
 *
 * Predicates combine with AND / OR. OR has the lowest precedence: the
 * condition is split into OR groups, each group is split into AND
 * predicates, and an issue matches if ANY group fully matches. Unrecognized
 * or unparseable clauses are ignored (treated as no-ops within their AND
 * group).
 *
 * ORDER BY created|updated|key with ASC|DESC (default ASC) is applied last.
 */

// Operators recognized inside a single predicate, longest first so that
// "!=" is matched before "=".
// \w and \b are Unicode-aware in Python's re, so the field-name classes and
// the ORDER BY word boundaries are spelled out with Unicode property escapes.
const OP_RE = /^([A-Za-z_][\p{L}\p{N}_]*)\s*(!=|~|=)\s*([\s\S]+)$/u;
const EMPTY_RE = /^([A-Za-z_][\p{L}\p{N}_]*)\s+is\s+(not\s+)?empty\s*$/iu;
const ORDER_BY_RE = /(?<![\p{L}\p{N}_])order\s+by(?![\p{L}\p{N}_])/iu;

type Predicate = [string, string, string | null];

/**
 * Filter and sort `allIssues` according to `jql`.
 *
 * Returns a best-effort list; never throws.
 */
export function executeJql(
  jql: string,
  allIssues: any[],
  currentUsername: string
): any[] {
  const issues = allIssues ? [...allIssues] : [];
  try {
    if (!jql || !String(jql).trim()) {
      return issues;
    }

    const [conditionsText, orderField, orderDir] = splitOrderBy(String(jql));

    const groups = parseConditions(conditionsText);
    let result: any[];
    if (groups.length) {
      result = issues.filter((issue) =>
        matchesAnyGroup(issue, groups, currentUsername)
      );
    } else {
      result = issues;
    }

    if (orderField) {
      result = sortIssues(result, orderField, orderDir);
    }

    return result;
  } catch {
    // Absolute safety net: never throw on malformed JQL.
    return issues;
  }
}

// ---------------------------------------------------------------------------
// ORDER BY handling
// ---------------------------------------------------------------------------

/** Split the raw JQL into [conditionsText, orderField, orderDir]. */
function splitOrderBy(jql: string): [string, string | null, string] {
  const m = ORDER_BY_RE.exec(jql);
  let conditionsText: string;
  let orderPartRaw: string | null = null;
  if (m) {
    conditionsText = jql.slice(0, m.index);
    orderPartRaw = jql.slice(m.index + m[0].length);
  } else {
    conditionsText = jql;
  }

  let orderField: string | null = null;
  let orderDir = "ASC";

  if (orderPartRaw !== null) {
    const orderPart = orderPartRaw.trim();
    if (orderPart) {
      // Only the first ORDER BY field is honoured.
      const first = orderPart.split(",")[0].trim();
      const tokens = first.split(/\s+/).filter((t) => t.length > 0);
      if (tokens.length) {
        const candidate = stripChar(stripChar(tokens[0].trim(), '"'), "'").toLowerCase();
        if (candidate === "created" || candidate === "updated" || candidate === "key") {
          orderField = candidate;
        }
        if (tokens.length > 1 && tokens[1].toUpperCase() === "DESC") {
          orderDir = "DESC";
        }
      }
    }
  }

  return [conditionsText, orderField, orderDir];
}

/** Strip all leading/trailing occurrences of a single character. */
function stripChar(s: string, ch: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === ch) start++;
  while (end > start && s[end - 1] === ch) end--;
  return s.slice(start, end);
}

function sortIssues(issues: any[], field: string, direction: string): any[] {
  const reverse = direction === "DESC";

  let cmp: (a: any, b: any) => number;
  if (field === "key") {
    cmp = (a, b) => compareNaturalKeys(naturalKey(a.key || ""), naturalKey(b.key || ""));
  } else {
    // created / updated
    const keyOf = (issue: any): string => {
      const fields = issue.fields || {};
      return fields[field] || "";
    };
    cmp = (a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    };
  }

  try {
    const sorted = [...issues].sort((a, b) => (reverse ? -cmp(a, b) : cmp(a, b)));
    return sorted;
  } catch {
    return issues;
  }
}

type NaturalChunk = [number, number, string];

/** Human/natural sort key so APIRE-2 sorts before APIRE-10. */
function naturalKey(key: string): NaturalChunk[] {
  const chunks = (key || "").split(/(\d+)/);
  return chunks.map((chunk): NaturalChunk => {
    if (/^\d+$/.test(chunk)) {
      return [1, parseInt(chunk, 10), ""];
    }
    return [0, 0, chunk.toLowerCase()];
  });
}

function compareNaturalKeys(a: NaturalChunk[], b: NaturalChunk[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const [t1, n1, s1] = a[i];
    const [t2, n2, s2] = b[i];
    if (t1 !== t2) return t1 - t2;
    if (n1 !== n2) return n1 - n2;
    if (s1 !== s2) return s1 < s2 ? -1 : 1;
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Condition parsing
// ---------------------------------------------------------------------------

/** Return a list of OR-groups, each a list of AND predicate strings. */
function parseConditions(text: string): string[][] {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return [];
  }

  const groups: string[][] = [];
  for (const orPart of splitKeyword(trimmed, "OR")) {
    const preds = splitKeyword(orPart, "AND")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    groups.push(preds);
  }
  return groups;
}

/** Split `text` on a whole-word keyword, ignoring quoted regions. */
function splitKeyword(text: string, keyword: string): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  let quote: string | null = null;
  const kw = keyword.toLowerCase();
  const klen = keyword.length;
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i];

    if (quote !== null) {
      current.push(ch);
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current.push(ch);
      i += 1;
      continue;
    }

    if (text.slice(i, i + klen).toLowerCase() === kw) {
      const before = i > 0 ? text[i - 1] : " ";
      const after = i + klen < n ? text[i + klen] : " ";
      if (!isWordChar(before) && !isWordChar(after)) {
        parts.push(current.join(""));
        current = [];
        i += klen;
        continue;
      }
    }

    current.push(ch);
    i += 1;
  }

  parts.push(current.join(""));
  return parts;
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Parse a single predicate string into [field, op, value].
 *
 * op is one of: "=", "!=", "~", "empty", "empty_not".
 * For empty ops, value is null. Returns null if unparseable.
 */
function parsePredicate(pred: string): Predicate | null {
  const trimmed = (pred || "").trim();
  if (!trimmed) {
    return null;
  }

  let m = EMPTY_RE.exec(trimmed);
  if (m) {
    const field = m[1].toLowerCase();
    const negated = Boolean(m[2]);
    return [field, negated ? "empty_not" : "empty", null];
  }

  m = OP_RE.exec(trimmed);
  if (m) {
    const field = m[1].toLowerCase();
    const op = m[2];
    const value = unquote(m[3].trim());
    return [field, op, value];
  }

  return null;
}

function unquote(value: string): string {
  const v = (value || "").trim();
  if (v.length >= 2 && (v[0] === "'" || v[0] === '"') && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchesAnyGroup(issue: any, groups: string[][], currentUsername: string): boolean {
  return groups.some((group) => matchesGroup(issue, group, currentUsername));
}

function matchesGroup(issue: any, group: string[], currentUsername: string): boolean {
  for (const predStr of group) {
    const pred = parsePredicate(predStr);
    if (pred === null) {
      // Ignore unrecognized / unparseable clauses.
      continue;
    }
    try {
      if (!matchPredicate(issue, pred, currentUsername)) {
        return false;
      }
    } catch {
      // Defensive: a broken predicate is ignored, not fatal.
      continue;
    }
  }
  return true;
}

function matchPredicate(issue: any, pred: Predicate, currentUsername: string): boolean {
  const [field, op] = pred;
  const fields = issue.fields || {};

  if (op === "empty" || op === "empty_not") {
    const empty = fieldIsEmpty(fields, field);
    return op === "empty" ? empty : !empty;
  }

  const value = pred[2] !== null && pred[2] !== undefined ? pred[2] : "";

  if (field === "project") {
    const proj = fields.project || {};
    return eqMatch([proj.key, proj.name], value, op);
  }

  if (field === "status") {
    const st = fields.status || {};
    return eqMatch([st.name], value, op);
  }

  if (field === "issuetype" || field === "type") {
    const it = fields.issuetype || {};
    return eqMatch([it.name], value, op);
  }

  if (field === "priority") {
    const pr = fields.priority || {};
    return eqMatch([pr.name], value, op);
  }

  if (field === "assignee") {
    const assignee = fields.assignee;
    const name = isPlainObject(assignee) ? assignee.name : null;
    return eqMatch([name], resolveUserValue(value, currentUsername), op);
  }

  if (field === "reporter") {
    const reporter = fields.reporter;
    const name = isPlainObject(reporter) ? reporter.name : null;
    return eqMatch([name], resolveUserValue(value, currentUsername), op);
  }

  if (field === "creator") {
    const creator = fields.creator;
    const name = isPlainObject(creator) ? creator.name : null;
    return eqMatch([name], resolveUserValue(value, currentUsername), op);
  }

  if (field === "key") {
    return eqMatch([issue.key], value, op);
  }

  if (field === "summary") {
    const summary = fields.summary || "";
    if (op === "~") {
      return summary.toLowerCase().includes(value.toLowerCase());
    }
    return eqMatch([summary], value, op);
  }

  if (field === "description") {
    const desc = fields.description || "";
    if (op === "~") {
      return desc.toLowerCase().includes(value.toLowerCase());
    }
    return eqMatch([desc], value, op);
  }

  if (field === "text") {
    const summary = fields.summary || "";
    const desc = fields.description || "";
    const blob = (summary + " " + desc).toLowerCase();
    return blob.includes(value.toLowerCase());
  }

  if (field === "labels") {
    const labels: any[] = fields.labels || [];
    const labelsLower = labels.map((lbl) => String(lbl).toLowerCase());
    const matched = labelsLower.includes(value.toLowerCase());
    return op === "!=" ? !matched : matched;
  }

  // Unrecognized field: ignore (no-op within its AND group).
  return true;
}

function isPlainObject(v: any): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function resolveUserValue(value: string, currentUsername: string): string {
  if (value && value.trim().toLowerCase().split(" ").join("") === "currentuser()") {
    return currentUsername || "";
  }
  return value;
}

/** Equality (or negated equality) against a set of candidate strings. */
function eqMatch(candidates: any[], value: string, op: string): boolean {
  const v = (value || "").trim().toLowerCase();
  const cand = candidates.filter((c) => c).map((c) => String(c).toLowerCase());
  const matched = cand.includes(v);
  return op === "!=" ? !matched : matched;
}

function fieldIsEmpty(fields: any, field: string): boolean {
  if (field === "assignee") {
    return fields.assignee == null;
  }
  if (field === "reporter") {
    return fields.reporter == null;
  }
  if (field === "creator") {
    return fields.creator == null;
  }
  // Own properties only: a bare lookup would resolve names like "constructor"
  // off Object.prototype, where a Python dict .get() yields None.
  const value = Object.hasOwn(fields, field) ? fields[field] : undefined;
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  );
}
