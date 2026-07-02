"""Meta / read-only endpoint tests (Server flavor)."""


def test_server_info_is_server_deployment(client):
    resp = client.get("/rest/api/2/serverInfo")
    assert resp.status_code == 200
    data = resp.json()
    assert "version" in data
    assert data["version"] == "8.20.14"
    assert data["deploymentType"] == "Server"
    assert data["versionNumbers"] == [8, 20, 14]


def test_myself_is_server_user_without_account_id(client):
    resp = client.get("/rest/api/2/myself")
    assert resp.status_code == 200
    data = resp.json()
    # Server-style: has "name"; NEVER emits Cloud-only fields.
    assert "name" in data
    assert data["name"]
    assert "accountId" not in data
    assert "accountType" not in data
    assert "locale" not in data
    # myself carries groups + applicationRoles containers.
    assert data["groups"] == {"size": 1, "items": []}
    assert data["applicationRoles"] == {"size": 1, "items": []}


def test_priority_returns_five(client):
    resp = client.get("/rest/api/2/priority")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 5
    names = [p["name"] for p in data]
    assert names == ["Highest", "High", "Medium", "Low", "Lowest"]


def test_license_is_valid(client):
    resp = client.get(
        "/rest/plugins/applications/1.0/installed/jira-software/license"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
