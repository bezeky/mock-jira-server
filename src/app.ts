/**
 * Fastify application factory for the Mock Jira Server (Server / Data Center
 * flavor).
 *
 * Builds the app, wires the auth + request-log hooks and all route plugins.
 * Connecting to PostgreSQL, seeding, and listening happen in index.ts so
 * tests can build the app against an injected in-memory store.
 */

import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";

import { getDb } from "./store";
import { issueRoutes } from "./routes/issues";
import { projectRoutes } from "./routes/projects";
import { userRoutes } from "./routes/users";
import { metaRoutes } from "./routes/meta";
import { searchRoutes } from "./routes/search";
import { licenseRoutes } from "./routes/license";
import { adminRoutes } from "./admin/router";

// Paths that skip auth processing and request logging entirely.
export const SKIP_PREFIXES = [
  "/admin",
  "/api/admin",
  "/docs",
  "/redoc",
  "/openapi.json",
  "/favicon.ico",
];

/**
 * Extract a username from an Authorization header value.
 *
 * Basic `base64(user:pass)` -> the part before ":".
 * Bearer `<token>` -> the literal "token-user".
 * Missing/malformed -> "anonymous".
 */
export function usernameFromHeader(authHeader: string | undefined | null): string {
  if (!authHeader) {
    return "anonymous";
  }

  const idx = authHeader.indexOf(" ");
  if (idx === -1) {
    return "anonymous";
  }

  const scheme = authHeader.slice(0, idx).trim();
  const value = authHeader.slice(idx + 1).trim();
  const schemeLower = scheme.toLowerCase();

  if (schemeLower === "basic") {
    let decoded: string;
    try {
      decoded = Buffer.from(value, "base64").toString("utf-8");
    } catch {
      return "anonymous";
    }
    // username is everything before the first ':'
    const username = decoded.split(":")[0];
    return username || "anonymous";
  }

  if (schemeLower === "bearer") {
    return "token-user";
  }

  return "anonymous";
}

/** The percent-decoded path, matching what an ASGI server handed Starlette. */
function pathOf(url: string): string {
  const raw = url.split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function isSkipPath(url: string): boolean {
  const path = pathOf(url);
  return SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  });

  // Tolerant body parsing: any JSON-ish body parses to an object, anything
  // malformed or empty parses to null instead of erroring — handlers apply
  // the same "dict or {}" fallback the Python _read_json helper used.
  const tolerantJsonParser = (
    _req: unknown,
    body: string | Buffer,
    done: (err: Error | null, result?: unknown) => void
  ) => {
    const text = typeof body === "string" ? body : body.toString("utf-8");
    if (!text) {
      done(null, null);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(null, null);
    }
  };
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "string" }, tolerantJsonParser);
  app.addContentTypeParser("*", { parseAs: "string" }, tolerantJsonParser);

  await app.register(cors);

  // Route registry backing GET /docs.
  const routeList: Array<{ method: string; path: string }> = [];
  app.decorate("routeList", routeList);
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") {
        continue;
      }
      routeList.push({ method, path: route.url });
    }
  });

  app.decorateRequest("authUsername", "");
  app.decorateRequest("authUser", null);

  // Auth hook. Never rejects: extracts a username from the Authorization
  // header (Basic or Bearer), looks the user up in the store, and stashes
  // both on the request for downstream handlers. Any malformed header falls
  // back to the "anonymous" username.
  app.addHook("onRequest", async (request) => {
    if (isSkipPath(request.url)) {
      return;
    }

    const username = usernameFromHeader(request.headers.authorization);

    let user: any = null;
    try {
      const db = getDb();
      if (db) {
        user = await db.getUserByName(username);
        if (user == null) {
          const users = await db.listUsers();
          if (users.length) {
            user = users[0];
          }
        }
      }
    } catch {
      user = null;
    }

    (request as any).authUsername = username;
    (request as any).authUser = user;
  });

  // Request-log hook. Times each request and writes a row to the
  // request_log table via the store. Every failure (including a missing
  // store) is swallowed so logging can never break the actual response.
  app.addHook("onResponse", async (request, reply) => {
    if (isSkipPath(request.url)) {
      return;
    }

    try {
      const db = getDb();
      if (db) {
        const durationMs = reply.elapsedTime;
        await db.addToRequestLog({
          method: request.method,
          path: pathOf(request.url),
          status_code: reply.statusCode,
          duration_ms: Math.round(durationMs * 100) / 100,
        });
      }
    } catch {
      // Logging must never break the response.
    }
  });

  app.get("/", async (_request, reply) => {
    return reply.send({
      name: "Mock Jira Server",
      admin: "/admin",
      docs: "/docs",
      api: "/rest/api/2",
    });
  });

  // Unknown paths answer with the same body FastAPI produced.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ detail: "Not Found" });
  });

  await app.register(metaRoutes, { prefix: "/rest/api/2" });
  await app.register(projectRoutes, { prefix: "/rest/api/2" });
  await app.register(issueRoutes, { prefix: "/rest/api/2" });
  await app.register(searchRoutes, { prefix: "/rest/api/2" });
  await app.register(userRoutes, { prefix: "/rest/api/2" });
  await app.register(licenseRoutes, { prefix: "/rest/plugins" });
  await app.register(adminRoutes);

  return app;
}
