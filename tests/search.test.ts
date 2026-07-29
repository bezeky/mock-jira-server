/** Search endpoint tests (GET/POST /search) over the seeded fake store. */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TestClient, closeClient, makeClient } from "./helpers";

describe("search", () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await makeClient();
  });

  afterEach(async () => {
    await closeClient(client);
  });

  test("search GET project returns issues", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/search",
      query: { jql: "project=DEMO" },
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data).toHaveProperty("total");
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.total).toBe(5);
    expect(data.issues).toHaveLength(5);
    for (const issue of data.issues) {
      expect(issue.fields.project.key).toBe("DEMO");
    }
  });

  test("search maxResults limits page", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/search",
      query: { jql: "project=DEMO", maxResults: "2" },
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.issues.length).toBeLessThanOrEqual(2);
    // total still reflects the full match count.
    expect(data.total).toBe(5);
  });

  test("search POST body", async () => {
    const resp = await client.app.inject({
      method: "POST",
      url: "/rest/api/2/search",
      payload: { jql: "project=DEMO", maxResults: 50, startAt: 0 },
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.total).toBe(5);
    expect(data.issues).toHaveLength(5);
  });

  test("search status filter", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/search",
      query: { jql: 'status="In Progress"' },
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.total).toBeGreaterThanOrEqual(1);
    for (const issue of data.issues) {
      expect(issue.fields.status.name).toBe("In Progress");
    }
  });

  test("search ORDER BY does not crash", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/search",
      query: { jql: "project=DEMO ORDER BY created DESC" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().total).toBe(5);
  });
});
