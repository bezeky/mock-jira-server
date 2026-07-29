/**
 * Hermetic Vitest fixtures for the Mock Jira Server (Server / Data Center).
 *
 * These tests run WITHOUT a real PostgreSQL: an in-memory FakeStore that
 * implements the same public surface as PostgresStore is assigned onto the
 * store singleton before the app is built, so the whole app talks to the
 * fake. index.ts (which would otherwise connect to Postgres) is never
 * imported by tests.
 */

import { FastifyInstance } from "fastify";

import { buildApp, BuildAppOptions } from "../src/app";
import { setDb, Store } from "../src/store";
import { loadSeedData } from "../src/seed";

/**
 * In-memory stand-in for PostgresStore.
 *
 * Mirrors the same public methods/signatures. Backed by plain objects/arrays.
 * `nextIssueKeyAndId` reproduces PostgresStore's counter arithmetic exactly:
 * a per-project counter (first issue -> number 1) and a numeric id sequence
 * starting at 10001.
 */
export class FakeStore implements Store {
  // Null-prototype maps so an issue/user/project key that collides with an
  // Object.prototype member ("constructor", "toString") misses like a Python
  // dict lookup instead of resolving an inherited function.
  private projects: Record<string, any> = Object.create(null); // key -> stored project dict
  private issues: Record<string, any> = Object.create(null); // key -> full issue dict
  private issueOrder: string[] = []; // insertion order of issue keys
  private users: Record<string, any> = Object.create(null); // name -> stored user dict
  private commentsByIssue: Record<string, any[]> = Object.create(null); // issue_key -> comments
  private requestLog: any[] = []; // oldest first
  private counters: Record<string, number> = Object.create(null); // project_key -> next_number
  private nextNumeric = 10001; // nextval('issue_numeric_id_seq')

  // ------------------------------------------------------------------ schema
  async initTables(): Promise<void> {
    return;
  }

  async clearAll(): Promise<void> {
    this.projects = Object.create(null);
    this.issues = Object.create(null);
    this.issueOrder = [];
    this.users = Object.create(null);
    this.commentsByIssue = Object.create(null);
    this.requestLog = [];
    this.counters = Object.create(null);
    this.nextNumeric = 10001;
  }

  // ---------------------------------------------------------------- projects
  async getProject(key: any): Promise<any | null> {
    if (key == null) {
      return null;
    }
    for (const [pkey, data] of Object.entries(this.projects)) {
      if (pkey.toUpperCase() === String(key).toUpperCase()) {
        return data;
      }
    }
    return null;
  }

  async getProjectById(pid: any): Promise<any | null> {
    if (pid == null) {
      return null;
    }
    for (const data of Object.values(this.projects)) {
      if (String(data.id) === String(pid)) {
        return data;
      }
    }
    return null;
  }

  async listProjects(): Promise<any[]> {
    return Object.keys(this.projects)
      .sort()
      .map((k) => this.projects[k]);
  }

  async saveProject(project: any): Promise<void> {
    this.projects[project.key] = project;
  }

  async nextIssueKeyAndId(projectKey: string): Promise<[string, number]> {
    const current = this.counters[projectKey];
    const n = current === undefined ? 2 : current + 1;
    this.counters[projectKey] = n;
    const number = n - 1;
    const numericId = this.nextNumeric;
    this.nextNumeric += 1;
    return [`${projectKey}-${number}`, numericId];
  }

  // ------------------------------------------------------------------ issues
  async saveIssue(issue: any): Promise<void> {
    const key = issue.key;
    if (!(key in this.issues)) {
      this.issueOrder.push(key);
    }
    this.issues[key] = issue;
  }

  async getIssueByKey(key: any): Promise<any | null> {
    return this.issues[key] ?? null;
  }

  async getIssueByNumericId(numericId: number): Promise<any | null> {
    for (const data of Object.values(this.issues)) {
      const parsed = parseInt(String(data.id), 10);
      if (!Number.isNaN(parsed) && parsed === Number(numericId)) {
        return data;
      }
    }
    return null;
  }

  async listAllIssues(): Promise<any[]> {
    // Newest-first (created_at DESC) == reverse insertion order.
    return [...this.issueOrder]
      .reverse()
      .filter((k) => k in this.issues)
      .map((k) => this.issues[k]);
  }

  async deleteIssue(key: any): Promise<boolean> {
    if (key in this.issues) {
      delete this.issues[key];
      const idx = this.issueOrder.indexOf(key);
      if (idx !== -1) {
        this.issueOrder.splice(idx, 1);
      }
      delete this.commentsByIssue[key];
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- users
  async getUserByName(name: any): Promise<any | null> {
    if (name == null) {
      return null;
    }
    for (const [uname, data] of Object.entries(this.users)) {
      if (uname.toLowerCase() === String(name).toLowerCase()) {
        return data;
      }
    }
    return null;
  }

  async getUserByEmail(email: any): Promise<any | null> {
    if (email == null) {
      return null;
    }
    const target = String(email).toLowerCase();
    for (const data of Object.values(this.users)) {
      const addr = data.emailAddress || data.email;
      if (addr && String(addr).toLowerCase() === target) {
        return data;
      }
    }
    return null;
  }

  async listUsers(query?: string | null): Promise<any[]> {
    const users = Object.keys(this.users)
      .sort()
      .map((n) => this.users[n]);
    if (!query) {
      return users;
    }
    const q = String(query).toLowerCase();
    const hit = (u: any): boolean =>
      String(u.name ?? "").toLowerCase().includes(q) ||
      String(u.displayName ?? "").toLowerCase().includes(q) ||
      String(u.emailAddress ?? u.email ?? "").toLowerCase().includes(q);
    return users.filter(hit);
  }

  async saveUser(user: any): Promise<void> {
    this.users[user.name] = user;
  }

  // ---------------------------------------------------------------- comments
  async getComments(issueKey: string): Promise<any[]> {
    return [...(this.commentsByIssue[issueKey] ?? [])];
  }

  async addComment(issueKey: string, comment: any): Promise<void> {
    const bucket = (this.commentsByIssue[issueKey] ??= []);
    const cid = comment.id;
    for (let i = 0; i < bucket.length; i++) {
      if (bucket[i].id === cid) {
        bucket[i] = comment;
        return;
      }
    }
    bucket.push(comment);
  }

  // ------------------------------------------------------------- request log
  async addToRequestLog(entry: any): Promise<void> {
    this.requestLog.push({ ...entry });
  }

  async getRequestLog(limit = 50): Promise<any[]> {
    return [...this.requestLog].reverse().slice(0, limit);
  }
}

export interface TestClient {
  app: FastifyInstance;
  store: FakeStore;
}

/** An app backed by a freshly seeded in-memory FakeStore. */
export async function makeClient(opts: BuildAppOptions = {}): Promise<TestClient> {
  const store = new FakeStore();
  setDb(store);
  await loadSeedData(store);
  const app = await buildApp(opts);
  await app.ready();
  return { app, store };
}

export async function closeClient(client: TestClient): Promise<void> {
  await client.app.close();
  setDb(null);
}
