/**
 * Parity regression tests.
 *
 * Each case below pins a behavior where the TypeScript port initially drifted
 * from the Python original: Python truthiness on partial updates, scalar
 * query params resolving to their last occurrence, Python-style rendering of
 * a missing transition id, prototype-named lookups missing like a dict miss,
 * and log levels from the Python deployment's vocabulary still booting.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolveLogLevel } from "../src/config";
import { isSkipPath } from "../src/app";
import { TestClient, closeClient, makeClient } from "./helpers";

describe("parity", () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await makeClient();
  });

  afterEach(async () => {
    await closeClient(client);
  });

  test("PUT with an empty priority/issuetype/status object leaves the field unchanged", async () => {
    // Python guards these blocks with `and fields["priority"]`, and {} is
    // falsy there — so an empty object must not reset the field to a default.
    const created = (
      await client.app.inject({
        method: "POST",
        url: "/rest/api/2/issue",
        payload: {
          fields: {
            project: { key: "DEMO" },
            summary: "Empty-object update guard",
            issuetype: { name: "Bug" },
            priority: { name: "High" },
          },
        },
      })
    ).json();

    await client.app.inject({
      method: "POST",
      url: `/rest/api/2/issue/${created.key}/transitions`,
      payload: { transition: { id: "21" } },
    });

    const resp = await client.app.inject({
      method: "PUT",
      url: `/rest/api/2/issue/${created.key}`,
      payload: { fields: { priority: {}, issuetype: {}, status: {} } },
    });
    expect(resp.statusCode).toBe(204);

    const got = (
      await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${created.key}` })
    ).json();
    expect(got.fields.priority.name).toBe("High");
    expect(got.fields.issuetype.name).toBe("Bug");
    expect(got.fields.status.name).toBe("In Progress");
  });

  test("transition with a missing id reports the id as None", async () => {
    const resp = await client.app.inject({
      method: "POST",
      url: "/rest/api/2/issue/APIRE-1/transitions",
      payload: { transition: {} },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().errorMessages).toEqual(["Invalid transition id 'None'"]);
  });

  test("repeated scalar query params resolve to the last occurrence", async () => {
    // GET /user?username=a&username=b — Starlette's QueryParams.get returns
    // the last value, so the lookup must target developer1, not admin.
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/user?username=admin&username=developer1",
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().name).toBe("developer1");

    const search = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/search?jql=project%3DOFS&jql=project%3DDEMO",
    });
    expect(search.statusCode).toBe(200);
    for (const issue of search.json().issues) {
      expect(issue.fields.project.key).toBe("DEMO");
    }
  });

  test("repeated expand param on createmeta uses the last value", async () => {
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/issue/createmeta?projectKeys=APIRE&expand=projects.issuetypes.fields&expand=none",
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().projects[0].issuetypes[0]).not.toHaveProperty("fields");
  });

  test("prototype-named issue keys miss instead of resolving inherited members", async () => {
    for (const key of ["constructor", "toString", "hasOwnProperty"]) {
      const resp = await client.app.inject({ method: "GET", url: `/rest/api/2/issue/${key}` });
      expect(resp.statusCode, `GET /issue/${key}`).toBe(404);
      const del = await client.app.inject({ method: "DELETE", url: `/rest/api/2/issue/${key}` });
      expect(del.statusCode, `DELETE /issue/${key}`).toBe(404);
    }
  });

  test("JQL 'constructor is empty' treats the unknown field as empty", async () => {
    // Python's fields.get("constructor") is None -> empty -> every issue
    // matches; a bare property read would have found Object.prototype's.
    const resp = await client.app.inject({
      method: "GET",
      url: "/rest/api/2/search",
      query: { jql: "constructor is empty" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().total).toBe(15);
  });

  test("percent-encoded admin paths still skip auth and request logging", async () => {
    expect(isSkipPath("/favicon%2Eico")).toBe(true);
    expect(isSkipPath("/api/admin/data")).toBe(true);
    expect(isSkipPath("/rest/api/2/serverInfo")).toBe(false);
  });

  test("Python-style log levels resolve instead of crashing the server", async () => {
    expect(resolveLogLevel("WARNING")).toBe("warn");
    expect(resolveLogLevel("CRITICAL")).toBe("fatal");
    expect(resolveLogLevel("INFO")).toBe("info");
    expect(resolveLogLevel("DEBUG")).toBe("debug");
    expect(resolveLogLevel("NOTSET")).toBe("trace");
    // Unknown values fall back to info, matching getattr(..., logging.INFO).
    expect(resolveLogLevel("verbose")).toBe("info");
    expect(resolveLogLevel("")).toBe("info");
    // pino's own names pass through untouched.
    expect(resolveLogLevel("warn")).toBe("warn");
    expect(resolveLogLevel("silent")).toBe("silent");
  });
});
