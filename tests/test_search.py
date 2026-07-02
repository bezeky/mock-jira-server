"""Search endpoint tests (GET/POST /search) over the seeded fake store."""


def test_search_get_project_returns_issues(client):
    resp = client.get("/rest/api/2/search", params={"jql": "project=DEMO"})
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert isinstance(data["issues"], list)
    assert data["total"] == 5
    assert len(data["issues"]) == 5
    for issue in data["issues"]:
        assert issue["fields"]["project"]["key"] == "DEMO"


def test_search_max_results_limits_page(client):
    resp = client.get(
        "/rest/api/2/search",
        params={"jql": "project=DEMO", "maxResults": 2},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["issues"]) <= 2
    # total still reflects the full match count.
    assert data["total"] == 5


def test_search_post_body(client):
    resp = client.post(
        "/rest/api/2/search",
        json={"jql": "project=DEMO", "maxResults": 50, "startAt": 0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["issues"]) == 5


def test_search_status_filter(client):
    resp = client.get(
        "/rest/api/2/search",
        params={"jql": 'status="In Progress"'},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    for issue in data["issues"]:
        assert issue["fields"]["status"]["name"] == "In Progress"


def test_search_order_by_does_not_crash(client):
    resp = client.get(
        "/rest/api/2/search",
        params={"jql": "project=DEMO ORDER BY created DESC"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
