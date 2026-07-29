/**
 * User lookup endpoints for the mock Jira Server (Server / Data Center
 * flavor).
 *
 * Users are looked up by `username` or `key` (both are username strings on
 * Server). User objects use "name"/"key" and NEVER emit accountId/
 * accountType/locale. The store singleton is resolved lazily via getDb()
 * inside each handler.
 */

import { FastifyInstance } from "fastify";

import * as shapes from "../shapes";
import { getDb } from "../store";

/** A scalar query param: a repeated key resolves to its LAST occurrence. */
function scalarParam(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    return v.length ? String(v[v.length - 1]) : undefined;
  }
  return v === undefined || v === null ? undefined : String(v);
}

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/user", async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const username = scalarParam(q.username);
    const key = scalarParam(q.key);
    const lookup = username || key;
    const db = getDb();
    const user = db && lookup ? await db.getUserByName(lookup) : null;
    if (user == null) {
      return reply
        .code(404)
        .send(shapes.errorBody(`The user named '${lookup || ""}' does not exist`));
    }
    return reply.send(shapes.userShape(user));
  });

  fastify.get("/user/search", async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const query = scalarParam(q.query) ?? "";
    const db = getDb();
    const users = db ? await db.listUsers(query) : [];
    return reply.send(users.map((u) => shapes.userShape(u)));
  });
}
