/**
 * Meta / read-only endpoints for the Mock Jira Server (Server flavor).
 *
 * Routes here are mounted under the /rest/api/2 prefix in app.ts:
 *     GET /serverInfo, GET /myself, GET /priority, GET /field,
 *     GET /status, GET /issuetype, GET /issue/:key/changelog
 */

import { FastifyInstance } from "fastify";

import * as shapes from "../shapes";
import { getDb } from "../store";
import { resolveIssue } from "./issues";

export async function metaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/serverInfo", async (_request, reply) => {
    return reply.send(shapes.serverInfo());
  });

  fastify.get("/myself", async (request, reply) => {
    let user = (request as any).authUser ?? null;
    if (user == null) {
      const db = getDb();
      if (db) {
        const users = await db.listUsers();
        if (users.length) {
          user = users[0];
        }
      }
    }
    return reply.send(shapes.myselfShape(user));
  });

  fastify.get("/priority", async (_request, reply) => {
    return reply.send(shapes.priorityList());
  });

  fastify.get("/field", async (_request, reply) => {
    return reply.send(shapes.fieldList());
  });

  fastify.get("/status", async (_request, reply) => {
    return reply.send(shapes.statusList());
  });

  fastify.get("/issuetype", async (_request, reply) => {
    return reply.send(shapes.issuetypeList());
  });

  // Minimal changelog stub. This mock does not track field history, so an
  // empty `histories` array is the correct answer for any existing issue.
  fastify.get("/issue/:key/changelog", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = db ? await resolveIssue(db, key) : null;
    if (issue == null) {
      return reply.code(404).send(shapes.errorBody("Issue Does Not Exist"));
    }
    return reply.send({
      startAt: 0,
      maxResults: 50,
      total: 0,
      histories: [],
    });
  });
}
