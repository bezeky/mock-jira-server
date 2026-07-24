# Mock Jira Server — OSM Integration Testing

**v2.0.0** — a mock **Jira Server / Data Center** (on-premise) **REST API v2** implementation,
built with Python 3.11+, FastAPI, Pydantic v2, and PostgreSQL.

This mock enables **OSM (OFSecMan)** to be tested against a full Jira Server REST API v2
without requiring a real Jira license. OSM connects to it exactly as it would to a production
Jira Server: it creates vulnerability tickets from offensive scans, syncs ticket statuses
through transitions, resolves projects/issue types/priorities, and passes its Jira Software
license check — while every ticket and request lands in a local PostgreSQL you can inspect
live from the admin dashboard. It is equally usable from the generic
[pycontribs/jira](https://github.com/pycontribs/jira) Python client (Server flavor).

> **This is a Server / Data Center mock, NOT Jira Cloud.**
> Every user object uses `name` + `key` (usernames), the API lives under `/rest/api/2`, and
> `serverInfo.deploymentType` is `"Server"`. There are **no** `accountId`, `accountType`, or
> `locale` fields anywhere — those are Cloud-only. User lookups are by `?username=` / `?key=`,
> and Basic auth accepts **any** username/password (the server never returns `401`).

---

## What you get

- Full CRUD for issues, projects, comments, and transitions.
- JQL search (a pragmatic subset — see [docs/JQL.md](docs/JQL.md)) over `GET`/`POST /search`.
- Server-shaped metadata: `serverInfo`, `myself`, `priority`, `status`, `issuetype`, `field`.
- A software-license stub so the client's product checks pass.
- An admin dashboard at `/admin` (issue detail panel, pagination, filters) and interactive
  Swagger docs at `/docs`.
- Seed data (`APIRE` / `OFS` / `DEMO` projects, mock + real company users, sample issues)
  loaded on first startup.

---

## Seeded Users

`app/seed.py` pre-seeds every user the mock needs, so a full container wipe
(`docker compose down -v`) or an admin-dashboard reset always restores them — no manual SQL
required. The `name` field in each user object is what OSM sends as `assignee.name` when it
creates a ticket.

| Category | Usernames |
| -------- | --------- |
| Mock users (referenced by the seeded demo issues) | `admin`, `developer1`, `qaengineer` |
| Company users — long-form (OSM LDAP format) | `mastergulsena`, `gulsenabu`, `bsinem`, `fundabussines`, `bsnsila2`, `maakinci` |
| Company users — short-form | `gulsenab`, `sinemk`, `fundas`, `silak` |
| Test accounts | `testmp` |

---

## Known OSM Integration Behavior

Observed from live OSM traffic against this mock:

- OSM sends the project by **numeric id**, not key — `{"project": {"id": "10000"}}`.
  The mock resolves both id and key.
- OSM sends **issuetype and priority by numeric id** — `{"issuetype": {"id": "10002"}}`,
  `{"priority": {"id": "2"}}`. The mock resolves both id and name.
- OSM sends the assignee as `{"assignee": {"name": "<username>"}}` where the username matches
  the OSM platform username (long-form or short-form — both are seeded).
- The TEST tab in OSM sends **no assignee** — those tickets appear as *Unassigned*, which is
  expected.
- Real offensive scan tickets include the **full multi-line vulnerability description**; the
  admin dashboard renders it verbatim (newlines preserved) in the issue detail panel.

---

## Quick start A — local (needs a local Postgres)

You must have PostgreSQL 15 reachable at `DATABASE_URL`
(default `postgresql://jira:jira_password@localhost:5432/jira_mock`).

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Tables are created automatically on startup, and seed data is loaded if the database is empty.

## Quick start B — Docker Compose (recommended)

This starts the API **and** a PostgreSQL 15 container — no local Postgres required:

```bash
docker compose up
```

The API is then available at <http://localhost:8080>.

---

## Using it from the pycontribs/jira client

```python
from jira import JIRA

# Basic auth accepts ANY username/password — the server never returns 401.
jira = JIRA(server="http://localhost:8080", basic_auth=("admin", "any-password"))

issue = jira.issue("APIRE-1")
print(issue.fields.summary)

# Create an issue
new = jira.create_issue(
    project="APIRE",
    summary="Fix login redirect",
    description="Redirect loops on SSO logout",
    issuetype={"name": "Bug"},
)
print(new.key)

# Search with JQL
for i in jira.search_issues("project = APIRE AND status = 'In Progress' ORDER BY created DESC"):
    print(i.key, i.fields.summary)

# Transition an issue
jira.transition_issue("APIRE-1", "In Progress")
```

---

## Endpoints

All endpoints below live under `/rest/api/2` unless a full path is shown.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/serverInfo` | Server info (deploymentType `Server`, API v2) |
| GET | `/myself` | Current user (from Basic auth username) |
| GET | `/priority` | List of 5 priorities |
| GET | `/field` | Field metadata list |
| GET | `/status` | List of statuses |
| GET | `/issuetype` | List of issue types (Task, Bug, Story) |
| GET | `/project` | List all projects |
| GET | `/project/{key}` | Get one project |
| POST | `/project` | Create a project (201) |
| GET | `/project/{key}/statuses` | Statuses per issue type |
| GET | `/Project/{key}/statuses` | Capital-P alias of the above |
| POST | `/issue` | Create an issue (201, minimal `{id,key,self}`) |
| POST | `/issues` | Alias of `POST /issue` |
| GET | `/issue/{key}` | Get an issue (by `APIRE-1` or numeric `10001`) |
| PUT | `/issue/{key}` | Update issue fields (204) |
| DELETE | `/issue/{key}` | Delete an issue (204; later GET → 404) |
| GET | `/issue/{key}/transitions` | Available transitions |
| POST | `/issue/{key}/transitions` | Apply a transition (204, updates status) |
| GET | `/issue/{key}/comment` | List comments |
| POST | `/issue/{key}/comment` | Add a comment (201) |
| GET | `/issue/{key}/changelog` | Changelog stub (always empty `histories`) |
| GET | `/issue/createmeta` | Create metadata (projects + issue types) |
| GET | `/search` | JQL search (`jql`, `maxResults`, `startAt`) |
| POST | `/search` | JQL search (JSON body) |
| GET | `/user` | Get a user (`?username=` or `?key=`) |
| GET | `/user/search` | Search users (`?query=`) |
| GET | `/rest/plugins/applications/1.0/installed/jira-software/license` | License stub |
| GET | `/admin` | Admin dashboard (HTML) |
| GET | `/api/admin/data` | Admin data (JSON) |
| GET | `/api/admin/issue/{key}` | Single-issue detail for the dashboard panel (JSON) |
| DELETE | `/api/admin/reset` | Reset all data |

Full request/response examples are in [docs/API.md](docs/API.md).

---

## Admin dashboard & API docs

- **Admin dashboard:** <http://localhost:8080/admin>
  - **Click any issue row** to open a right-side slide-in panel with the full issue detail
    (metadata, comments, and the complete vulnerability finding with newlines preserved).
  - **Pagination:** the issues table shows 25 issues per page with Previous/Next controls.
  - **Filters:** project, status, assignee, and free-text search, plus a live issue count.
  - Live stats and a request log, auto-refreshing every 3 seconds (an open detail panel
    survives the refresh and updates in place).
- **Swagger / OpenAPI UI:** <http://localhost:8080/docs>
- **ReDoc:** <http://localhost:8080/redoc>

---

## Deployment

The live deployment (nspre, `jira-server.xsight.network:8080`) is **not a git checkout** —
the files were copied to the host manually. After pushing to GitHub, update the host in
three steps:

```bash
# 1. Clone the fresh code to a temp dir on the host
git clone https://github.com/bezeky/mock-jira-server.git /tmp/mock-jira-server

# 2. Copy the changed files over the deployed tree (adjust the target path to the
#    directory that holds the running docker-compose.yml)
cp -R /tmp/mock-jira-server/app \
      /tmp/mock-jira-server/Dockerfile \
      /tmp/mock-jira-server/docker-compose.yml \
      /tmp/mock-jira-server/requirements.txt \
      /opt/mock-jira-server/

# 3. Rebuild and restart
cd /opt/mock-jira-server && docker compose up -d --build
```

PostgreSQL data lives in the compose volume, so a rebuild keeps all existing tickets.
Only `docker compose down -v` wipes it — and since v2.0.0 the seed restores all real
company users automatically after a wipe.

---

## Environment variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `DATABASE_URL` | `postgresql://jira:jira_password@localhost:5432/jira_mock` | PostgreSQL connection string |
| `BASE_URL` | `http://localhost:8080` | Base URL used to build `self` links |
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `8080` | Bind port |
| `SEED_DATA` | `True` | Load seed data on first startup if DB is empty |
| `LOG_LEVEL` | `INFO` | Logging level |

Copy `.env.example` to `.env` to override any of these.

---

## A note on Server vs Cloud

This project deliberately mocks the **Server / Data Center** REST API (`/rest/api/2`), which
differs from Jira Cloud in ways that break clients if you mix them up:

- Users are identified by `name` / `key` (usernames), never `accountId`.
- `serverInfo.deploymentType` is `"Server"`.
- Assignee is set with `{"assignee": {"name": "john"}}`.
- No `accountId` / `accountType` / `locale` fields appear anywhere.

If you need a Cloud mock, this is not it.
