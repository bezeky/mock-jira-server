"""PostgreSQL-backed store for the mock Jira Server.

Uses psycopg2 directly (NO SQLAlchemy). All JSONB payloads are stored via
psycopg2.extras.Json(...). RealDictCursor returns JSONB already parsed as dict.
No database connection or work happens at import time.
"""

import json
from contextlib import contextmanager
from typing import Optional

import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor, Json


DDL = """
CREATE SEQUENCE IF NOT EXISTS issue_numeric_id_seq START 10001;

CREATE TABLE IF NOT EXISTS projects (
    key VARCHAR(50) PRIMARY KEY,
    name TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_counters (
    project_key VARCHAR(50) PRIMARY KEY,
    next_number INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS issues (
    key VARCHAR(100) PRIMARY KEY,
    numeric_id BIGINT UNIQUE NOT NULL DEFAULT nextval('issue_numeric_id_seq'),
    project_key VARCHAR(50) NOT NULL,
    status_name VARCHAR(100),
    assignee_name VARCHAR(100),
    issuetype_name VARCHAR(100),
    priority_name VARCHAR(100),
    summary TEXT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    name VARCHAR(100) PRIMARY KEY,
    email VARCHAR(255),
    data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(50) PRIMARY KEY,
    issue_key VARCHAR(100) NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_log (
    id SERIAL PRIMARY KEY,
    logged_at TIMESTAMPTZ DEFAULT NOW(),
    method VARCHAR(10) NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms FLOAT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues (project_key);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues (status_name);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues (assignee_name);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments (issue_key);
"""


class PostgresStore:
    def __init__(self, dsn):
        self.dsn = dsn
        self.pool = ThreadedConnectionPool(1, 10, dsn=dsn)

    @contextmanager
    def _conn(self, commit=True):
        conn = self.pool.getconn()
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            try:
                yield cur
                if commit:
                    conn.commit()
                else:
                    conn.rollback()
            except Exception:
                conn.rollback()
                raise
            finally:
                cur.close()
        finally:
            self.pool.putconn(conn)

    # ------------------------------------------------------------------ schema
    def init_tables(self):
        with self._conn() as cur:
            cur.execute(DDL)

    def clear_all(self):
        with self._conn() as cur:
            cur.execute("DELETE FROM comments;")
            cur.execute("DELETE FROM issues;")
            cur.execute("DELETE FROM project_counters;")
            cur.execute("DELETE FROM projects;")
            cur.execute("DELETE FROM users;")
            cur.execute("DELETE FROM request_log;")
            cur.execute("ALTER SEQUENCE issue_numeric_id_seq RESTART WITH 10001;")

    # ---------------------------------------------------------------- projects
    def get_project(self, key) -> Optional[dict]:
        with self._conn(commit=False) as cur:
            cur.execute(
                "SELECT data FROM projects WHERE UPPER(key) = UPPER(%s);", (key,)
            )
            row = cur.fetchone()
            return row["data"] if row else None

    def list_projects(self) -> list:
        with self._conn(commit=False) as cur:
            cur.execute("SELECT data FROM projects ORDER BY key;")
            return [row["data"] for row in cur.fetchall()]

    def save_project(self, project: dict):
        key = project["key"]
        name = project.get("name")
        with self._conn() as cur:
            cur.execute(
                """
                INSERT INTO projects (key, name, data)
                VALUES (%s, %s, %s)
                ON CONFLICT (key) DO UPDATE
                    SET name = EXCLUDED.name,
                        data = EXCLUDED.data;
                """,
                (key, name, Json(project)),
            )

    def next_issue_key_and_id(self, project_key):
        """Atomic: bump the per-project counter and grab a numeric id."""
        with self._conn() as cur:
            cur.execute(
                """
                INSERT INTO project_counters (project_key, next_number)
                VALUES (%s, 2)
                ON CONFLICT (project_key) DO UPDATE
                    SET next_number = project_counters.next_number + 1
                RETURNING next_number;
                """,
                (project_key,),
            )
            next_number = cur.fetchone()["next_number"]
            number = next_number - 1
            cur.execute("SELECT nextval('issue_numeric_id_seq') AS nid;")
            numeric_id = cur.fetchone()["nid"]
            return (f"{project_key}-{number}", numeric_id)

    # ------------------------------------------------------------------ issues
    def save_issue(self, issue: dict):
        data = issue
        fields = data["fields"]
        numeric_id = int(data["id"])
        key = data["key"]
        project_key = fields["project"]["key"]
        status_name = fields["status"]["name"]
        assignee = fields.get("assignee")
        assignee_name = assignee["name"] if assignee else None
        issuetype_name = fields["issuetype"]["name"]
        priority_name = fields["priority"]["name"]
        summary = fields["summary"]
        with self._conn() as cur:
            cur.execute(
                """
                INSERT INTO issues (
                    key, numeric_id, project_key, status_name, assignee_name,
                    issuetype_name, priority_name, summary, data, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (key) DO UPDATE
                    SET numeric_id = EXCLUDED.numeric_id,
                        project_key = EXCLUDED.project_key,
                        status_name = EXCLUDED.status_name,
                        assignee_name = EXCLUDED.assignee_name,
                        issuetype_name = EXCLUDED.issuetype_name,
                        priority_name = EXCLUDED.priority_name,
                        summary = EXCLUDED.summary,
                        data = EXCLUDED.data,
                        updated_at = NOW();
                """,
                (
                    key,
                    numeric_id,
                    project_key,
                    status_name,
                    assignee_name,
                    issuetype_name,
                    priority_name,
                    summary,
                    Json(data),
                ),
            )

    def get_issue_by_key(self, key) -> Optional[dict]:
        with self._conn(commit=False) as cur:
            cur.execute("SELECT data FROM issues WHERE key = %s;", (key,))
            row = cur.fetchone()
            return row["data"] if row else None

    def get_issue_by_numeric_id(self, numeric_id: int) -> Optional[dict]:
        with self._conn(commit=False) as cur:
            cur.execute(
                "SELECT data FROM issues WHERE numeric_id = %s;", (numeric_id,)
            )
            row = cur.fetchone()
            return row["data"] if row else None

    def list_all_issues(self) -> list:
        with self._conn(commit=False) as cur:
            cur.execute("SELECT data FROM issues ORDER BY created_at DESC;")
            return [row["data"] for row in cur.fetchall()]

    def delete_issue(self, key) -> bool:
        with self._conn() as cur:
            cur.execute("DELETE FROM comments WHERE issue_key = %s;", (key,))
            cur.execute("DELETE FROM issues WHERE key = %s;", (key,))
            return cur.rowcount > 0

    # ------------------------------------------------------------------- users
    def get_user_by_name(self, name) -> Optional[dict]:
        with self._conn(commit=False) as cur:
            cur.execute(
                "SELECT data FROM users WHERE UPPER(name) = UPPER(%s);", (name,)
            )
            row = cur.fetchone()
            return row["data"] if row else None

    def get_user_by_email(self, email) -> Optional[dict]:
        with self._conn(commit=False) as cur:
            cur.execute(
                "SELECT data FROM users WHERE UPPER(email) = UPPER(%s);", (email,)
            )
            row = cur.fetchone()
            return row["data"] if row else None

    def list_users(self, query=None) -> list:
        with self._conn(commit=False) as cur:
            if query:
                like = f"%{query}%"
                cur.execute(
                    """
                    SELECT data FROM users
                    WHERE name ILIKE %s
                       OR data->>'displayName' ILIKE %s
                       OR email ILIKE %s
                    ORDER BY name;
                    """,
                    (like, like, like),
                )
            else:
                cur.execute("SELECT data FROM users ORDER BY name;")
            return [row["data"] for row in cur.fetchall()]

    def save_user(self, user: dict):
        name = user["name"]
        email = user.get("emailAddress") or user.get("email")
        with self._conn() as cur:
            cur.execute(
                """
                INSERT INTO users (name, email, data)
                VALUES (%s, %s, %s)
                ON CONFLICT (name) DO UPDATE
                    SET email = EXCLUDED.email,
                        data = EXCLUDED.data;
                """,
                (name, email, Json(user)),
            )

    # ---------------------------------------------------------------- comments
    def get_comments(self, issue_key) -> list:
        with self._conn(commit=False) as cur:
            cur.execute(
                "SELECT data FROM comments WHERE issue_key = %s ORDER BY created_at;",
                (issue_key,),
            )
            return [row["data"] for row in cur.fetchall()]

    def add_comment(self, issue_key, comment: dict):
        with self._conn() as cur:
            cur.execute(
                """
                INSERT INTO comments (id, issue_key, data)
                VALUES (%s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                    SET issue_key = EXCLUDED.issue_key,
                        data = EXCLUDED.data;
                """,
                (comment["id"], issue_key, Json(comment)),
            )

    # ------------------------------------------------------------- request log
    def add_to_request_log(self, entry: dict):
        with self._conn() as cur:
            cur.execute(
                """
                INSERT INTO request_log (method, path, status_code, duration_ms)
                VALUES (%s, %s, %s, %s);
                """,
                (
                    entry["method"],
                    entry["path"],
                    entry["status_code"],
                    entry["duration_ms"],
                ),
            )

    def get_request_log(self, limit=50) -> list:
        with self._conn(commit=False) as cur:
            cur.execute(
                """
                SELECT method, path, status_code, duration_ms, logged_at
                FROM request_log
                ORDER BY id DESC
                LIMIT %s;
                """,
                (limit,),
            )
            rows = cur.fetchall()
            result = []
            for row in rows:
                entry = dict(row)
                logged_at = entry.get("logged_at")
                if logged_at is not None and not isinstance(logged_at, str):
                    entry["logged_at"] = logged_at.isoformat()
                result.append(entry)
            return result


# --------------------------------------------------------------- module state
store: Optional[PostgresStore] = None


def get_db():
    return store
