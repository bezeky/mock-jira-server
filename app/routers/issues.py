"""Issue router for the Mock Jira Server (Server / Data Center flavor).

Implements create/read/update/delete of issues plus transitions and comments.
No prefix is applied here; main.py mounts this router under /rest/api/2.

Store access follows the singleton pattern: never bind ``store`` at import
time. Call ``db = get_db()`` inside each handler so the live module global is
read after main.py assigns it during startup.
"""

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app import shapes
from app.store import get_db

router = APIRouter()


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

    project_ref = fields.get("project") or {}
    pk = project_ref.get("key")
    if not pk:
        return JSONResponse(
            status_code=400,
            content=shapes.error_body("project is required"),
        )

    project = db.get_project(pk)
    if project is None:
        return JSONResponse(
            status_code=400,
            content=shapes.error_body("project '%s' does not exist" % pk),
        )

    key, nid = db.next_issue_key_and_id(project["key"])

    assignee_field = fields.get("assignee")
    assignee_user = None
    if assignee_field and assignee_field.get("name"):
        assignee_user = db.get_user_by_name(assignee_field["name"])

    reporter = _current_user(request, db)
    creator = reporter

    issue = shapes.build_issue(
        key=key,
        numeric_id=nid,
        project=project,
        summary=fields.get("summary", ""),
        description=fields.get("description"),
        issuetype_name=(fields.get("issuetype") or {}).get("name", "Task"),
        priority_name=(fields.get("priority") or {}).get("name", "Medium"),
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
