# Mock Jira Server

A mock **Jira Server / Data Center** (on-premise) **REST API v2** implementation, built with
Python 3.11+, FastAPI, Pydantic v2, and PostgreSQL. It exists to let you develop and test
integrations against the [pycontribs/jira](https://github.com/pycontribs/jira) Python client
(Server flavor) without a real Jira instance.

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
- An admin dashboard at `/admin` and interactive Swagger docs at `/docs`.
- Seed data (one `APIRE` project plus users and issues) loaded on first startup.

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
| GET | `/search` | JQL search (`jql`, `maxResults`, `startAt`) |
| POST | `/search` | JQL search (JSON body) |
| GET | `/user` | Get a user (`?username=` or `?key=`) |
| GET | `/user/search` | Search users (`?query=`) |
| GET | `/rest/plugins/applications/1.0/installed/jira-software/license` | License stub |
| GET | `/admin` | Admin dashboard (HTML) |
| GET | `/api/admin/data` | Admin data (JSON) |
| DELETE | `/api/admin/reset` | Reset all data |

Full request/response examples are in [docs/API.md](docs/API.md).

---

## Admin dashboard & API docs

- **Admin dashboard:** <http://localhost:8080/admin>
- **Swagger / OpenAPI UI:** <http://localhost:8080/docs>
- **ReDoc:** <http://localhost:8080/redoc>

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
