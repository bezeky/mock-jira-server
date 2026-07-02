"""Issue CRUD, transition, and lookup tests (Server flavor)."""

import re

DEMO_BODY = {
    "fields": {
        "project": {"key": "DEMO"},
        "summary": "New hermetic test issue",
        "description": "Created by the test suite",
        "issuetype": {"name": "Task"},
        "priority": {"name": "Medium"},
        "assignee": {"name": "developer1"},
    }
}


def _create(client, path="/rest/api/2/issue"):
    resp = client.post(path, json=DEMO_BODY)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_issue_returns_demo_key(client):
    body = _create(client)
    assert re.match(r"^DEMO-\d+$", body["key"])
    assert "id" in body
    assert "self" in body


def test_create_issue_plural_alias(client):
    resp = client.post("/rest/api/2/issues", json=DEMO_BODY)
    assert resp.status_code == 201, resp.text
    assert re.match(r"^DEMO-\d+$", resp.json()["key"])


def test_get_created_issue_full_shape(client):
    created = _create(client)
    key = created["key"]
    resp = client.get(f"/rest/api/2/issue/{key}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["key"] == key
    assert "fields" in data
    assert data["fields"]["summary"] == DEMO_BODY["fields"]["summary"]
    # Server-style assignee: name/key, no accountId.
    assignee = data["fields"]["assignee"]
    assert assignee is not None
    assert assignee["name"] == "developer1"
    assert "accountId" not in assignee


def test_get_issue_by_numeric_id(client):
    # Seed assigns numeric ids starting at 10001 to the first seeded issue.
    resp = client.get("/rest/api/2/issue/10001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "10001"


def test_update_issue_returns_204(client):
    created = _create(client)
    key = created["key"]
    resp = client.put(
        f"/rest/api/2/issue/{key}",
        json={"fields": {"summary": "Updated summary"}},
    )
    assert resp.status_code == 204
    # Confirm the change persisted.
    got = client.get(f"/rest/api/2/issue/{key}").json()
    assert got["fields"]["summary"] == "Updated summary"


def test_delete_issue_then_404(client):
    created = _create(client)
    key = created["key"]
    resp = client.delete(f"/rest/api/2/issue/{key}")
    assert resp.status_code == 204
    resp = client.get(f"/rest/api/2/issue/{key}")
    assert resp.status_code == 404
    assert "errorMessages" in resp.json()


def test_get_transitions(client):
    created = _create(client)
    key = created["key"]
    resp = client.get(f"/rest/api/2/issue/{key}/transitions")
    assert resp.status_code == 200
    data = resp.json()
    assert "transitions" in data
    assert isinstance(data["transitions"], list)
    assert len(data["transitions"]) == 4


def test_post_transition_updates_status(client):
    created = _create(client)
    key = created["key"]
    resp = client.post(
        f"/rest/api/2/issue/{key}/transitions",
        json={"transition": {"id": "21"}},
    )
    assert resp.status_code == 204
    got = client.get(f"/rest/api/2/issue/{key}").json()
    assert got["fields"]["status"]["name"] == "In Progress"
