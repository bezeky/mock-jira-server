"""User lookup endpoints for the mock Jira Server (Server / Data Center flavor).

Users are looked up by ``username`` or ``key`` (both are username strings on
Server). User objects use "name"/"key" and NEVER emit accountId/accountType/
locale. The store singleton is resolved lazily via ``get_db()`` inside each
handler.
"""

from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import shapes
from app.store import get_db

router = APIRouter()


@router.get("/user")
async def get_user(
    username: Optional[str] = None,
    key: Optional[str] = None,
) -> JSONResponse:
    lookup = username or key
    db = get_db()
    user = db.get_user_by_name(lookup) if (db and lookup) else None
    if user is None:
        return JSONResponse(
            status_code=404,
            content=shapes.error_body(
                "The user named '%s' does not exist" % (lookup or "")
            ),
        )
    return JSONResponse(content=shapes.user_shape(user))


@router.get("/user/search")
async def user_search(query: str = "") -> JSONResponse:
    db = get_db()
    users = db.list_users(query) if db else []
    return JSONResponse(content=[shapes.user_shape(u) for u in users])
