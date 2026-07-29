/**
 * Meta / read-only endpoint tests (Server flavor) plus tests for
 * GET /rest/api/2/issue/createmeta.
 *
 * The createmeta tests 1-4 and 6-8 are hermetic: they run against the
 * in-memory FakeStore seeded by makeClient (projects APIRE, OFS, DEMO).
 * The live round-trip test talks to a real server on :8080 and is skipped
 * when none is reachable.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TestClient, closeClient, makeClient } from "./helpers";

const CREATEMETA = "/rest/api/2/issue/createmeta";

describe("meta", () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await makeClient();
  });

  afterEach(async () => {
    await closeClient(client);
  });

  test("serverInfo is Server deployment", async () => {
    const resp = await client.app.inject({ method: "GET", url: "/rest/api/2/serverInfo" });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(data).toHaveProperty("version");
    expect(data.version).toBe("8.20.14");
    expect(data.deploymentType).toBe("Server");
    expect(data.versionNumbers).toEqual([8, 20, 14]);
  });

  test("myself is Server user without accountId", async () => {
    const resp = await client.app.inject({ method: "GET", url: "/rest/api/2/myself" });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    // Server-style: has "name"; NEVER emits Cloud-only fields.
    expect(data).toHaveProperty("name");
    expect(data.name).toBeTruthy();
    expect(data).not.toHaveProperty("accountId");
    expect(data).not.toHaveProperty("accountType");
    expect(data).not.toHaveProperty("locale");
    // myself carries groups + applicationRoles containers.
    expect(data.groups).toEqual({ size: 1, items: [] });
    expect(data.applicationRoles).toEqual({ size: 1, items: [] });
  });

  test("priority returns five", async () => {
    const resp = await client.app.inject({ method: "GET", url: "/rest/api/2/priority" });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(5);
    expect(data.map((p: any) => p.name)).toEqual(["Highest", "High", "Medium", "Low", "Lowest"]);
  });

  test("license is valid", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/plugins/applications/1.0/installed/jira-software/license",
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().valid).toBe(true);
  });

  // Test 1: projectKeys + issuetypeNames + expand=projects.issuetypes.fields
  test("createmeta with filters and expand", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: CREATEMETA,
      query: {
        projectKeys: "APIRE",
        issuetypeNames: "Bug",
        expand: "projects.issuetypes.fields",
      },
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();

    const projects = data.projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].key).toBe("APIRE");

    const issuetypes = projects[0].issuetypes;
    expect(issuetypes).toHaveLength(1);
    expect(issuetypes[0].name).toBe("Bug");

    const fields = issuetypes[0].fields;
    expect(fields).toHaveProperty("summary");
    expect(fields.summary.required).toBe(true);
    // Priority is fully populated with the five Server priorities.
    expect(fields.priority.allowedValues).toHaveLength(5);
  });

  // Test 2: projectKeys only (no expand) -> no "fields" key on the issuetype
  test("createmeta without expand omits fields", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: CREATEMETA,
      query: { projectKeys: "APIRE" },
    });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();

    expect(data.projects).toHaveLength(1);
    const issuetypes = data.projects[0].issuetypes;
    expect(issuetypes.length).toBeGreaterThanOrEqual(1);
    expect(issuetypes[0]).not.toHaveProperty("fields");
  });

  // Test 3: no query params -> all three seeded projects, four issuetypes each
  test("createmeta no params returns all projects", async () => {
    const resp = await client.app.inject({ method: "GET", url: CREATEMETA });
    expect(resp.statusCode).toBe(200);
    const data = resp.json();

    const projects = data.projects;
    expect(projects).toHaveLength(3);
    const keys = new Set(projects.map((p: any) => p.key));
    expect(keys).toEqual(new Set(["APIRE", "OFS", "DEMO"]));
    for (const project of projects) {
      expect(project.issuetypes).toHaveLength(4);
      // Without expand, issuetypes never carry field metadata.
      for (const it of project.issuetypes) {
        expect(it).not.toHaveProperty("fields");
      }
    }
  });

  // Test 4: non-existent projectKeys -> empty projects array
  test("createmeta unknown project is empty", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: CREATEMETA,
      query: { projectKeys: "XXXNOTREAL" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().projects).toEqual([]);
  });

  // Test 6 (issuetypeIds coverage): the id filter narrows to the matching
  // type. Canonical ids: Task=10001, Bug=10002, Story=10003.
  test("createmeta issuetypeIds filter", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: CREATEMETA,
      query: { projectKeys: "APIRE", issuetypeIds: "10002" },
    });
    expect(resp.statusCode).toBe(200);
    const issuetypes = resp.json().projects[0].issuetypes;
    expect(issuetypes).toHaveLength(1);
    expect(issuetypes[0].id).toBe("10002");
    expect(issuetypes[0].name).toBe("Bug");
  });

  // Test 7: issuetypeNames and issuetypeIds AND together.
  test("createmeta combined name and id filters", async () => {
    // Bug name + Bug id -> Bug survives.
    let resp = await client.app.inject({
      method: "GET",
      url: CREATEMETA,
      query: { projectKeys: "APIRE", issuetypeNames: "Bug", issuetypeIds: "10002" },
    });
    expect(resp.json().projects[0].issuetypes.map((it: any) => it.name)).toEqual(["Bug"]);

    // Bug name + Task id (10001) -> empty (intersection of disjoint sets).
    resp = await client.app.inject({
      method: "GET",
      url: CREATEMETA,
      query: { projectKeys: "APIRE", issuetypeNames: "Bug", issuetypeIds: "10001" },
    });
    expect(resp.json().projects[0].issuetypes).toEqual([]);
  });

  // Test 8: repeated multi-value query params are all honored (not collapsed
  // to the last value) — the form pycontribs/jira sends for tuple/list args.
  test("createmeta repeated multivalue params", async () => {
    let resp = await client.app.inject({
      method: "GET",
      url: `${CREATEMETA}?projectKeys=APIRE&projectKeys=OFS`,
    });
    expect(resp.statusCode).toBe(200);
    expect(new Set(resp.json().projects.map((p: any) => p.key))).toEqual(
      new Set(["APIRE", "OFS"])
    );

    resp = await client.app.inject({
      method: "GET",
      url: `${CREATEMETA}?projectKeys=APIRE&issuetypeIds=10001&issuetypeIds=10002`,
    });
    expect(
      new Set(resp.json().projects[0].issuetypes.map((it: any) => it.name))
    ).toEqual(new Set(["Task", "Bug"]));
  });

  // Test 5: round-trip against a live server on :8080 (the equivalent of the
  // old pycontribs library round-trip). Only a genuine connection failure
  // (server not running) skips; a reachable-but-broken createmeta must FAIL,
  // so the createmeta call and its assertions sit outside the skip guard.
  test("createmeta live server roundtrip", async (ctx) => {
    try {
      await fetch("http://localhost:8080/rest/api/2/serverInfo");
    } catch {
      ctx.skip();
      return;
    }

    const resp = await fetch(
      `http://localhost:8080${CREATEMETA}?projectKeys=APIRE&issuetypeNames=Bug&expand=projects.issuetypes.fields`,
      { headers: { Authorization: "Basic " + Buffer.from("admin:any").toString("base64") } }
    );
    expect(resp.status).toBe(200);
    const meta: any = await resp.json();

    const projects = meta.projects;
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0].key).toBe("APIRE");

    const bug = projects[0].issuetypes[0];
    expect(bug.name).toBe("Bug");
    expect(bug).toHaveProperty("fields");
    expect(bug.fields.summary.required).toBe(true);
  });
});
