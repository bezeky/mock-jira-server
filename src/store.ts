/**
 * PostgreSQL-backed store for the mock Jira Server.
 *
 * Uses pg (node-postgres) directly. All JSONB payloads are stored as
 * serialized JSON parameters; reads return JSONB already parsed as objects.
 * No database connection or work happens at import time.
 */

import { Pool, PoolClient } from "pg";

export const DDL = `
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
`;

/**
 * Public store surface. PostgresStore implements it for production; tests
 * inject an in-memory FakeStore with the same methods.
 */
export interface Store {
  initTables(): Promise<void>;
  clearAll(): Promise<void>;
  getProject(key: any): Promise<any | null>;
  getProjectById(pid: any): Promise<any | null>;
  listProjects(): Promise<any[]>;
  saveProject(project: any): Promise<void>;
  nextIssueKeyAndId(projectKey: string): Promise<[string, number]>;
  saveIssue(issue: any): Promise<void>;
  getIssueByKey(key: any): Promise<any | null>;
  getIssueByNumericId(numericId: number): Promise<any | null>;
  listAllIssues(): Promise<any[]>;
  deleteIssue(key: any): Promise<boolean>;
  getUserByName(name: any): Promise<any | null>;
  getUserByEmail(email: any): Promise<any | null>;
  listUsers(query?: string | null): Promise<any[]>;
  saveUser(user: any): Promise<void>;
  getComments(issueKey: string): Promise<any[]>;
  addComment(issueKey: string, comment: any): Promise<void>;
  addToRequestLog(entry: any): Promise<void>;
  getRequestLog(limit?: number): Promise<any[]>;
}

export class PostgresStore implements Store {
  readonly dsn: string;
  readonly pool: Pool;

  constructor(dsn: string) {
    this.dsn = dsn;
    this.pool = new Pool({ connectionString: dsn, min: 2, max: 30 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async withConn<T>(
    fn: (cur: PoolClient) => Promise<T>,
    commit = true
  ): Promise<T> {
    const conn = await this.pool.connect();
    try {
      await conn.query("BEGIN");
      let result: T;
      try {
        result = await fn(conn);
      } catch (err) {
        await conn.query("ROLLBACK");
        throw err;
      }
      await conn.query(commit ? "COMMIT" : "ROLLBACK");
      return result;
    } finally {
      conn.release();
    }
  }

  // ------------------------------------------------------------------ schema
  async initTables(): Promise<void> {
    await this.withConn(async (cur) => {
      await cur.query(DDL);
    });
  }

  async clearAll(): Promise<void> {
    await this.withConn(async (cur) => {
      await cur.query("DELETE FROM comments;");
      await cur.query("DELETE FROM issues;");
      await cur.query("DELETE FROM project_counters;");
      await cur.query("DELETE FROM projects;");
      await cur.query("DELETE FROM users;");
      await cur.query("DELETE FROM request_log;");
      await cur.query("ALTER SEQUENCE issue_numeric_id_seq RESTART WITH 10001;");
    });
  }

  // ---------------------------------------------------------------- projects
  async getProject(key: any): Promise<any | null> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        "SELECT data FROM projects WHERE UPPER(key) = UPPER($1);",
        [key]
      );
      return res.rows.length ? res.rows[0].data : null;
    }, false);
  }

  /**
   * Look up a project by its numeric id (stored inside the JSONB data blob,
   * e.g. "10000" for APIRE — there is no dedicated id column).
   */
  async getProjectById(pid: any): Promise<any | null> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        "SELECT data FROM projects WHERE data->>'id' = $1;",
        [String(pid)]
      );
      return res.rows.length ? res.rows[0].data : null;
    }, false);
  }

  async listProjects(): Promise<any[]> {
    return this.withConn(async (cur) => {
      const res = await cur.query("SELECT data FROM projects ORDER BY key;");
      return res.rows.map((row: any) => row.data);
    }, false);
  }

  async saveProject(project: any): Promise<void> {
    const key = project.key;
    const name = project.name ?? null;
    await this.withConn(async (cur) => {
      await cur.query(
        `
        INSERT INTO projects (key, name, data)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE
            SET name = EXCLUDED.name,
                data = EXCLUDED.data;
        `,
        [key, name, JSON.stringify(project)]
      );
    });
  }

  /** Atomic: bump the per-project counter and grab a numeric id. */
  async nextIssueKeyAndId(projectKey: string): Promise<[string, number]> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        `
        INSERT INTO project_counters (project_key, next_number)
        VALUES ($1, 2)
        ON CONFLICT (project_key) DO UPDATE
            SET next_number = project_counters.next_number + 1
        RETURNING next_number;
        `,
        [projectKey]
      );
      const nextNumber: number = res.rows[0].next_number;
      const number = nextNumber - 1;
      const seq = await cur.query("SELECT nextval('issue_numeric_id_seq') AS nid;");
      // BIGINT comes back from pg as a string.
      const numericId = Number(seq.rows[0].nid);
      return [`${projectKey}-${number}`, numericId] as [string, number];
    });
  }

  // ------------------------------------------------------------------ issues
  async saveIssue(issue: any): Promise<void> {
    const data = issue;
    const fields = data.fields;
    const numericId = parseInt(String(data.id), 10);
    const key = data.key;
    const projectKey = fields.project.key;
    const statusName = fields.status.name;
    const assignee = fields.assignee;
    const assigneeName = assignee ? assignee.name : null;
    const issuetypeName = fields.issuetype.name;
    const priorityName = fields.priority.name;
    const summary = fields.summary ?? null;
    await this.withConn(async (cur) => {
      await cur.query(
        `
        INSERT INTO issues (
            key, numeric_id, project_key, status_name, assignee_name,
            issuetype_name, priority_name, summary, data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
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
        `,
        [
          key,
          numericId,
          projectKey,
          statusName,
          assigneeName,
          issuetypeName,
          priorityName,
          summary,
          JSON.stringify(data),
        ]
      );
    });
  }

  async getIssueByKey(key: any): Promise<any | null> {
    return this.withConn(async (cur) => {
      const res = await cur.query("SELECT data FROM issues WHERE key = $1;", [key]);
      return res.rows.length ? res.rows[0].data : null;
    }, false);
  }

  async getIssueByNumericId(numericId: number): Promise<any | null> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        "SELECT data FROM issues WHERE numeric_id = $1;",
        [numericId]
      );
      return res.rows.length ? res.rows[0].data : null;
    }, false);
  }

  async listAllIssues(): Promise<any[]> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        "SELECT data FROM issues ORDER BY created_at DESC;"
      );
      return res.rows.map((row: any) => row.data);
    }, false);
  }

  async deleteIssue(key: any): Promise<boolean> {
    return this.withConn(async (cur) => {
      await cur.query("DELETE FROM comments WHERE issue_key = $1;", [key]);
      const res = await cur.query("DELETE FROM issues WHERE key = $1;", [key]);
      return (res.rowCount ?? 0) > 0;
    });
  }

  // ------------------------------------------------------------------- users
  async getUserByName(name: any): Promise<any | null> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        "SELECT data FROM users WHERE UPPER(name) = UPPER($1);",
        [name]
      );
      return res.rows.length ? res.rows[0].data : null;
    }, false);
  }

  async getUserByEmail(email: any): Promise<any | null> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        "SELECT data FROM users WHERE UPPER(email) = UPPER($1);",
        [email]
      );
      return res.rows.length ? res.rows[0].data : null;
    }, false);
  }

  async listUsers(query?: string | null): Promise<any[]> {
    return this.withConn(async (cur) => {
      let res;
      if (query) {
        const like = `%${query}%`;
        res = await cur.query(
          `
          SELECT data FROM users
          WHERE name ILIKE $1
             OR data->>'displayName' ILIKE $2
             OR email ILIKE $3
          ORDER BY name;
          `,
          [like, like, like]
        );
      } else {
        res = await cur.query("SELECT data FROM users ORDER BY name;");
      }
      return res.rows.map((row: any) => row.data);
    }, false);
  }

  async saveUser(user: any): Promise<void> {
    const name = user.name;
    const email = (user.emailAddress || user.email) ?? null;
    await this.withConn(async (cur) => {
      await cur.query(
        `
        INSERT INTO users (name, email, data)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO UPDATE
            SET email = EXCLUDED.email,
                data = EXCLUDED.data;
        `,
        [name, email, JSON.stringify(user)]
      );
    });
  }

  // ---------------------------------------------------------------- comments
  async getComments(issueKey: string): Promise<any[]> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        "SELECT data FROM comments WHERE issue_key = $1 ORDER BY created_at;",
        [issueKey]
      );
      return res.rows.map((row: any) => row.data);
    }, false);
  }

  async addComment(issueKey: string, comment: any): Promise<void> {
    await this.withConn(async (cur) => {
      await cur.query(
        `
        INSERT INTO comments (id, issue_key, data)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
            SET issue_key = EXCLUDED.issue_key,
                data = EXCLUDED.data;
        `,
        [comment.id, issueKey, JSON.stringify(comment)]
      );
    });
  }

  // ------------------------------------------------------------- request log
  async addToRequestLog(entry: any): Promise<void> {
    await this.withConn(async (cur) => {
      await cur.query(
        `
        INSERT INTO request_log (method, path, status_code, duration_ms)
        VALUES ($1, $2, $3, $4);
        `,
        [entry.method, entry.path, entry.status_code, entry.duration_ms]
      );
    });
  }

  async getRequestLog(limit = 50): Promise<any[]> {
    return this.withConn(async (cur) => {
      const res = await cur.query(
        `
        SELECT method, path, status_code, duration_ms, logged_at
        FROM request_log
        ORDER BY id DESC
        LIMIT $1;
        `,
        [limit]
      );
      return res.rows.map((row: any) => {
        const entry = { ...row };
        const loggedAt = entry.logged_at;
        if (loggedAt != null && typeof loggedAt !== "string") {
          entry.logged_at = (loggedAt as Date).toISOString();
        }
        return entry;
      });
    }, false);
  }
}

// --------------------------------------------------------------- module state
let _store: Store | null = null;

/**
 * Live store singleton. May hold null before startup assigns it — handlers
 * that tolerate a missing store check truthiness, mirroring the Python
 * get_db() contract.
 */
export function getDb(): Store {
  return _store as Store;
}

export function setDb(s: Store | null): void {
  _store = s;
}
