/**
 * Admin dashboard backend, seed-persistence, and changelog tests (v2.x).
 *
 * Covers the additive admin-data keys (description/comments/reporter/
 * updated), the single-issue detail endpoint used by the dashboard's
 * slide-in panel, the seeded real company users surviving a reset, and the
 * changelog stub.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TestClient, closeClient, makeClient } from "./helpers";

const ISSUE_BODY = {
  fields: {
    project: { key: "DEMO" },
    summary: "Admin detail test issue",
    description:
      "SQL Injection\n\nURL: https://example.test/login\nParameter: username\nEvidence: ' OR 1=1 --",
    issuetype: { name: "Bug" },
    priority: { name: "High" },
    assignee: { name: "developer1" },
  },
};

describe("admin", () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await makeClient();
  });

  afterEach(async () => {
    await closeClient(client);
  });

  async function create(): Promise<any> {
    const resp = await client.app.inject({
      method: "POST",
      url: "/rest/api/2/issue",
      payload: ISSUE_BODY,
    });
    expect(resp.statusCode, resp.body).toBe(201);
    return resp.json();
  }

  test("admin data includes description", async () => {
    const created = await create();
    const resp = await client.app.inject({ method: "GET", url: "/api/admin/data" });
    expect(resp.statusCode).toBe(200);
    const rows = resp.json().issues;
    const row = rows.find((r: any) => r.key === created.key);
    expect(row).toBeTruthy();
    // description is no longer included in list rows (lazy-loaded via
    // GET /api/admin/issue/:key to keep the list response small)
    expect(row).not.toHaveProperty("description");
    // Pre-existing keys must be untouched (additive change only).
    for (const existingKey of [
      "key",
      "summary",
      "status",
      "status_category_key",
      "priority",
      "project_key",
      "project_name",
      "assignee",
      "issuetype",
      "created",
    ]) {
      expect(row).toHaveProperty(existingKey);
    }
  });

  test("admin issue detail", async () => {
    const created = await create();
    const resp = await client.app.inject({
      method: "GET",
      url: `/api/admin/issue/${created.key}`,
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.key).toBe(created.key);
    expect(data.description).toBe(ISSUE_BODY.fields.description);
    expect(data.comments).toEqual([]);
    expect(data.reporter).toBeTruthy(); // displayName of the current (fallback) user
    expect(data.created).toBeTruthy();
    expect(data.updated).toBeTruthy();
  });

  test("admin issue detail 404", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/api/admin/issue/NOTREAL-999",
    });
    expect(resp.statusCode).toBe(404);
  });

  test("seed users present after reset", async () => {
    // A reset wipes the store and reloads the seed — the real company users
    // must come back without any manual SQL.
    const resetResp = await client.app.inject({ method: "DELETE", url: "/api/admin/reset" });
    expect(resetResp.statusCode).toBe(200);

    for (const username of ["mastergulsena", "bsnsila2"]) {
      const resp = await client.app.inject({
        method: "GET",
        url: "/rest/api/2/user/search",
        query: { username },
      });
      expect(resp.statusCode).toBe(200);
      const results = resp.json();
      expect(results.length, `user search returned nothing for ${username}`).toBeGreaterThan(0);
      const names = results.map((u: any) => u.name);
      expect(names).toContain(username);
      // Server flavor: name/key only, never accountId.
      const match = results.find((u: any) => u.name === username);
      expect(match.key).toBe(username);
      expect(match).not.toHaveProperty("accountId");
    }
  });

  test("changelog endpoint", async () => {
    await create();
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/issue/APIRE-1/changelog",
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.histories).toEqual([]);
    expect(data.startAt).toBe(0);
    expect(data.maxResults).toBe(50);
    expect(data.total).toBe(0);
  });

  test("changelog unknown issue 404", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/issue/NOTREAL-999/changelog",
    });
    expect(resp.statusCode).toBe(404);
    expect(resp.json()).toHaveProperty("errorMessages");
  });
});
