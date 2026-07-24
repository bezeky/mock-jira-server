"""Admin dashboard backend, seed-persistence, and changelog tests (v2.0.0).

Covers the additive admin-data keys (description/comments/reporter/updated),
the single-issue detail endpoint used by the dashboard's slide-in panel, the
seeded real company users surviving a reset, and the changelog stub.
"""

ISSUE_BODY = {
    "fields": {
        "project": {"key": "DEMO"},
        "summary": "Admin detail test issue",
        "description": "SQL Injection\n\nURL: https://example.test/login\nParameter: username\nEvidence: ' OR 1=1 --",
        "issuetype": {"name": "Bug"},
        "priority": {"name": "High"},
        "assignee": {"name": "developer1"},
    }
}


def _create(client):
    resp = client.post("/rest/api/2/issue", json=ISSUE_BODY)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_admin_data_includes_description(client):
    created = _create(client)
    resp = client.get("/api/admin/data")
    assert resp.status_code == 200
    rows = resp.json()["issues"]
    row = next(r for r in rows if r["key"] == created["key"])
    assert "description" in row
    assert row["description"] == ISSUE_BODY["fields"]["description"]
    # Pre-existing keys must be untouched (additive change only).
    for existing_key in (
        "key", "summary", "status", "status_category_key", "priority",
        "project_key", "project_name", "assignee", "issuetype", "created",
    ):
        assert existing_key in row


def test_admin_issue_detail(client):
    created = _create(client)
    resp = client.get(f"/api/admin/issue/{created['key']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["key"] == created["key"]
    assert data["description"] == ISSUE_BODY["fields"]["description"]
    assert data["comments"] == []
    assert data["reporter"]  # displayName of the current (fallback) user
    assert data["created"]
    assert data["updated"]


def test_admin_issue_detail_404(client):
    resp = client.get("/api/admin/issue/NOTREAL-999")
    assert resp.status_code == 404


def test_seed_users_present(client):
    # A reset wipes the store and reloads seed.py — the real company users
    # must come back without any manual SQL.
    resp = client.delete("/api/admin/reset")
    assert resp.status_code == 200

    for username in ("mastergulsena", "bsnsila2"):
        resp = client.get(
            "/rest/api/2/user/search", params={"username": username}
        )
        assert resp.status_code == 200
        results = resp.json()
        assert results, f"user search returned nothing for {username}"
        names = [u["name"] for u in results]
        assert username in names
        # Server flavor: name/key only, never accountId.
        match = next(u for u in results if u["name"] == username)
        assert match["key"] == username
        assert "accountId" not in match


def test_changelog_endpoint(client):
    _create(client)
    resp = client.get("/rest/api/2/issue/APIRE-1/changelog")
    assert resp.status_code == 200
    data = resp.json()
    assert data["histories"] == []
    assert data["startAt"] == 0
    assert data["maxResults"] == 50
    assert data["total"] == 0


def test_changelog_unknown_issue_404(client):
    resp = client.get("/rest/api/2/issue/NOTREAL-999/changelog")
    assert resp.status_code == 404
    assert "errorMessages" in resp.json()
