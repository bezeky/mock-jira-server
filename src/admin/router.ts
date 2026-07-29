/**
 * Admin dashboard routes for the Mock Jira Server.
 *
 * Mounted in app.ts with NO prefix, so the routes are exactly:
 *
 *     GET    /admin                  -> serves the dashboard HTML
 *     GET    /api/admin/data         -> live dashboard JSON (stats, issues, request log)
 *     GET    /api/admin/issue/:key   -> single issue detail (description, comments)
 *     DELETE /api/admin/reset        -> wipe + reseed the store
 *     GET    /docs                   -> JSON listing of all registered routes
 *
 * The store singleton is accessed via getDb() INSIDE each handler (never
 * bound at import time), following the project-wide singleton access pattern.
 */

import { promises as fs } from "fs";
import path from "path";

import { FastifyInstance } from "fastify";

import { getDb } from "../store";
import { loadSeedData } from "../seed";
import { resolveIssue } from "../routes/issues";

/** Derive a flat dashboard row from a stored (full) issue dict. */
function issueRow(issue: any): any {
  const fields = issue.fields || {};
  const status = fields.status || {};
  const category = status.statusCategory || {};
  const priority = fields.priority || {};
  const project = fields.project || {};
  const issuetype = fields.issuetype || {};
  const assignee = fields.assignee;
  const assigneeName = assignee ? assignee.displayName : "Unassigned";
  return {
    key: issue.key ?? null,
    summary: fields.summary ?? null,
    status: status.name ?? null,
    status_category_key: category.key ?? null,
    priority: priority.name ?? null,
    project_key: project.key ?? null,
    project_name: project.name ?? null,
    assignee: assigneeName || "Unassigned",
    issuetype: issuetype.name ?? null,
    created: fields.created ?? null,
    description: fields.description ?? null,
    comments: (fields.comment || {}).comments ?? [],
    reporter: (fields.reporter || {}).displayName ?? "",
    updated: fields.updated ?? "",
  };
}

function logRow(entry: any): any {
  return {
    timestamp: entry.logged_at ?? null,
    method: entry.method ?? null,
    path: entry.path ?? null,
    status_code: entry.status_code ?? null,
    duration_ms: entry.duration_ms ?? null,
  };
}

async function readDashboardHtml(): Promise<Buffer> {
  // Compiled layout (dist/admin) first; source layout (src/admin) as the
  // fallback when running the TypeScript directly via tsx.
  const candidates = [
    path.join(__dirname, "dashboard.html"),
    path.join(__dirname, "..", "..", "src", "admin", "dashboard.html"),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/admin", async (_request, reply) => {
    const html = await readDashboardHtml();
    return reply.type("text/html; charset=utf-8").send(html);
  });

  fastify.get("/api/admin/data", async (_request, reply) => {
    const db = getDb();
    if (!db) {
      return reply.send({
        stats: {
          total_projects: 0,
          total_issues: 0,
          total_requests: 0,
          in_progress_issues: 0,
        },
        issues: [],
        request_log: [],
      });
    }

    const projects = await db.listProjects();
    // limit to 100 newest; full-text descriptions make larger
    // result sets too slow for the dashboard polling interval
    const allIssues = (await db.listAllIssues()).slice(0, 100); // already newest-first (created_at DESC)

    let inProgress = 0;
    const issueRows: any[] = [];
    for (const issue of allIssues) {
      const row = issueRow(issue);
      if (row.status === "In Progress") {
        inProgress += 1;
      }
      issueRows.push(row);
    }

    const totalRequests = (await db.getRequestLog(1000000)).length;
    const requestLog = (await db.getRequestLog(50)).map(logRow);

    return reply.send({
      stats: {
        total_projects: projects.length,
        total_issues: allIssues.length,
        total_requests: totalRequests,
        in_progress_issues: inProgress,
      },
      issues: issueRows,
      request_log: requestLog,
    });
  });

  fastify.get("/api/admin/issue/:key", async (request, reply) => {
    const db = getDb();
    if (!db) {
      return reply.code(503).send({ error: "store not ready" });
    }
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return reply.code(404).send({ error: "not found" });
    }
    const row = issueRow(issue);
    // Full description and comments for the detail view (description coerced
    // to "" so the panel never has to render null).
    const fields = issue.fields || {};
    row.description = fields.description || "";
    row.comments = (fields.comment || {}).comments ?? [];
    row.reporter = (fields.reporter || {}).displayName ?? "";
    row.created = fields.created ?? "";
    row.updated = fields.updated ?? "";
    return reply.send(row);
  });

  fastify.delete("/api/admin/reset", async (_request, reply) => {
    const db = getDb();
    if (db) {
      await db.clearAll();
      await loadSeedData(db);
    }
    return reply.send({ status: "reset" });
  });

  fastify.get("/docs", async (_request, reply) => {
    return reply.send({
      name: "Mock Jira Server",
      routes: (fastify as any).routeList ?? [],
    });
  });
}
