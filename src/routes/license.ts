/**
 * License stub endpoint for the Mock Jira Server (Server flavor).
 *
 * Mounted under the /rest/plugins prefix in app.ts, giving the full path:
 *     GET /rest/plugins/applications/1.0/installed/jira-software/license
 */

import { FastifyInstance } from "fastify";

import * as shapes from "../shapes";

export async function licenseRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/applications/1.0/installed/jira-software/license", async (_request, reply) => {
    return reply.send(shapes.licenseStub());
  });
}
