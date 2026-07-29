/**
 * Project endpoints for the Mock Jira Server (Server / Data Center flavor).
 *
 * Registered under the /rest/api/2 prefix in app.ts. Every handler accesses
 * the store lazily via getDb() so the live singleton (assigned at startup)
 * is used.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import * as shapes from "../shapes";
import { getDb } from "../store";
import { readJson } from "./issues";

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/project", async (_request, reply) => {
    const db = getDb();
    const projects = db ? await db.listProjects() : [];
    return reply.send(projects.map((p) => shapes.projectShape(p)));
  });

  fastify.get("/project/:key", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const project = db ? await db.getProject(key) : null;
    if (project == null) {
      return reply
        .code(404)
        .send(shapes.errorBody(`No project could be found with key '${key}'.`));
    }
    return reply.send(shapes.projectShape(project));
  });

  fastify.post("/project", async (request, reply) => {
    const db = getDb();
    const body = readJson(request);

    const existing = db ? await db.listProjects() : [];
    const stored = {
      id: String(10000 + existing.length),
      key: body.key ?? null,
      name: body.name ?? null,
      projectTypeKey: body.projectTypeKey === undefined ? "software" : body.projectTypeKey,
      lead: body.lead === undefined ? "admin" : body.lead,
    };
    if (db) {
      await db.saveProject(stored);
    }
    return reply.code(201).send(shapes.projectShape(stored));
  });

  const getProjectStatuses = async (request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const project = db ? await db.getProject(key) : null;
    if (project == null) {
      return reply
        .code(404)
        .send(shapes.errorBody(`No project could be found with key '${key}'.`));
    }
    return reply.send(shapes.projectStatusesPayload());
  };

  fastify.get("/project/:key/statuses", getProjectStatuses);
  fastify.get("/Project/:key/statuses", getProjectStatuses);
}
