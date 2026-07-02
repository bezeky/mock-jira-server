"""JSON shape builders for the Mock Jira Server (Server / Data Center flavor).

Every function here produces Server-style JSON. User objects use "name" and
"key" (username strings) and NEVER emit "accountId", "accountType", or
"locale" (those are Jira Cloud only). Self-links derive from base().

Imports are intentionally minimal to avoid import cycles: this module must not
import app.store.
"""

from datetime import datetime, timezone
from typing import Optional

from app.config import settings

# ---------------------------------------------------------------------------
# Data tables (module constants)
# ---------------------------------------------------------------------------

# name -> {"id": str, "category": {"id": int, "key": str, "colorName": str, "name": str}}
STATUS_DEFS: dict = {
    "To Do": {
        "id": "1",
        "category": {"id": 2, "key": "new", "colorName": "blue-gray", "name": "To Do"},
    },
    "In Progress": {
        "id": "3",
        "category": {"id": 4, "key": "indeterminate", "colorName": "yellow", "name": "In Progress"},
    },
    "In Review": {
        "id": "4",
        "category": {"id": 4, "key": "indeterminate", "colorName": "yellow", "name": "In Progress"},
    },
    "Done": {
        "id": "5",
        "category": {"id": 3, "key": "done", "colorName": "green", "name": "Done"},
    },
    "Closed": {
        "id": "6",
        "category": {"id": 3, "key": "done", "colorName": "green", "name": "Done"},
    },
}

# (id, name, statusColor)
PRIORITY_DEFS: list = [
    ("1", "Highest", "ff0000"),
    ("2", "High", "ff7700"),
    ("3", "Medium", "ffaa00"),
    ("4", "Low", "2aaee6"),
    ("5", "Lowest", "57d9a3"),
]

# (id, name)
ISSUETYPE_DEFS: list = [
    ("10001", "Task"),
    ("10002", "Bug"),
    ("10003", "Story"),
]

# (id, name, to_status)
TRANSITION_DEFS: list = [
    ("11", "To Do", "To Do"),
    ("21", "In Progress", "In Progress"),
    ("31", "In Review", "In Review"),
    ("41", "Done", "Done"),
]

# Field metadata for GET /field: (id, name, schema)
_FIELD_DEFS: list = [
    ("summary", "Summary", {"type": "string"}),
    ("description", "Description", {"type": "string"}),
    ("status", "Status", {"type": "status"}),
    ("priority", "Priority", {"type": "priority"}),
    ("issuetype", "Issue Type", {"type": "issuetype"}),
    ("project", "Project", {"type": "project"}),
    ("assignee", "Assignee", {"type": "user"}),
    ("reporter", "Reporter", {"type": "user"}),
    ("creator", "Creator", {"type": "user"}),
    ("created", "Created", {"type": "datetime"}),
    ("updated", "Updated", {"type": "datetime"}),
    ("labels", "Labels", {"type": "array", "items": "string"}),
    ("resolution", "Resolution", {"type": "resolution"}),
    ("comment", "Comment", {"type": "array", "items": "comment"}),
    ("duedate", "Due Date", {"type": "date"}),
]


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def base() -> str:
    return settings.BASE_URL.rstrip("/")


def now_jira() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+0000"


def avatar_urls() -> dict:
    return {"48x48": "", "24x24": "", "16x16": "", "32x32": ""}


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

def user_shape(u: Optional[dict]) -> Optional[dict]:
    """Server-style user object.

    ``u`` may be a full stored-user dict or a minimal
    {"name","key","displayName","emailAddress","active"}. Returns None for
    None input. NEVER emits accountId/accountType/locale.
    """
    if u is None:
        return None
    name = u.get("name")
    key = u.get("key") or name
    return {
        "self": base() + "/rest/api/2/user?username=" + (name or ""),
        "name": name,
        "key": key,
        "emailAddress": u.get("emailAddress", ""),
        "displayName": u.get("displayName") or name,
        "active": u.get("active", True),
        "avatarUrls": avatar_urls(),
    }


# ---------------------------------------------------------------------------
# Status / Priority / Issue type
# ---------------------------------------------------------------------------

def status_shape(name: str) -> dict:
    d = STATUS_DEFS.get(name) or STATUS_DEFS["To Do"]
    sid = d["id"]
    cat = d["category"]
    return {
        "id": sid,
        "name": name if name in STATUS_DEFS else "To Do",
        "self": base() + "/rest/api/2/status/" + sid,
        "description": "",
        "iconUrl": base() + "/",
        "statusCategory": {
            "id": cat["id"],
            "key": cat["key"],
            "colorName": cat["colorName"],
            "name": cat["name"],
            "self": base() + "/rest/api/2/statuscategory/" + str(cat["id"]),
        },
    }


def priority_shape(name: str) -> dict:
    pid = "3"
    pname = "Medium"
    for (_id, _name, _color) in PRIORITY_DEFS:
        if _name == name:
            pid, pname = _id, _name
            break
    return {
        "id": pid,
        "name": pname,
        "self": base() + "/rest/api/2/priority/" + pid,
        "iconUrl": "",
    }


def issuetype_shape(name: str) -> dict:
    iid = "10001"
    iname = "Task"
    for (_id, _name) in ISSUETYPE_DEFS:
        if _name == name:
            iid, iname = _id, _name
            break
    return {
        "id": iid,
        "name": iname,
        "self": base() + "/rest/api/2/issuetype/" + iid,
        "description": "",
        "iconUrl": "",
        "subtask": False,
    }


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

def project_ref(project: dict) -> dict:
    pid = str(project.get("id"))
    return {
        "id": pid,
        "key": project.get("key"),
        "name": project.get("name"),
        "self": base() + "/rest/api/2/project/" + pid,
        "projectTypeKey": project.get("projectTypeKey", "software"),
    }


def project_shape(project: dict) -> dict:
    pid = str(project.get("id"))
    lead = project.get("lead")
    if isinstance(lead, str):
        lead_user = user_shape({"name": lead, "key": lead, "displayName": lead})
    elif isinstance(lead, dict):
        lead_user = user_shape(lead)
    else:
        lead_user = None
    return {
        "id": pid,
        "key": project.get("key"),
        "name": project.get("name"),
        "self": base() + "/rest/api/2/project/" + pid,
        "projectTypeKey": project.get("projectTypeKey", "software"),
        "lead": lead_user,
        "description": project.get("description", ""),
        "components": [],
        "versions": [],
        "issueTypes": [issuetype_shape(n) for (_id, n) in ISSUETYPE_DEFS],
        "avatarUrls": avatar_urls(),
        "assigneeType": "PROJECT_LEAD",
    }


# ---------------------------------------------------------------------------
# Issue
# ---------------------------------------------------------------------------

def build_issue(
    *,
    key,
    numeric_id,
    project,
    summary,
    description=None,
    issuetype_name="Task",
    priority_name="Medium",
    status_name="To Do",
    assignee_user=None,
    reporter_user=None,
    creator_user=None,
    created=None,
    updated=None,
    labels=None,
    duedate=None,
    comments=None,
) -> dict:
    created = created or now_jira()
    updated = updated or now_jira()
    labels = labels if labels is not None else []
    comments = comments if comments is not None else []
    nid = str(numeric_id)
    reporter = user_shape(reporter_user)
    creator = user_shape(creator_user if creator_user is not None else reporter_user)
    assignee = user_shape(assignee_user)
    return {
        "id": nid,
        "key": key,
        "self": base() + "/rest/api/2/issue/" + nid,
        "expand": "renderedFields,names,schema,operations,editmeta,changelog",
        "fields": {
            "summary": summary,
            "description": description,
            "status": status_shape(status_name),
            "priority": priority_shape(priority_name),
            "issuetype": issuetype_shape(issuetype_name),
            "project": project_ref(project),
            "assignee": assignee,
            "reporter": reporter,
            "creator": creator,
            "created": created,
            "updated": updated,
            "resolutiondate": None,
            "duedate": duedate,
            "labels": labels,
            "components": [],
            "fixVersions": [],
            "attachment": [],
            "subtasks": [],
            "comment": {
                "comments": comments,
                "maxResults": 10,
                "total": len(comments),
                "startAt": 0,
            },
            "worklog": {
                "worklogs": [],
                "maxResults": 20,
                "total": 0,
                "startAt": 0,
            },
        },
    }


# ---------------------------------------------------------------------------
# Search / Transitions / Project statuses
# ---------------------------------------------------------------------------

def search_payload(issues: list, start_at: int, max_results: int, total: int) -> dict:
    return {
        "expand": "names,schema",
        "startAt": start_at,
        "maxResults": max_results,
        "total": total,
        "issues": issues,
    }


def transitions_payload(issue_key: str) -> dict:
    self_url = base() + "/rest/api/2/issue/" + str(issue_key) + "/transitions"
    transitions = []
    for (tid, tname, to_status) in TRANSITION_DEFS:
        d = STATUS_DEFS[to_status]
        cat = d["category"]
        transitions.append({
            "id": tid,
            "name": tname,
            "self": self_url,
            "to": {
                "id": d["id"],
                "name": to_status,
                "statusCategory": {
                    "id": cat["id"],
                    "key": cat["key"],
                    "colorName": cat["colorName"],
                    "name": cat["name"],
                },
            },
        })
    return {"expand": "transitions", "transitions": transitions}


def _project_status_entry(name: str) -> dict:
    d = STATUS_DEFS[name]
    cat = d["category"]
    return {
        "id": d["id"],
        "name": name,
        "self": base() + "/rest/api/2/status/" + d["id"],
        "statusCategory": {
            "id": cat["id"],
            "key": cat["key"],
            "colorName": cat["colorName"],
            "name": cat["name"],
        },
    }


def project_statuses_payload() -> list:
    result = []
    for (iid, iname) in ISSUETYPE_DEFS:
        statuses = [
            _project_status_entry(n)
            for n in ("To Do", "In Progress", "In Review", "Done")
        ]
        result.append({
            "id": iid,
            "name": iname,
            "subtask": False,
            "self": base() + "/rest/api/2/issuetype/" + iid,
            "statuses": statuses,
        })
    return result


# ---------------------------------------------------------------------------
# List endpoints
# ---------------------------------------------------------------------------

def priority_list() -> list:
    return [
        {
            "id": pid,
            "name": pname,
            "self": base() + "/rest/api/2/priority/" + pid,
            "iconUrl": "",
            "statusColor": color,
        }
        for (pid, pname, color) in PRIORITY_DEFS
    ]


def status_list() -> list:
    return [status_shape(n) for n in ("To Do", "In Progress", "In Review", "Done", "Closed")]


def issuetype_list() -> list:
    return [issuetype_shape(n) for (_id, n) in ISSUETYPE_DEFS]


def field_list() -> list:
    return [
        {
            "id": fid,
            "name": fname,
            "custom": False,
            "orderable": True,
            "navigable": True,
            "searchable": True,
            "clauseNames": [fid],
            "schema": dict(schema),
        }
        for (fid, fname, schema) in _FIELD_DEFS
    ]


# ---------------------------------------------------------------------------
# Server meta / myself / license / comment / error
# ---------------------------------------------------------------------------

def server_info() -> dict:
    return {
        "baseUrl": base(),
        "version": "8.20.14",
        "versionNumbers": [8, 20, 14],
        "deploymentType": "Server",
        "buildNumber": 820014,
        "buildDate": "2022-01-01T00:00:00.000+0000",
        "scmInfo": "mock",
        "serverTitle": "Mock Jira Server",
        "defaultLocale": {"locale": "en_US"},
    }


def myself_shape(u: dict) -> dict:
    shaped = user_shape(u) or {}
    result = dict(shaped)
    result["groups"] = {"size": 1, "items": []}
    result["applicationRoles"] = {"size": 1, "items": []}
    return result


def license_stub() -> dict:
    return {
        "valid": True,
        "evaluation": False,
        "maximumNumberOfUsers": -1,
        "contactEmail": "admin@mockjira.com",
        "creationDate": "2020-01-01",
        "expiryDate": "2099-12-31",
        "rawLicense": "AAABRg0ODAoPeJytUEtPwzAMvvdXROLasOxACipb1WkgTaJSmxi4RC1LoFIS",
        "licenseType": "COMMERCIAL",
        "unlimited": True,
    }


def comment_shape(cid: str, body: str, author_user: dict, created: str, updated: str) -> dict:
    au = user_shape(author_user)
    return {
        "self": base() + "/rest/api/2/comment/" + str(cid),
        "id": str(cid),
        "author": au,
        "body": body,
        "updateAuthor": au,
        "created": created,
        "updated": updated,
    }


def error_body(messages) -> dict:
    if isinstance(messages, str):
        messages = [messages]
    else:
        messages = list(messages)
    return {"errorMessages": messages, "errors": {}}
