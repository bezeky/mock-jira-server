"""Tests for GET /rest/api/2/issue/createmeta (Server flavor).

Tests 1-4 are hermetic: they run against the in-memory ``FakeStore`` seeded by
the ``client`` fixture (projects APIRE, OFS, DEMO). Test 5 is a live
round-trip through the installed pycontribs ``jira`` library and is skipped
when the library is absent or a real server is not reachable on :8080.
"""

import warnings

import pytest

CREATEMETA = "/rest/api/2/issue/createmeta"


# Test 1: projectKeys + issuetypeNames + expand=projects.issuetypes.fields
def test_createmeta_with_filters_and_expand(client):
    resp = client.get(
        CREATEMETA,
        params={
            "projectKeys": "APIRE",
            "issuetypeNames": "Bug",
            "expand": "projects.issuetypes.fields",
        },
    )
    assert resp.status_code == 200
    data = resp.json()

    projects = data["projects"]
    assert len(projects) == 1
    assert projects[0]["key"] == "APIRE"

    issuetypes = projects[0]["issuetypes"]
    assert len(issuetypes) == 1
    assert issuetypes[0]["name"] == "Bug"

    fields = issuetypes[0]["fields"]
    assert "summary" in fields
    assert fields["summary"]["required"] is True
    # Priority is fully populated with the five Server priorities.
    assert len(fields["priority"]["allowedValues"]) == 5


# Test 2: projectKeys only (no expand) -> no "fields" key on the issuetype
def test_createmeta_without_expand_omits_fields(client):
    resp = client.get(CREATEMETA, params={"projectKeys": "APIRE"})
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["projects"]) == 1
    issuetypes = data["projects"][0]["issuetypes"]
    assert len(issuetypes) >= 1
    assert "fields" not in issuetypes[0]


# Test 3: no query params -> all three seeded projects, each with four issuetypes
def test_createmeta_no_params_returns_all_projects(client):
    resp = client.get(CREATEMETA)
    assert resp.status_code == 200
    data = resp.json()

    projects = data["projects"]
    assert len(projects) == 3
    keys = {p["key"] for p in projects}
    assert keys == {"APIRE", "OFS", "DEMO"}
    for project in projects:
        assert len(project["issuetypes"]) == 4
        # Without expand, issuetypes never carry field metadata.
        assert all("fields" not in it for it in project["issuetypes"])


# Test 4: non-existent projectKeys -> empty projects array
def test_createmeta_unknown_project_is_empty(client):
    resp = client.get(CREATEMETA, params={"projectKeys": "XXXNOTREAL"})
    assert resp.status_code == 200
    assert resp.json()["projects"] == []


# Test 5: pycontribs round-trip against a live server. Only a genuine connection
# failure (server not running) skips; a reachable-but-broken createmeta must
# FAIL, so the createmeta call and its assertions sit OUTSIDE the skip guard.
def test_createmeta_pycontribs_roundtrip():
    jira_lib = pytest.importorskip("jira")
    requests = pytest.importorskip("requests")

    try:
        jira = jira_lib.JIRA(
            server="http://localhost:8080",
            basic_auth=("admin", "any"),
        )
    except requests.exceptions.RequestException as exc:
        pytest.skip(f"live mock-jira server not reachable on :8080 ({exc})")

    with warnings.catch_warnings():
        # createmeta is deprecated (removed in JIRA 9.0) but valid for the
        # Server 8.20.14 version this mock reports.
        warnings.simplefilter("ignore", DeprecationWarning)
        meta = jira.createmeta(
            projectKeys="APIRE",
            issuetypeNames="Bug",
            expand="projects.issuetypes.fields",
        )

    projects = meta["projects"]
    assert len(projects) > 0
    assert projects[0]["key"] == "APIRE"

    bug = projects[0]["issuetypes"][0]
    assert bug["name"] == "Bug"
    assert "fields" in bug
    assert bug["fields"]["summary"]["required"] is True


# Test 6 (issuetypeIds coverage): the id filter narrows to the matching type.
# Canonical ids from shapes.ISSUETYPE_DEFS: Task=10001, Bug=10002, Story=10003.
def test_createmeta_issuetypeids_filter(client):
    resp = client.get(CREATEMETA, params={"projectKeys": "APIRE", "issuetypeIds": "10002"})
    assert resp.status_code == 200
    issuetypes = resp.json()["projects"][0]["issuetypes"]
    assert len(issuetypes) == 1
    assert issuetypes[0]["id"] == "10002"
    assert issuetypes[0]["name"] == "Bug"


# Test 7: issuetypeNames and issuetypeIds AND together.
def test_createmeta_combined_name_and_id_filters(client):
    # Bug name + Bug id -> Bug survives.
    resp = client.get(CREATEMETA, params={
        "projectKeys": "APIRE", "issuetypeNames": "Bug", "issuetypeIds": "10002",
    })
    assert [it["name"] for it in resp.json()["projects"][0]["issuetypes"]] == ["Bug"]

    # Bug name + Task id (10001) -> empty (intersection of disjoint sets).
    resp = client.get(CREATEMETA, params={
        "projectKeys": "APIRE", "issuetypeNames": "Bug", "issuetypeIds": "10001",
    })
    assert resp.json()["projects"][0]["issuetypes"] == []


# Test 8: repeated multi-value query params are all honored (not collapsed to the
# last value) -- the form pycontribs/jira sends for tuple/list arguments.
def test_createmeta_repeated_multivalue_params(client):
    resp = client.get(CREATEMETA, params={"projectKeys": ["APIRE", "OFS"]})
    assert resp.status_code == 200
    assert {p["key"] for p in resp.json()["projects"]} == {"APIRE", "OFS"}

    resp = client.get(CREATEMETA, params={
        "projectKeys": "APIRE", "issuetypeIds": ["10001", "10002"],
    })
    assert {it["name"] for it in resp.json()["projects"][0]["issuetypes"]} == {"Task", "Bug"}
