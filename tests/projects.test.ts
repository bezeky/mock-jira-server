/** Project endpoint tests (Server flavor). */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TestClient, closeClient, makeClient } from "./helpers";

describe("projects", () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await makeClient();
  });

  afterEach(async () => {
    await closeClient(client);
  });

  test("list projects is a list", async () => {
    const resp = await client.app.inject({ method: "GET", url: "/rest/api/2/project" });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(Array.isArray(data)).toBe(true);
    const keys = new Set(data.map((p: any) => p.key));
    expect(keys.has("APIRE")).toBe(true);
  });

  test("get project by key", async () => {
    const resp = await client.app.inject({ method: "GET", url: "/rest/api/2/project/APIRE" });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data.key).toBe("APIRE");
    // Server user objects for the lead never leak Cloud fields.
    if (data.lead) {
      expect(data.lead).not.toHaveProperty("accountId");
      expect(data.lead).toHaveProperty("name");
    }
  });

  test("get unknown project returns 404", async () => {
    const resp = await client.app.inject({ method: "GET", url: "/rest/api/2/project/NOPE" });
    expect(resp.statusCode).toBe(404);
    const data = resp.json();
    expect(data).toHaveProperty("errorMessages");
    expect(data.errors).toEqual({});
  });

  test("project statuses is list with statuses key", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/project/APIRE/statuses",
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    for (const entry of data) {
      expect(entry).toHaveProperty("statuses");
      expect(Array.isArray(entry.statuses)).toBe(true);
    }
  });

  test("capital-P project statuses alias", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/Project/APIRE/statuses",
    });
    expect(resp.statusCode).toBe(200);
    expect(Array.isArray(resp.json())).toBe(true);
  });
});
