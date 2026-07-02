"""Basic/Bearer auth middleware for the Mock Jira Server.

This middleware never returns 401. It extracts a username from the
``Authorization`` header (Basic or Bearer), looks the user up in the store, and
stashes both on ``request.state`` for downstream handlers. Any malformed header
falls back to the ``anonymous`` username.

The store singleton is always accessed via ``get_db()`` (never a module-level
``store`` import) so the live module global is read at request time.
"""

import base64

from starlette.middleware.base import BaseHTTPMiddleware

from app.store import get_db


# Paths that skip auth processing entirely (still forwarded via call_next).
SKIP_PREFIXES = (
    "/admin",
    "/api/admin",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
)


def _username_from_header(auth_header):
    """Extract a username from an Authorization header value.

    Basic ``base64(user:pass)`` -> the part before ``:``.
    Bearer ``<token>`` -> the literal ``"token-user"``.
    Missing/malformed -> ``"anonymous"``.
    """
    if not auth_header:
        return "anonymous"

    parts = auth_header.split(" ", 1)
    if len(parts) != 2:
        return "anonymous"

    scheme, value = parts[0].strip(), parts[1].strip()
    scheme_lower = scheme.lower()

    if scheme_lower == "basic":
        try:
            decoded = base64.b64decode(value).decode("utf-8", errors="replace")
        except Exception:
            return "anonymous"
        # username is everything before the first ':'
        username = decoded.split(":", 1)[0]
        return username or "anonymous"

    if scheme_lower == "bearer":
        return "token-user"

    return "anonymous"


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if any(path.startswith(prefix) for prefix in SKIP_PREFIXES):
            return await call_next(request)

        try:
            auth_header = request.headers.get("Authorization")
        except Exception:
            auth_header = None

        username = _username_from_header(auth_header)

        user = None
        try:
            db = get_db()
            if db is not None:
                user = db.get_user_by_name(username)
                if user is None:
                    users = db.list_users()
                    if users:
                        user = users[0]
        except Exception:
            user = None

        request.state.username = username
        request.state.user = user

        return await call_next(request)
