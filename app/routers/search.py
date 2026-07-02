"""Search endpoints (GET/POST /search) for the mock Jira Server.

JQL is executed in pure Python over the stored issue dicts returned by
``store.list_all_issues()``. The store singleton is resolved lazily inside
each handler via ``get_db()`` so it always reads the live module global.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import shapes
from app.jql import execute_jql
from app.store import get_db

router = APIRouter()


class SearchBody(BaseModel):
    jql: str = ""
    maxResults: int = 50
    startAt: int = 0


def _run_search(jql: str, max_results: int, start_at: int, username: str) -> dict:
    db = get_db()
    all_issues = db.list_all_issues() if db else []
    matched = execute_jql(jql, all_issues, username)
    total = len(matched)
    page = matched[start_at:start_at + max_results]
    return shapes.search_payload(page, start_at, max_results, total)


@router.get("/search")
async def search_get(
    request: Request,
    jql: str = "",
    maxResults: int = 50,
    startAt: int = 0,
) -> JSONResponse:
    username = getattr(request.state, "username", "anonymous") or "anonymous"
    payload = _run_search(jql, maxResults, startAt, username)
    return JSONResponse(content=payload)


@router.post("/search")
async def search_post(request: Request, body: SearchBody) -> JSONResponse:
    username = getattr(request.state, "username", "anonymous") or "anonymous"
    payload = _run_search(body.jql, body.maxResults, body.startAt, username)
    return JSONResponse(content=payload)
