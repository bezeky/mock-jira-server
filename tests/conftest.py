"""Hermetic pytest fixtures for the Mock Jira Server (Server / Data Center).

These tests run WITHOUT a real PostgreSQL: an in-memory ``FakeStore`` that
implements the same public surface as ``app.store.PostgresStore`` is assigned
onto the store singleton before any request is served, and the FastAPI startup
handler (which would otherwise connect to Postgres) is cleared.

The store singleton is read live via ``app.store.get_db()`` inside every
handler/middleware, so pre-setting ``app.store.store`` is all that's needed for
the whole app to talk to the fake.
"""

import pytest
from fastapi.testclient import TestClient


class FakeStore:
    """In-memory stand-in for PostgresStore.

    Mirrors the same public methods/signatures. Backed by plain dicts/lists.
    ``next_issue_key_and_id`` reproduces PostgresStore's counter arithmetic
    exactly: a per-project counter (first issue -> number 1) and a numeric id
    sequence starting at 10001.
    """

    def __init__(self):
        self._projects = {}          # key -> stored project dict
        self._issues = {}            # key -> full issue dict
        self._issue_order = []       # insertion order of issue keys
        self._users = {}             # name -> stored user dict
        self._comments = {}          # issue_key -> list[comment dict]
        self._request_log = []       # list[entry dict], oldest first
        self._counters = {}          # project_key -> next_number (like Postgres)
        self._next_numeric = 10001   # nextval('issue_numeric_id_seq')

    # ------------------------------------------------------------------ schema
    def init_tables(self):
        return None

    def clear_all(self):
        self._projects.clear()
        self._issues.clear()
        self._issue_order.clear()
        self._users.clear()
        self._comments.clear()
        self._request_log.clear()
        self._counters.clear()
        self._next_numeric = 10001

    # ---------------------------------------------------------------- projects
    def get_project(self, key):
        if key is None:
            return None
        for pkey, data in self._projects.items():
            if pkey.upper() == str(key).upper():
                return data
        return None

    def get_project_by_id(self, pid):
        if pid is None:
            return None
        for data in self._projects.values():
            if str(data.get("id")) == str(pid):
                return data
        return None

    def list_projects(self):
        return [self._projects[k] for k in sorted(self._projects)]

    def save_project(self, project):
        self._projects[project["key"]] = project

    def next_issue_key_and_id(self, project_key):
        n = self._counters.get(project_key)
        n = 2 if n is None else n + 1
        self._counters[project_key] = n
        number = n - 1
        numeric_id = self._next_numeric
        self._next_numeric += 1
        return (f"{project_key}-{number}", numeric_id)

    # ------------------------------------------------------------------ issues
    def save_issue(self, issue):
        key = issue["key"]
        if key not in self._issues:
            self._issue_order.append(key)
        self._issues[key] = issue

    def get_issue_by_key(self, key):
        return self._issues.get(key)

    def get_issue_by_numeric_id(self, numeric_id):
        for data in self._issues.values():
            try:
                if int(data["id"]) == int(numeric_id):
                    return data
            except (KeyError, ValueError, TypeError):
                continue
        return None

    def list_all_issues(self):
        # Newest-first (created_at DESC) == reverse insertion order.
        return [self._issues[k] for k in reversed(self._issue_order) if k in self._issues]

    def delete_issue(self, key):
        if key in self._issues:
            del self._issues[key]
            if key in self._issue_order:
                self._issue_order.remove(key)
            self._comments.pop(key, None)
            return True
        return False

    # ------------------------------------------------------------------- users
    def get_user_by_name(self, name):
        if name is None:
            return None
        for uname, data in self._users.items():
            if uname.lower() == str(name).lower():
                return data
        return None

    def get_user_by_email(self, email):
        if email is None:
            return None
        target = str(email).lower()
        for data in self._users.values():
            addr = data.get("emailAddress") or data.get("email")
            if addr and addr.lower() == target:
                return data
        return None

    def list_users(self, query=None):
        users = [self._users[n] for n in sorted(self._users)]
        if not query:
            return users
        q = str(query).lower()

        def hit(u):
            return (
                q in str(u.get("name", "")).lower()
                or q in str(u.get("displayName", "")).lower()
                or q in str(u.get("emailAddress", "") or u.get("email", "")).lower()
            )

        return [u for u in users if hit(u)]

    def save_user(self, user):
        self._users[user["name"]] = user

    # ---------------------------------------------------------------- comments
    def get_comments(self, issue_key):
        return list(self._comments.get(issue_key, []))

    def add_comment(self, issue_key, comment):
        bucket = self._comments.setdefault(issue_key, [])
        cid = comment.get("id")
        for i, existing in enumerate(bucket):
            if existing.get("id") == cid:
                bucket[i] = comment
                return
        bucket.append(comment)

    # ------------------------------------------------------------- request log
    def add_to_request_log(self, entry):
        self._request_log.append(dict(entry))

    def get_request_log(self, limit=50):
        return list(reversed(self._request_log))[:limit]


@pytest.fixture
def client():
    """A TestClient backed by a freshly seeded in-memory FakeStore.

    No PostgreSQL is touched: the store singleton is pre-set and the startup
    handler is cleared so TestClient never tries to connect.
    """
    import app.main as main
    from app import store as store_module
    from app.seed import load_seed_data

    fake = FakeStore()
    store_module.store = fake
    load_seed_data(fake)

    # Prevent the real Postgres startup handler from running.
    main.app.router.on_startup.clear()

    with TestClient(main.app) as test_client:
        yield test_client

    store_module.store = None
