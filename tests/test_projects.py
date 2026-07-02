"""Project endpoint tests (Server flavor)."""


def test_list_projects_is_a_list(client):
    resp = client.get("/rest/api/2/project")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    keys = {p["key"] for p in data}
    assert "APIRE" in keys


def test_get_project_by_key(client):
    resp = client.get("/rest/api/2/project/APIRE")
    assert resp.status_code == 200
    data = resp.json()
    assert data["key"] == "APIRE"
    # Server user objects for the lead never leak Cloud fields.
    if data.get("lead"):
        assert "accountId" not in data["lead"]
        assert "name" in data["lead"]


def test_get_unknown_project_returns_404(client):
    resp = client.get("/rest/api/2/project/NOPE")
    assert resp.status_code == 404
    data = resp.json()
    assert "errorMessages" in data
    assert data["errors"] == {}


def test_project_statuses_is_list_with_statuses_key(client):
    resp = client.get("/rest/api/2/project/APIRE/statuses")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    for entry in data:
        assert "statuses" in entry
        assert isinstance(entry["statuses"], list)


def test_capital_p_project_statuses_alias(client):
    resp = client.get("/rest/api/2/Project/APIRE/statuses")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
