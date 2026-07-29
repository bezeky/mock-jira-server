/**
 * Search endpoints (GET/POST /search) for the mock Jira Server.
 *
 * JQL is executed in pure TypeScript over the stored issue dicts returned by
 * `store.listAllIssues()`. The store singleton is resolved lazily inside
 * each handler via getDb() so it always reads the live module global.
 */

import { FastifyInstance, FastifyRequest } from "fastify";

import * as shapes from "../shapes";
import { executeJql } from "../jql";
import { getDb } from "../store";
import { readJson } from "./issues";

/** A scalar query param: a repeated key resolves to its LAST occurrence. */
function scalarParam(v: unknown): unknown {
  return Array.isArray(v) ? (v.length ? v[v.length - 1] : undefined) : v;
}

function toInt(v: unknown, fallback: number): number {
  const scalar = scalarParam(v);
  if (scalar === undefined || scalar === null) {
    return fallback;
  }
  const n = parseInt(String(scalar), 10);
  return Number.isNaN(n) ? fallback : n;
}

function toStr(v: unknown, fallback: string): string {
  const scalar = scalarParam(v);
  if (scalar === undefined || scalar === null) {
    return fallback;
  }
  return String(scalar);
}

async function runSearch(
  jql: string,
  maxResults: number,
  startAt: number,
  username: string
): Promise<any> {
  const db = getDb();
  const allIssues = db ? await db.listAllIssues() : [];
  const matched = executeJql(jql, allIssues, username);
  const total = matched.length;
  const page = matched.slice(startAt, startAt + maxResults);
  return shapes.searchPayload(page, startAt, maxResults, total);
}

function usernameOf(request: FastifyRequest): string {
  return ((request as any).authUsername as string) || "anonymous";
}

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/search", async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const jql = toStr(q.jql, "");
    const maxResults = toInt(q.maxResults, 50);
    const startAt = toInt(q.startAt, 0);
    const payload = await runSearch(jql, maxResults, startAt, usernameOf(request));
    return reply.send(payload);
  });

  fastify.post("/search", async (request, reply) => {
    const body = readJson(request);
    const jql = typeof body.jql === "string" ? body.jql : "";
    const maxResults = toInt(body.maxResults, 50);
    const startAt = toInt(body.startAt, 0);
    const payload = await runSearch(jql, maxResults, startAt, usernameOf(request));
    return reply.send(payload);
  });
}
