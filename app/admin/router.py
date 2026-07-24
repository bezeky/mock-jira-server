"""Admin dashboard router for the Mock Jira Server.

Mounted in main.py with NO prefix, so the routes are exactly:

    GET    /admin                  -> serves the dashboard HTML
    GET    /api/admin/data         -> live dashboard JSON (stats, issues, request log)
    GET    /api/admin/issue/{key}  -> single issue detail (description, comments)
    DELETE /api/admin/reset        -> wipe + reseed the store

The store singleton is accessed via ``get_db()`` INSIDE each handler (never
bound at import time), following the project-wide singleton access pattern.
"""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from app import shapes  # noqa: F401  (kept per contract; available to handlers)
from app.store import get_db

router = APIRouter()

_DASHBOARD = Path(__file__).parent / "dashboard.html"


def _issue_row(issue: dict) -> dict:
    """Derive a flat dashboard row from a stored (full) issue dict."""
    fields = issue.get("fields") or {}
    status = fields.get("status") or {}
    category = status.get("statusCategory") or {}
    priority = fields.get("priority") or {}
    project = fields.get("project") or {}
    issuetype = fields.get("issuetype") or {}
    assignee = fields.get("assignee")
    assignee_name = assignee.get("displayName") if assignee else "Unassigned"
    return {
        "key": issue.get("key"),
        "summary": fields.get("summary"),
        "status": status.get("name"),
        "status_category_key": category.get("key"),
        "priority": priority.get("name"),
        "project_key": project.get("key"),
        "project_name": project.get("name"),
        "assignee": assignee_name or "Unassigned",
        "issuetype": issuetype.get("name"),
        "created": fields.get("created"),
        "description": fields.get("description"),
        "comments": (fields.get("comment") or {}).get("comments", []),
        "reporter": (fields.get("reporter") or {}).get("displayName", ""),
        "updated": fields.get("updated", ""),
    }


def _log_row(entry: dict) -> dict:
    return {
        "timestamp": entry.get("logged_at"),
        "method": entry.get("method"),
        "path": entry.get("path"),
        "status_code": entry.get("status_code"),
        "duration_ms": entry.get("duration_ms"),
    }


@router.get("/admin")
def admin_dashboard():
    return FileResponse(str(_DASHBOARD), media_type="text/html")


@router.get("/api/admin/data")
def admin_data():
    db = get_db()
    if db is None:
        return JSONResponse(
            {
                "stats": {
                    "total_projects": 0,
                    "total_issues": 0,
                    "total_requests": 0,
                    "in_progress_issues": 0,
                },
                "issues": [],
                "request_log": [],
            }
        )

    projects = db.list_projects()
    # limit to 100 newest; full-text descriptions make larger
    # result sets too slow for the dashboard polling interval
    all_issues = db.list_all_issues()[:100]  # already newest-first (created_at DESC)

    in_progress = 0
    issue_rows = []
    for issue in all_issues:
        row = _issue_row(issue)
        if row["status"] == "In Progress":
            in_progress += 1
        issue_rows.append(row)

    total_requests = len(db.get_request_log(1000000))
    request_log = [_log_row(e) for e in db.get_request_log(50)]

    return JSONResponse(
        {
            "stats": {
                "total_projects": len(projects),
                "total_issues": len(all_issues),
                "total_requests": total_requests,
                "in_progress_issues": in_progress,
            },
            "issues": issue_rows,
            "request_log": request_log,
        }
    )


@router.get("/api/admin/issue/{key}")
def admin_issue_detail(key: str):
    db = get_db()
    if db is None:
        return JSONResponse(status_code=503, content={"error": "store not ready"})
    from app.routers.issues import _resolve

    issue = _resolve(db, key)
    if issue is None:
        return JSONResponse(status_code=404, content={"error": "not found"})
    row = _issue_row(issue)
    # Full description and comments for the detail view (description coerced
    # to "" so the panel never has to render null).
    fields = issue.get("fields") or {}
    row["description"] = fields.get("description") or ""
    row["comments"] = (fields.get("comment") or {}).get("comments", [])
    row["reporter"] = (fields.get("reporter") or {}).get("displayName", "")
    row["created"] = fields.get("created", "")
    row["updated"] = fields.get("updated", "")
    return JSONResponse(row)


@router.delete("/api/admin/reset")
def admin_reset():
    db = get_db()
    if db is not None:
        db.clear_all()
        from app.seed import load_seed_data

        load_seed_data(db)
    return JSONResponse({"status": "reset"})
