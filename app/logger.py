"""Request-logging middleware for the Mock Jira Server.

Times each request and writes a row to the ``request_log`` table via the store.
The DB write is offloaded to a thread executor so it never blocks the event
loop, and every failure (including a ``None`` store) is swallowed so logging can
never break the actual response.

The store singleton is always accessed via ``get_db()`` (never a module-level
``store`` import) so the live module global is read at request time.
"""

import asyncio
from time import perf_counter

from starlette.middleware.base import BaseHTTPMiddleware

from app.store import get_db


# Paths that skip logging entirely (still forwarded via call_next).
SKIP_PREFIXES = (
    "/admin",
    "/api/admin",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
)


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if any(path.startswith(prefix) for prefix in SKIP_PREFIXES):
            return await call_next(request)

        t0 = perf_counter()
        response = await call_next(request)
        duration_ms = (perf_counter() - t0) * 1000

        try:
            db = get_db()
            if db is not None:
                entry = {
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round(duration_ms, 2),
                }
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, db.add_to_request_log, entry)
        except Exception:
            # Logging must never break the response.
            pass

        return response
