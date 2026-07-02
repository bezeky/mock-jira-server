"""Project endpoints for the Mock Jira Server (Server / Data Center flavor).

Registered under the /rest/api/2 prefix in app.main. Every handler accesses the
store lazily via get_db() so the live singleton (assigned at startup) is used.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import shapes
from app.store import get_db

router = APIRouter()


@router.get("/project")
async def list_projects():
    db = get_db()
    projects = db.list_projects() if db else []
    return JSONResponse(content=[shapes.project_shape(p) for p in projects])


@router.get("/project/{key}")
async def get_project(key: str):
    db = get_db()
    project = db.get_project(key) if db else None
    if project is None:
        return JSONResponse(
            status_code=404,
            content=shapes.error_body(
                f"No project could be found with key '{key}'."
            ),
        )
    return JSONResponse(content=shapes.project_shape(project))


@router.post("/project")
async def create_project(request: Request):
    db = get_db()
    body = await request.json()

    existing = db.list_projects() if db else []
    stored = {
        "id": str(10000 + len(existing)),
        "key": body.get("key"),
        "name": body.get("name"),
        "projectTypeKey": body.get("projectTypeKey", "software"),
        "lead": body.get("lead", "admin"),
    }
    if db:
        db.save_project(stored)
    return JSONResponse(status_code=201, content=shapes.project_shape(stored))


@router.get("/project/{key}/statuses")
@router.get("/Project/{key}/statuses")
async def get_project_statuses(key: str):
    db = get_db()
    project = db.get_project(key) if db else None
    if project is None:
        return JSONResponse(
            status_code=404,
            content=shapes.error_body(
                f"No project could be found with key '{key}'."
            ),
        )
    return JSONResponse(content=shapes.project_statuses_payload())
