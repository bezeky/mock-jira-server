/**
 * Issue routes for the Mock Jira Server (Server / Data Center flavor).
 *
 * Implements create/read/update/delete of issues plus transitions, comments,
 * and createmeta. No prefix is applied here; app.ts mounts this plugin under
 * /rest/api/2.
 *
 * Store access follows the singleton pattern: never bind the store at import
 * time. Call `const db = getDb()` inside each handler so the live module
 * global is read after startup assigns it.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import * as shapes from "../shapes";
import { settings } from "../config";
import { getDb, Store } from "../store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up an issue by its Jira key (APIRE-1) or numeric id ("10001"). */
export async function resolveIssue(db: Store, key: string): Promise<any | null> {
  const issue = await db.getIssueByKey(key);
  if (issue != null) {
    return issue;
  }
  if (typeof key === "string" && /^\d+$/.test(key)) {
    return db.getIssueByNumericId(parseInt(key, 10));
  }
  return null;
}

/** The authenticated user (set by the auth hook), else first stored user. */
export async function currentUser(request: FastifyRequest, db: Store): Promise<any | null> {
  const user = (request as any).authUser;
  if (user != null) {
    return user;
  }
  const users = await db.listUsers();
  return users.length ? users[0] : null;
}

/**
 * Accepts {"name": "Bug"} (already worked) or {"id": "10002"} (OSM format).
 * Falls back to "Task" if neither resolves, same as the old default.
 */
function issuetypeNameFromField(issuetypeField: any): string {
  if (!issuetypeField) {
    return "Task";
  }
  const name = issuetypeField.name;
  if (name) {
    return name;
  }
  const iid = issuetypeField.id;
  if (iid !== null && iid !== undefined) {
    for (const [id, defName] of shapes.ISSUETYPE_DEFS) {
      if (id === String(iid)) {
        return defName;
      }
    }
  }
  return "Task";
}

/**
 * Accepts {"name": "High"} (already worked) or {"id": "2"} (OSM format).
 * Falls back to "Medium" if neither resolves, same as the old default.
 */
function priorityNameFromField(priorityField: any): string {
  if (!priorityField) {
    return "Medium";
  }
  const name = priorityField.name;
  if (name) {
    return name;
  }
  const pid = priorityField.id;
  if (pid !== null && pid !== undefined) {
    for (const [id, defName] of shapes.PRIORITY_DEFS) {
      if (id === String(pid)) {
        return defName;
      }
    }
  }
  return "Medium";
}

/**
 * Accepts {"name": "developer1"} (already worked) or {"key": "developer1"}
 * (Jira Server clients commonly send key). In this mock key == name for
 * every seeded user, so both look up the same users table.
 */
async function resolveAssignee(db: Store, assigneeField: any): Promise<any | null> {
  if (!assigneeField) {
    return null;
  }
  const identifier = assigneeField.name || assigneeField.key;
  if (!identifier) {
    return null;
  }
  return db.getUserByName(identifier);
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send(shapes.errorBody("Issue Does Not Exist"));
}

/** Parsed JSON body if it is an object, else {} — mirrors the tolerant reader. */
export function readJson(request: FastifyRequest): any {
  const body = request.body;
  return body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
}

/** Normalize a repeatable query param to a list of raw string groups. */
function asGroups(v: unknown): string[] | null {
  if (v === undefined || v === null) {
    return null;
  }
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** A scalar query param: a repeated key resolves to its LAST occurrence. */
function scalarParam(v: unknown): string | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (Array.isArray(v)) {
    return v.length ? String(v[v.length - 1]) : undefined;
  }
  return String(v);
}

/** Python truthiness: "", 0, null, undefined, [] and {} are all falsy. */
export function isTruthy(v: unknown): boolean {
  if (!v) {
    return false;
  }
  if (Array.isArray(v)) {
    return v.length > 0;
  }
  if (typeof v === "object") {
    return Object.keys(v as object).length > 0;
  }
  return true;
}

/** Renders a value the way Python's "%s" would, for error-message parity. */
function pyStr(v: unknown): string {
  if (v === undefined || v === null) {
    return "None";
  }
  if (v === true) {
    return "True";
  }
  if (v === false) {
    return "False";
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function issueRoutes(fastify: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------ create
  const createIssue = async (request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const body = readJson(request);
    const fields = body.fields || {};

    // Diagnostic: log the exact body every caller sends. Controlled by
    // LOG_LEVEL (default info, so this shows up by default). This is what to
    // watch with `docker compose logs -f mock-jira` while retriggering a
    // client's create-issue flow — it settles disputes about what a client
    // actually sent versus what we assumed it sent.
    request.log.info("POST /issue raw body: %j", body);

    const projectRef = fields.project || {};
    const pk = projectRef.key;
    const pid = projectRef.id;

    if (!pk && !pid) {
      return reply.code(400).send(shapes.errorBody("project is required"));
    }

    // Prefer key; fall back to numeric id. Real Jira clients commonly resolve
    // a project to its id once (e.g. via GET /project/{key}) and then send
    // {"project": {"id": "10000"}} on subsequent create-issue calls instead
    // of the key — this fallback is what makes that pattern work here too.
    let project = pk ? await db.getProject(pk) : null;
    if (project == null && pid) {
      project = await db.getProjectById(pid);
    }

    if (project == null) {
      return reply
        .code(400)
        .send(shapes.errorBody(`project '${pk || pid}' does not exist`));
    }

    const [key, nid] = await db.nextIssueKeyAndId(project.key);

    const assigneeUser = await resolveAssignee(db, fields.assignee);

    const reporter = await currentUser(request, db);
    const creator = reporter;

    const issue = shapes.buildIssue({
      key,
      numericId: nid,
      project,
      summary: fields.summary === undefined ? "" : fields.summary,
      description: fields.description ?? null,
      issuetypeName: issuetypeNameFromField(fields.issuetype),
      priorityName: priorityNameFromField(fields.priority),
      statusName: "To Do",
      assigneeUser,
      reporterUser: reporter,
      creatorUser: creator,
      created: shapes.nowJira(),
      updated: shapes.nowJira(),
      labels: fields.labels,
      duedate: fields.duedate,
    });
    await db.saveIssue(issue);

    return reply.code(201).send({
      id: issue.id,
      key: issue.key,
      self: issue.self,
    });
  };

  fastify.post("/issue", createIssue);
  fastify.post("/issues", createIssue);

  // --------------------------------------------------------- create metadata
  // Registered as a static path so it always wins over GET /issue/:key —
  // Fastify's router prefers static segments over parameters regardless of
  // registration order.
  fastify.get("/issue/createmeta", async (request, reply) => {
    // Returns field metadata for issue creation.
    // Used by DefectDojo and pycontribs/jira to validate project config.
    const db = getDb();
    const baseUrl = settings.BASE_URL;
    const q = request.query as Record<string, unknown>;
    const projectKeys = asGroups(q.projectKeys);
    const issuetypeNames = asGroups(q.issuetypeNames);
    const issuetypeIds = asGroups(q.issuetypeIds);
    const expand = scalarParam(q.expand);

    // --- Issue types master list ---
    // Ids come from the canonical shapes.ISSUETYPE_DEFS so createmeta reports
    // the same (id, name) pairs every other endpoint does (create_issue, GET
    // /issue/:key, GET /field): Task=10001, Bug=10002, Story=10003. Epic is
    // advertised for parity with a default Jira project scheme; it has no
    // canonical id, so it is appended explicitly.
    let allIssueTypes: Array<{ id: string; name: string; subtask: boolean }> =
      shapes.ISSUETYPE_DEFS.map(([id, name]) => ({ id, name, subtask: false }));
    allIssueTypes.push({ id: "10004", name: "Epic", subtask: false });

    // Filter issue types by name if requested. Query params are lists so both
    // the comma-string form (?issuetypeNames=Bug,Task) and the repeated form
    // (?issuetypeNames=Bug&issuetypeNames=Task) that pycontribs/jira emits
    // work; an empty/whitespace-only value is treated as "no filter".
    if (issuetypeNames) {
      const namesFilter = new Set(
        issuetypeNames.flatMap((group) =>
          group.split(",").map((n) => n.trim().toLowerCase()).filter((n) => n)
        )
      );
      if (namesFilter.size) {
        allIssueTypes = allIssueTypes.filter((it) => namesFilter.has(it.name.toLowerCase()));
      }
    }

    // Filter issue types by ID if requested (same multi-value handling).
    if (issuetypeIds) {
      const idsFilter = new Set(
        issuetypeIds.flatMap((group) =>
          group.split(",").map((i) => i.trim()).filter((i) => i)
        )
      );
      if (idsFilter.size) {
        allIssueTypes = allIssueTypes.filter((it) => idsFilter.has(it.id));
      }
    }

    // Determine whether to include field metadata
    const includeFields = Boolean(expand && expand.includes("projects.issuetypes.fields"));

    // Standard field metadata (returned when expand=projects.issuetypes.fields)
    const fieldsMeta = {
      summary: {
        required: true,
        schema: { type: "string", system: "summary" },
        name: "Summary",
        key: "summary",
        hasDefaultValue: false,
        operations: ["set"],
        allowedValues: [],
      },
      issuetype: {
        required: true,
        schema: { type: "issuetype", system: "issuetype" },
        name: "Issue Type",
        key: "issuetype",
        hasDefaultValue: false,
        operations: [],
        allowedValues: [],
      },
      description: {
        required: false,
        schema: { type: "string", system: "description" },
        name: "Description",
        key: "description",
        hasDefaultValue: false,
        operations: ["set"],
        allowedValues: [],
      },
      project: {
        required: true,
        schema: { type: "project", system: "project" },
        name: "Project",
        key: "project",
        hasDefaultValue: false,
        operations: ["set"],
        allowedValues: [],
      },
      priority: {
        required: false,
        schema: { type: "priority", system: "priority" },
        name: "Priority",
        key: "priority",
        hasDefaultValue: true,
        operations: ["set"],
        allowedValues: [
          { self: `${baseUrl}/rest/api/2/priority/1`, iconUrl: "", name: "Highest", id: "1" },
          { self: `${baseUrl}/rest/api/2/priority/2`, iconUrl: "", name: "High", id: "2" },
          { self: `${baseUrl}/rest/api/2/priority/3`, iconUrl: "", name: "Medium", id: "3" },
          { self: `${baseUrl}/rest/api/2/priority/4`, iconUrl: "", name: "Low", id: "4" },
          { self: `${baseUrl}/rest/api/2/priority/5`, iconUrl: "", name: "Lowest", id: "5" },
        ],
      },
      assignee: {
        required: false,
        schema: { type: "user", system: "assignee" },
        name: "Assignee",
        key: "assignee",
        hasDefaultValue: false,
        operations: ["set"],
        allowedValues: [],
      },
      labels: {
        required: false,
        schema: { type: "array", items: "string", system: "labels" },
        name: "Labels",
        key: "labels",
        hasDefaultValue: false,
        operations: ["add", "set", "remove"],
        allowedValues: [],
      },
      components: {
        required: false,
        schema: { type: "array", items: "component", system: "components" },
        name: "Component/s",
        key: "components",
        hasDefaultValue: false,
        operations: ["add", "set", "remove"],
        allowedValues: [],
      },
    };

    // --- Get and filter projects ---
    let allProjects = db ? await db.listProjects() : [];
    if (projectKeys) {
      const keysFilter = new Set(
        projectKeys.flatMap((group) =>
          group.split(",").map((k) => k.trim().toUpperCase()).filter((k) => k)
        )
      );
      if (keysFilter.size) {
        allProjects = allProjects.filter((p) => keysFilter.has(String(p.key).toUpperCase()));
      }
    }

    // --- Build response ---
    const resultProjects = allProjects.map((project) => {
      const projectIssuetypes = allIssueTypes.map((it) => {
        const entry: any = {
          self: `${baseUrl}/rest/api/2/issuetype/${it.id}`,
          id: it.id,
          name: it.name,
          iconUrl: "",
          subtask: it.subtask,
          expand: "fields",
        };
        if (includeFields) {
          entry.fields = fieldsMeta;
        }
        return entry;
      });

      return {
        expand: "issuetypes",
        self: `${baseUrl}/rest/api/2/project/${project.id ?? "10000"}`,
        id: String(project.id ?? "10000"),
        key: project.key,
        name: project.name,
        avatarUrls: { "48x48": "", "24x24": "", "16x16": "", "32x32": "" },
        issuetypes: projectIssuetypes,
      };
    });

    return reply.send({ expand: "projects", projects: resultProjects });
  });

  // -------------------------------------------------------------------- read
  fastify.get("/issue/:key", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return notFound(reply);
    }
    return reply.code(200).send(issue);
  });

  // ------------------------------------------------------------------ update
  fastify.put("/issue/:key", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return notFound(reply);
    }

    const body = readJson(request);
    const fields = body.fields || {};
    const issueFields = issue.fields;

    for (const direct of ["summary", "description", "labels", "duedate"]) {
      if (direct in fields) {
        issueFields[direct] = fields[direct];
      }
    }

    if ("priority" in fields && isTruthy(fields.priority)) {
      issueFields.priority = shapes.priorityShape(fields.priority.name ?? "Medium");
    }

    if ("issuetype" in fields && isTruthy(fields.issuetype)) {
      issueFields.issuetype = shapes.issuetypeShape(fields.issuetype.name ?? "Task");
    }

    if ("status" in fields && isTruthy(fields.status)) {
      issueFields.status = shapes.statusShape(fields.status.name ?? "To Do");
    }

    if ("assignee" in fields) {
      const assigneeField = fields.assignee;
      if (assigneeField && assigneeField.name) {
        const user = await db.getUserByName(assigneeField.name);
        issueFields.assignee = shapes.userShape(user);
      } else {
        issueFields.assignee = null;
      }
    }

    issueFields.updated = shapes.nowJira();
    await db.saveIssue(issue);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ delete
  fastify.delete("/issue/:key", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return notFound(reply);
    }
    await db.deleteIssue(issue.key);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------- transitions
  fastify.get("/issue/:key/transitions", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return notFound(reply);
    }
    return reply.code(200).send(shapes.transitionsPayload(issue.key));
  });

  fastify.post("/issue/:key/transitions", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return notFound(reply);
    }

    const body = readJson(request);
    const transition = body.transition || {};
    const tid = transition.id;

    let targetStatus: string | null = null;
    for (const [tId, , toStatus] of shapes.TRANSITION_DEFS) {
      if (tId === String(tid)) {
        targetStatus = toStatus;
        break;
      }
    }

    if (targetStatus === null) {
      return reply
        .code(400)
        .send(shapes.errorBody(`Invalid transition id '${pyStr(tid)}'`));
    }

    issue.fields.status = shapes.statusShape(targetStatus);
    issue.fields.updated = shapes.nowJira();
    await db.saveIssue(issue);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- comments
  fastify.get("/issue/:key/comment", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return notFound(reply);
    }
    const comments = await db.getComments(issue.key);
    return reply.code(200).send({
      comments,
      maxResults: 10,
      total: comments.length,
      startAt: 0,
    });
  });

  fastify.post("/issue/:key/comment", async (request, reply) => {
    const db = getDb();
    const { key } = request.params as { key: string };
    const issue = await resolveIssue(db, key);
    if (issue == null) {
      return notFound(reply);
    }

    const body = readJson(request);
    const text = body.body === undefined ? "" : body.body;

    const cid = String(10000 + (await db.getComments(issue.key)).length);
    const author = await currentUser(request, db);
    const ts = shapes.nowJira();
    const comment = shapes.commentShape(cid, text, author, ts, ts);
    await db.addComment(issue.key, comment);

    const container = issue.fields.comment || {
      comments: [],
      maxResults: 10,
      total: 0,
      startAt: 0,
    };
    if (!Array.isArray(container.comments)) {
      container.comments = [];
    }
    container.comments.push(comment);
    container.total = container.comments.length;
    issue.fields.comment = container;
    await db.saveIssue(issue);

    return reply.code(201).send(comment);
  });
}
