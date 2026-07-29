/** Issue CRUD, transition, and lookup tests (Server flavor). */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { setDb } from "../src/store";
import { TestClient, closeClient, makeClient } from "./helpers";

const DEMO_BODY = {
  fields: {
    project: { key: "DEMO" },
    summary: "New hermetic test issue",
    description: "Created by the test suite",
    issuetype: { name: "Task" },
    priority: { name: "Medium" },
    assignee: { name: "developer1" },
  },
};

describe("issues", () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await makeClient();
  });

  afterEach(async () => {
    await closeClient(client);
  });

  async function create(path = "/rest/api/2/issue"): Promise<any> {
    const resp = await client.app.inject({ method: "POST", url: path, payload: DEMO_BODY });
    expect(resp.statusCode, resp.body).toBe(201);
    return resp.json();
  }

  test("create issue returns DEMO key", async () => {
    const body = await create();
    expect(body.key).toMatch(/^DEMO-\d+$/);
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("self");
  });

  test("create issue plural alias", async () => {
    const resp = await client.app.inject({
      method: "POST",
      url: "/rest/api/2/issues",
      payload: DEMO_BODY,
    });
    expect(resp.statusCode, resp.body).toBe(201);
    expect(resp.json().key).toMatch(/^DEMO-\d+$/);
  });

  test("get created issue full shape", async () => {
    const created = await create();
    const key = created.key;
    const resp = await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${key}` });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.key).toBe(key);
    expect(data).toHaveProperty("fields");
    expect(data.fields.summary).toBe(DEMO_BODY.fields.summary);
    // Server-style assignee: name/key, no accountId.
    const assignee = data.fields.assignee;
    expect(assignee).not.toBeNull();
    expect(assignee.name).toBe("developer1");
    expect(assignee).not.toHaveProperty("accountId");
  });

  test("get issue by numeric id", async () => {
    // Seed assigns numeric ids starting at 10001 to the first seeded issue.
    const resp = await client.app.inject({ method: "GET", url: "/rest/api/2/issue/10001" });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().id).toBe("10001");
  });

  test("update issue returns 204", async () => {
    const created = await create();
    const key = created.key;
    const resp = await client.app.inject({
      method: "PUT",
      url: `/rest/api/2/issue/${key}`,
      payload: { fields: { summary: "Updated summary" } },
    });
    expect(resp.statusCode).toBe(204);
    // Confirm the change persisted.
    const got = (
      await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${key}` })
    ).json();
    expect(got.fields.summary).toBe("Updated summary");
  });

  test("delete issue then 404", async () => {
    const created = await create();
    const key = created.key;
    let resp = await client.app.inject({ method: "DELETE", url: `/rest/api/2/issue/${key}` });
    expect(resp.statusCode).toBe(204);
    resp = await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${key}` });
    expect(resp.statusCode).toBe(404);
    expect(resp.json()).toHaveProperty("errorMessages");
  });

  test("get transitions", async () => {
    const created = await create();
    const key = created.key;
    const resp = await client.app.inject({
      method: "GET",
      url: `/rest/api/2/issue/${key}/transitions`,
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data).toHaveProperty("transitions");
    expect(Array.isArray(data.transitions)).toBe(true);
    expect(data.transitions).toHaveLength(4);
  });

  test("create issue with project by numeric id", async () => {
    // This is the exact OSM shape: no "key" at all, only the numeric id
    // (APIRE's seeded id is "10000" — see src/seed.ts).
    const body = {
      fields: {
        project: { id: "10000" },
        summary: "Created via project id only",
        issuetype: { name: "Task" },
      },
    };
    const resp = await client.app.inject({ method: "POST", url: "/rest/api/2/issue", payload: body });
    expect(resp.statusCode, resp.body).toBe(201);
    expect(resp.json().key.startsWith("APIRE-")).toBe(true);
  });

  test("create issue still requires project", async () => {
    // Regression check: with neither key nor id present, this must still 400
    // with the same message OSM is currently showing.
    const body = { fields: { summary: "No project at all" } };
    const resp = await client.app.inject({ method: "POST", url: "/rest/api/2/issue", payload: body });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().errorMessages).toEqual(["project is required"]);
  });

  test("create issue unknown project id errors", async () => {
    const body = { fields: { project: { id: "99999" }, summary: "Bad id" } };
    const resp = await client.app.inject({ method: "POST", url: "/rest/api/2/issue", payload: body });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().errorMessages[0]).toContain("does not exist");
  });

  test("create issue issuetype by id", async () => {
    const body = {
      fields: {
        project: { key: "DEMO" },
        summary: "Bug via issuetype id",
        issuetype: { id: "10002" }, // Bug
      },
    };
    const resp = await client.app.inject({ method: "POST", url: "/rest/api/2/issue", payload: body });
    expect(resp.statusCode, resp.body).toBe(201);
    const created = (
      await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${resp.json().key}` })
    ).json();
    expect(created.fields.issuetype.name).toBe("Bug");
  });

  test("create issue priority by id", async () => {
    const body = {
      fields: {
        project: { key: "DEMO" },
        summary: "High priority via id",
        priority: { id: "2" }, // High
      },
    };
    const resp = await client.app.inject({ method: "POST", url: "/rest/api/2/issue", payload: body });
    expect(resp.statusCode, resp.body).toBe(201);
    const created = (
      await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${resp.json().key}` })
    ).json();
    expect(created.fields.priority.name).toBe("High");
  });

  test("create issue assignee by key", async () => {
    // Jira Server clients commonly send "key" rather than "name" for users;
    // in this mock they're the same string, so this should resolve.
    const body = {
      fields: {
        project: { key: "DEMO" },
        summary: "Assigned via key not name",
        assignee: { key: "developer1" },
      },
    };
    const resp = await client.app.inject({ method: "POST", url: "/rest/api/2/issue", payload: body });
    expect(resp.statusCode, resp.body).toBe(201);
    const created = (
      await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${resp.json().key}` })
    ).json();
    expect(created.fields.assignee.name).toBe("developer1");
  });

  test("post transition updates status", async () => {
    const created = await create();
    const key = created.key;
    const resp = await client.app.inject({
      method: "POST",
      url: `/rest/api/2/issue/${key}/transitions`,
      payload: { transition: { id: "21" } },
    });
    expect(resp.statusCode).toBe(204);
    const got = (
      await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${key}` })
    ).json();
    expect(got.fields.status.name).toBe("In Progress");
  });
});

describe("issue create diagnostics", () => {
  test("POST /issue logs the raw request body at INFO", async () => {
    const lines: string[] = [];
    const stream = {
      write: (chunk: string) => {
        lines.push(String(chunk));
      },
    };
    const client = await makeClient({ logger: { level: "info", stream } as any });
    try {
      const resp = await client.app.inject({
        method: "POST",
        url: "/rest/api/2/issue",
        payload: DEMO_BODY,
      });
      expect(resp.statusCode, resp.body).toBe(201);
      const parsed = lines
        .flatMap((chunk) => chunk.split("\n"))
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((entry): entry is any => entry !== null);
      const hit = parsed.find(
        (entry) => typeof entry.msg === "string" && entry.msg.includes("POST /issue raw body")
      );
      expect(hit, "expected an INFO log line containing the raw body").toBeTruthy();
      expect(hit.level).toBe(30); // pino INFO
      expect(hit.msg).toContain("New hermetic test issue");
    } finally {
      await client.app.close();
      setDb(null);
    }
  });
});
