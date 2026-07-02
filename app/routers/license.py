"""License stub endpoint for the Mock Jira Server (Server flavor).

Mounted under the /rest/plugins prefix in main.py, giving the full path:
    GET /rest/plugins/applications/1.0/installed/jira-software/license
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import shapes

router = APIRouter()


@router.get("/applications/1.0/installed/jira-software/license")
def license_():
    return JSONResponse(content=shapes.license_stub())
