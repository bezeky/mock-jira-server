"""Application entrypoint for the Mock Jira Server (Server / Data Center flavor).

Builds the FastAPI app, wires middleware and routers, and connects to
PostgreSQL on startup (with a retry loop, since the DB container may still be
coming up). The store singleton is assigned onto ``app.store`` so that every
handler/middleware can read the live global via ``get_db()``.

``PostgresStore`` is imported as a module attribute here on purpose so tests can
monkeypatch ``app.main.PostgresStore``.
"""

import logging
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.config import settings

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
from app.store import PostgresStore
from app import store as store_module
from app.seed import load_seed_data

from app.routers import meta, projects, issues, search, users
from app.routers import license as license_router
from app.admin.router import router as admin_router

from app.auth import AuthMiddleware
from app.logger import RequestLogMiddleware


app = FastAPI(
    title="Mock Jira Server",
    version="1.0.0",
    description="Mock Jira Server (on-prem) REST API v2",
)

# Middleware. Starlette runs middleware in reverse order of registration, so
# adding RequestLogMiddleware first and AuthMiddleware second means auth runs
# before the request-log wrapper completes timing around the full response.
app.add_middleware(RequestLogMiddleware)
app.add_middleware(AuthMiddleware)

# Routers. Prefixes are applied here; the router modules themselves carry none.
app.include_router(meta.router, prefix="/rest/api/2")
app.include_router(projects.router, prefix="/rest/api/2")
app.include_router(issues.router, prefix="/rest/api/2")
app.include_router(search.router, prefix="/rest/api/2")
app.include_router(users.router, prefix="/rest/api/2")
app.include_router(license_router.router, prefix="/rest/plugins")
app.include_router(admin_router)


@app.on_event("startup")
def startup():
    """Connect to Postgres (retrying), create tables, assign the singleton,
    and seed initial data when the store is empty."""
    max_retries = 10
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            db = PostgresStore(settings.DATABASE_URL)
            db.init_tables()
            store_module.store = db
            break
        except Exception as exc:  # noqa: BLE001 - retry on any connection error
            last_error = exc
            if attempt < max_retries:
                time.sleep(2)
    else:
        raise RuntimeError(
            f"Could not connect to database after {max_retries} attempts: "
            f"{last_error}"
        )

    if settings.SEED_DATA and not store_module.store.list_projects():
        load_seed_data(store_module.store)


@app.get("/")
def root():
    return JSONResponse(
        {
            "name": "Mock Jira Server",
            "admin": "/admin",
            "docs": "/docs",
            "api": "/rest/api/2",
        }
    )
