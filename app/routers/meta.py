"""Meta / read-only endpoints for the Mock Jira Server (Server flavor).

Routes here are mounted under the /rest/api/2 prefix in main.py:
    GET /serverInfo, GET /myself, GET /priority, GET /field,
    GET /status, GET /issuetype, GET /issue/{key}/changelog
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import shapes
from app.store import get_db

router = APIRouter()


@router.get("/serverInfo")
def server_info():
    return JSONResponse(content=shapes.server_info())


@router.get("/myself")
def myself(request: Request):
    user = getattr(request.state, "user", None)
    if user is None:
        db = get_db()
        if db is not None:
            users = db.list_users()
            if users:
                user = users[0]
    return JSONResponse(content=shapes.myself_shape(user))


@router.get("/priority")
def priority():
    return JSONResponse(content=shapes.priority_list())


@router.get("/field")
def field():
    return JSONResponse(content=shapes.field_list())


@router.get("/status")
def status():
    return JSONResponse(content=shapes.status_list())


@router.get("/issuetype")
def issuetype():
    return JSONResponse(content=shapes.issuetype_list())


@router.get("/issue/{key}/changelog")
def issue_changelog(key: str):
    """Minimal changelog stub. This mock does not track field history, so an
    empty ``histories`` array is the correct answer for any existing issue."""
    db = get_db()
    from app.routers.issues import _resolve

    issue = _resolve(db, key) if db else None
    if issue is None:
        return JSONResponse(
            status_code=404,
            content=shapes.error_body("Issue Does Not Exist"),
        )
    return JSONResponse(
        content={
            "startAt": 0,
            "maxResults": 50,
            "total": 0,
            "histories": [],
        }
    )
