"""Issue router for the Mock Jira Server (Server / Data Center flavor).

Implements create/read/update/delete of issues plus transitions and comments.
No prefix is applied here; main.py mounts this router under /rest/api/2.

Store access follows the singleton pattern: never bind ``store`` at import
time. Call ``db = get_db()`` inside each handler so the live module global is
read after main.py assigns it during startup.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from app import shapes
from app.config import settings
from app.store import get_db

router = APIRouter()
logger = logging.getLogger("mock_jira.issues")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve(db, key: str) -> Optional[dict]:
    """Look up an issue by its Jira key (APIRE-1) or numeric id ("10001")."""
    issue = db.get_issue_by_key(key)
    if issue is not None:
        return issue
    if isinstance(key, str) and key.isdigit():
        return db.get_issue_by_numeric_id(int(key))
    return None


def _current_user(request: Request, db) -> Optional[dict]:
    """The authenticated user (set by AuthMiddleware), else first stored user."""
    user = getattr(request.state, "user", None)
    if user is not None:
        return user
    users = db.list_users()
    return users[0] if users else None


def _issuetype_name_from_field(issuetype_field: Optional[dict]) -> str:
    """Accepts {"name": "Bug"} (already worked) or {"id": "10002"} (new).
    Falls back to "Task" if neither resolves, same as the old default."""
    if not issuetype_field:
        return "Task"
    name = issuetype_field.get("name")
    if name:
        return name
    iid = issuetype_field.get("id")
    if iid is not None:
        for (_id, _name) in shapes.ISSUETYPE_DEFS:
            if _id == str(iid):
                return _name
    return "Task"


def _priority_name_from_field(priority_field: Optional[dict]) -> str:
    """Accepts {"name": "High"} (already worked) or {"id": "2"} (new).
    Falls back to "Medium" if neither resolves, same as the old default."""
    if not priority_field:
        return "Medium"
    name = priority_field.get("name")
    if name:
        return name
    pid = priority_field.get("id")
    if pid is not None:
        for (_id, _name, _color) in shapes.PRIORITY_DEFS:
            if _id == str(pid):
                return _name
    return "Medium"


def _resolve_assignee(db, assignee_field: Optional[dict]):
    """Accepts {"name": "developer1"} (already worked) or {"key": "developer1"}
    (new — Jira Server clients commonly send key). In this mock key == name
    for every seeded user, so both look up the same users table."""
    if not assignee_field:
        return None
    identifier = assignee_field.get("name") or assignee_field.get("key")
    if not identifier:
        return None
    return db.get_user_by_name(identifier)


def _not_found() -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content=shapes.error_body("Issue Does Not Exist"),
    )


async def _read_json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        body = None
    return body if isinstance(body, dict) else {}


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("/issue")
@router.post("/issues")
async def create_issue(request: Request):
    db = get_db()
    body = await _read_json(request)
    fields = body.get("fields") or {}

    # Diagnostic: log the exact body every caller sends. Controlled by
    # LOG_LEVEL (default INFO, so this shows up by default). This is what to
    # watch with `docker compose logs -f mock-jira` while retriggering a
    # client's create-issue flow — it settles disputes about what a client
    # actually sent versus what we assumed it sent.
    logger.info("POST /issue raw body: %s", body)

    project_ref = fields.get("project") or {}
    pk = project_ref.get("key")
    pid = project_ref.get("id")

    if not pk and not pid:
        return JSONResponse(
            status_code=400,
            content=shapes.error_body("project is required"),
        )

    # Prefer key; fall back to numeric id. Real Jira clients commonly resolve
    # a project to its id once (e.g. via GET /project/{key}) and then send
    # {"project": {"id": "10000"}} on subsequent create-issue calls instead of
    # the key — this fallback is what makes that pattern work here too.
    project = db.get_project(pk) if pk else None
    if project is None and pid:
        project = db.get_project_by_id(pid)

    if project is None:
        return JSONResponse(
            status_code=400,
            content=shapes.error_body("project '%s' does not exist" % (pk or pid)),
        )

    key, nid = db.next_issue_key_and_id(project["key"])

    assignee_user = _resolve_assignee(db, fields.get("assignee"))

    reporter = _current_user(request, db)
    creator = reporter

    issue = shapes.build_issue(
        key=key,
        numeric_id=nid,
        project=project,
        summary=fields.get("summary", ""),
        description=fields.get("description"),
        issuetype_name=_issuetype_name_from_field(fields.get("issuetype")),
        priority_name=_priority_name_from_field(fields.get("priority")),
        status_name="To Do",
        assignee_user=assignee_user,
        reporter_user=reporter,
        creator_user=creator,
        created=shapes.now_jira(),
        updated=shapes.now_jira(),
        labels=fields.get("labels"),
        duedate=fields.get("duedate"),
    )
    db.save_issue(issue)

    return JSONResponse(
        status_code=201,
        content={
            "id": issue["id"],
            "key": issue["key"],
            "self": issue["self"],
        },
    )


# ---------------------------------------------------------------------------
# Create metadata
#
# MUST be registered before ``GET /issue/{key}`` below. Starlette matches routes
# in registration order, so if this came after, ``/issue/createmeta`` would be
# captured as ``{key} == "createmeta"`` and 404 on the store lookup.
# ---------------------------------------------------------------------------

@router.get("/issue/createmeta")
def get_createmeta(
    request: Request,
    projectKeys: Optional[List[str]] = Query(None),
    issuetypeNames: Optional[List[str]] = Query(None),
    issuetypeIds: Optional[List[str]] = Query(None),
    expand: Optional[str] = Query(None),
):
    """
    Returns field metadata for issue creation.
    Used by DefectDojo and pycontribs/jira to validate project config.
    MUST be registered before GET /issue/{key} to avoid route capture.
    """
    db = get_db()
    base_url = settings.BASE_URL

    # --- Issue types master list ---
    # Ids come from the canonical shapes.ISSUETYPE_DEFS so createmeta reports the
    # same (id, name) pairs every other endpoint does (create_issue, GET
    # /issue/{key}, GET /field): Task=10001, Bug=10002, Story=10003. Epic is
    # advertised for parity with a default Jira project scheme; it has no
    # canonical id, so it is appended explicitly.
    all_issue_types = [
        {"id": _id, "name": _name, "subtask": False}
        for (_id, _name) in shapes.ISSUETYPE_DEFS
    ]
    all_issue_types.append({"id": "10004", "name": "Epic", "subtask": False})

    # Filter issue types by name if requested. Query params are lists so both the
    # comma-string form (?issuetypeNames=Bug,Task) and the repeated form
    # (?issuetypeNames=Bug&issuetypeNames=Task) that pycontribs/jira emits work;
    # an empty/whitespace-only value is treated as "no filter".
    if issuetypeNames:
        names_filter = {n.strip().lower() for group in issuetypeNames for n in group.split(",") if n.strip()}
        if names_filter:
            all_issue_types = [it for it in all_issue_types if it["name"].lower() in names_filter]

    # Filter issue types by ID if requested (same multi-value handling).
    if issuetypeIds:
        ids_filter = {i.strip() for group in issuetypeIds for i in group.split(",") if i.strip()}
        if ids_filter:
            all_issue_types = [it for it in all_issue_types if it["id"] in ids_filter]

    # Determine whether to include field metadata
    include_fields = bool(expand and "projects.issuetypes.fields" in expand)

    # Standard field metadata (returned when expand=projects.issuetypes.fields)
    fields_meta = {
        "summary": {
            "required": True,
            "schema": {"type": "string", "system": "summary"},
            "name": "Summary",
            "key": "summary",
            "hasDefaultValue": False,
            "operations": ["set"],
            "allowedValues": []
        },
        "issuetype": {
            "required": True,
            "schema": {"type": "issuetype", "system": "issuetype"},
            "name": "Issue Type",
            "key": "issuetype",
            "hasDefaultValue": False,
            "operations": [],
            "allowedValues": []
        },
        "description": {
            "required": False,
            "schema": {"type": "string", "system": "description"},
            "name": "Description",
            "key": "description",
            "hasDefaultValue": False,
            "operations": ["set"],
            "allowedValues": []
        },
        "project": {
            "required": True,
            "schema": {"type": "project", "system": "project"},
            "name": "Project",
            "key": "project",
            "hasDefaultValue": False,
            "operations": ["set"],
            "allowedValues": []
        },
        "priority": {
            "required": False,
            "schema": {"type": "priority", "system": "priority"},
            "name": "Priority",
            "key": "priority",
            "hasDefaultValue": True,
            "operations": ["set"],
            "allowedValues": [
                {"self": f"{base_url}/rest/api/2/priority/1", "iconUrl": "", "name": "Highest", "id": "1"},
                {"self": f"{base_url}/rest/api/2/priority/2", "iconUrl": "", "name": "High",    "id": "2"},
                {"self": f"{base_url}/rest/api/2/priority/3", "iconUrl": "", "name": "Medium",  "id": "3"},
                {"self": f"{base_url}/rest/api/2/priority/4", "iconUrl": "", "name": "Low",     "id": "4"},
                {"self": f"{base_url}/rest/api/2/priority/5", "iconUrl": "", "name": "Lowest",  "id": "5"},
            ]
        },
        "assignee": {
            "required": False,
            "schema": {"type": "user", "system": "assignee"},
            "name": "Assignee",
            "key": "assignee",
            "hasDefaultValue": False,
            "operations": ["set"],
            "allowedValues": []
        },
        "labels": {
            "required": False,
            "schema": {"type": "array", "items": "string", "system": "labels"},
            "name": "Labels",
            "key": "labels",
            "hasDefaultValue": False,
            "operations": ["add", "set", "remove"],
            "allowedValues": []
        },
        "components": {
            "required": False,
            "schema": {"type": "array", "items": "component", "system": "components"},
            "name": "Component/s",
            "key": "components",
            "hasDefaultValue": False,
            "operations": ["add", "set", "remove"],
            "allowedValues": []
        }
    }

    # --- Get and filter projects ---
    all_projects = db.list_projects()
    if projectKeys:
        keys_filter = {k.strip().upper() for group in projectKeys for k in group.split(",") if k.strip()}
        if keys_filter:
            all_projects = [p for p in all_projects if p["key"].upper() in keys_filter]

    # --- Build response ---
    result_projects = []
    for project in all_projects:
        project_issuetypes = []
        for it in all_issue_types:
            entry = {
                "self":    f"{base_url}/rest/api/2/issuetype/{it['id']}",
                "id":      it["id"],
                "name":    it["name"],
                "iconUrl": "",
                "subtask": it["subtask"],
                "expand":  "fields",
            }
            if include_fields:
                entry["fields"] = fields_meta
            project_issuetypes.append(entry)

        result_projects.append({
            "expand":     "issuetypes",
            "self":       f"{base_url}/rest/api/2/project/{project.get('id', '10000')}",
            "id":         str(project.get("id", "10000")),
            "key":        project["key"],
            "name":       project["name"],
            "avatarUrls": {"48x48": "", "24x24": "", "16x16": "", "32x32": ""},
            "issuetypes": project_issuetypes,
        })

    return {"expand": "projects", "projects": result_projects}


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

@router.get("/issue/{key}")
async def get_issue(key: str):
    db = get_db()
    issue = _resolve(db, key)
    if issue is None:
        return _not_found()
    return JSONResponse(status_code=200, content=issue)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

@router.put("/issue/{key}")
async def update_issue(key: str, request: Request):
    db = get_db()
    issue = _resolve(db, key)
    if issue is None:
        return _not_found()

    body = await _read_json(request)
    fields = body.get("fields") or {}
    issue_fields = issue["fields"]

    for direct in ("summary", "description", "labels", "duedate"):
        if direct in fields:
            issue_fields[direct] = fields[direct]

    if "priority" in fields and fields["priority"]:
        issue_fields["priority"] = shapes.priority_shape(fields["priority"].get("name", "Medium"))

    if "issuetype" in fields and fields["issuetype"]:
        issue_fields["issuetype"] = shapes.issuetype_shape(fields["issuetype"].get("name", "Task"))

    if "status" in fields and fields["status"]:
        issue_fields["status"] = shapes.status_shape(fields["status"].get("name", "To Do"))

    if "assignee" in fields:
        assignee_field = fields["assignee"]
        if assignee_field and assignee_field.get("name"):
            user = db.get_user_by_name(assignee_field["name"])
            issue_fields["assignee"] = shapes.user_shape(user)
        else:
            issue_fields["assignee"] = None

    issue_fields["updated"] = shapes.now_jira()
    db.save_issue(issue)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/issue/{key}")
async def delete_issue(key: str):
    db = get_db()
    issue = _resolve(db, key)
    if issue is None:
        return _not_found()
    db.delete_issue(issue["key"])
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------

@router.get("/issue/{key}/transitions")
async def get_transitions(key: str):
    db = get_db()
    issue = _resolve(db, key)
    if issue is None:
        return _not_found()
    return JSONResponse(status_code=200, content=shapes.transitions_payload(issue["key"]))


@router.post("/issue/{key}/transitions")
async def do_transition(key: str, request: Request):
    db = get_db()
    issue = _resolve(db, key)
    if issue is None:
        return _not_found()

    body = await _read_json(request)
    transition = body.get("transition") or {}
    tid = transition.get("id")

    target_status = None
    for (t_id, _t_name, to_status) in shapes.TRANSITION_DEFS:
        if t_id == str(tid):
            target_status = to_status
            break

    if target_status is None:
        return JSONResponse(
            status_code=400,
            content=shapes.error_body("Invalid transition id '%s'" % tid),
        )

    issue["fields"]["status"] = shapes.status_shape(target_status)
    issue["fields"]["updated"] = shapes.now_jira()
    db.save_issue(issue)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

@router.get("/issue/{key}/comment")
async def get_comments(key: str):
    db = get_db()
    issue = _resolve(db, key)
    if issue is None:
        return _not_found()
    comments = db.get_comments(issue["key"])
    return JSONResponse(
        status_code=200,
        content={
            "comments": comments,
            "maxResults": 10,
            "total": len(comments),
            "startAt": 0,
        },
    )


@router.post("/issue/{key}/comment")
async def add_comment(key: str, request: Request):
    db = get_db()
    issue = _resolve(db, key)
    if issue is None:
        return _not_found()

    body = await _read_json(request)
    text = body.get("body", "")

    cid = str(10000 + len(db.get_comments(issue["key"])))
    author = _current_user(request, db)
    ts = shapes.now_jira()
    comment = shapes.comment_shape(cid, text, author, ts, ts)
    db.add_comment(issue["key"], comment)

    container = issue["fields"].get("comment") or {
        "comments": [],
        "maxResults": 10,
        "total": 0,
        "startAt": 0,
    }
    container.setdefault("comments", []).append(comment)
    container["total"] = len(container["comments"])
    issue["fields"]["comment"] = container
    db.save_issue(issue)

    return JSONResponse(status_code=201, content=comment)
