# API Reference

Mock **Jira Server / Data Center** REST API **v2**. All endpoints are under `/rest/api/2`
unless a full path is shown. The base URL defaults to `http://localhost:8080` and is
configurable via `BASE_URL`.

**Auth:** HTTP Basic. Any username/password is accepted — the server never returns `401`.
The username in the `Authorization` header selects the "current user" for `/myself` and
`assignee = currentUser()` JQL.

**Errors:** every `4xx` uses the shape:

```json
{ "errorMessages": ["Issue Does Not Exist"], "errors": {} }
```

> **Server, not Cloud:** user objects use `name` + `key` (usernames). There are no
> `accountId`, `accountType`, or `locale` fields anywhere.

---

## GET /serverInfo

```bash
curl -u admin:any http://localhost:8080/rest/api/2/serverInfo
```

```json
{
  "baseUrl": "http://localhost:8080",
  "version": "8.20.14",
  "versionNumbers": [8, 20, 14],
  "deploymentType": "Server",
  "buildNumber": 820014,
  "buildDate": "2022-01-01T00:00:00.000+0000",
  "scmInfo": "mock",
  "serverTitle": "Mock Jira Server",
  "defaultLocale": { "locale": "en_US" }
}
```

---

## GET /myself

Returns the user extracted from the Basic auth username (looked up by `name`; if not found,
the first user in the store is returned), plus `groups` and `applicationRoles` containers.

```bash
curl -u john.doe:any http://localhost:8080/rest/api/2/myself
```

```json
{
  "self": "http://localhost:8080/rest/api/2/user?username=john.doe",
  "name": "john.doe",
  "key": "john.doe",
  "emailAddress": "john@example.com",
  "displayName": "John Doe",
  "active": true,
  "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" },
  "groups": { "size": 1, "items": [] },
  "applicationRoles": { "size": 1, "items": [] }
}
```

---

## GET /project

```bash
curl -u admin:any http://localhost:8080/rest/api/2/project
```

Returns an array of full project objects.

## GET /project/{key}

```bash
curl -u admin:any http://localhost:8080/rest/api/2/project/APIRE
```

```json
{
  "id": "10000",
  "key": "APIRE",
  "name": "APIRE Security Gateway",
  "self": "http://localhost:8080/rest/api/2/project/10000",
  "projectTypeKey": "software",
  "lead": {
    "self": "http://localhost:8080/rest/api/2/user?username=admin",
    "name": "admin",
    "key": "admin",
    "emailAddress": "admin@example.com",
    "displayName": "Administrator",
    "active": true,
    "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" }
  },
  "description": "",
  "components": [],
  "versions": [],
  "issueTypes": [
    { "id": "10001", "name": "Task", "self": "http://localhost:8080/rest/api/2/issuetype/10001", "description": "", "iconUrl": "", "subtask": false },
    { "id": "10002", "name": "Bug", "self": "http://localhost:8080/rest/api/2/issuetype/10002", "description": "", "iconUrl": "", "subtask": false },
    { "id": "10003", "name": "Story", "self": "http://localhost:8080/rest/api/2/issuetype/10003", "description": "", "iconUrl": "", "subtask": false }
  ],
  "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" },
  "assigneeType": "PROJECT_LEAD"
}
```

Unknown project → `404` with the error body.

## POST /project

```bash
curl -u admin:any -X POST http://localhost:8080/rest/api/2/project \
  -H 'Content-Type: application/json' \
  -d '{"key":"NEW","name":"New Project","projectTypeKey":"software","lead":"admin"}'
```

Returns `201` with the full project object (same shape as `GET /project/{key}`).

---

## GET /project/{key}/statuses

Also available at the capital-P alias `GET /Project/{key}/statuses`. Returns a JSON array,
one entry per issue type, each listing the four workflow statuses.

```bash
curl -u admin:any http://localhost:8080/rest/api/2/project/APIRE/statuses
```

```json
[
  {
    "id": "10001",
    "name": "Task",
    "subtask": false,
    "self": "http://localhost:8080/rest/api/2/issuetype/10001",
    "statuses": [
      { "id": "1", "name": "To Do",       "self": "http://localhost:8080/rest/api/2/status/1", "statusCategory": { "id": 2, "key": "new",           "colorName": "blue-gray", "name": "To Do" } },
      { "id": "3", "name": "In Progress", "self": "http://localhost:8080/rest/api/2/status/3", "statusCategory": { "id": 4, "key": "indeterminate", "colorName": "yellow",    "name": "In Progress" } },
      { "id": "4", "name": "In Review",   "self": "http://localhost:8080/rest/api/2/status/4", "statusCategory": { "id": 4, "key": "indeterminate", "colorName": "yellow",    "name": "In Progress" } },
      { "id": "5", "name": "Done",        "self": "http://localhost:8080/rest/api/2/status/5", "statusCategory": { "id": 3, "key": "done",          "colorName": "green",     "name": "Done" } }
    ]
  }
]
```

(The `Bug` and `Story` issue types carry the same four statuses.)

---

## GET /issue/{key}

Accepts either the issue key (`APIRE-1`) or the numeric id (`10001`).

```bash
curl -u admin:any http://localhost:8080/rest/api/2/issue/APIRE-1
```

```json
{
  "id": "10001",
  "key": "APIRE-1",
  "self": "http://localhost:8080/rest/api/2/issue/10001",
  "expand": "renderedFields,names,schema,operations,editmeta,changelog",
  "fields": {
    "summary": "Fix JWT token expiry bug",
    "description": "Description text here",
    "status": {
      "id": "3", "name": "In Progress",
      "self": "http://localhost:8080/rest/api/2/status/3",
      "description": "", "iconUrl": "http://localhost:8080/",
      "statusCategory": { "id": 4, "key": "indeterminate", "colorName": "yellow", "name": "In Progress", "self": "http://localhost:8080/rest/api/2/statuscategory/4" }
    },
    "priority": { "id": "2", "name": "High", "self": "http://localhost:8080/rest/api/2/priority/2", "iconUrl": "" },
    "issuetype": { "id": "10002", "name": "Bug", "self": "http://localhost:8080/rest/api/2/issuetype/10002", "description": "", "iconUrl": "", "subtask": false },
    "project": { "id": "10000", "key": "APIRE", "name": "APIRE Security Gateway", "self": "http://localhost:8080/rest/api/2/project/10000", "projectTypeKey": "software" },
    "assignee": {
      "self": "http://localhost:8080/rest/api/2/user?username=developer1",
      "name": "developer1", "key": "developer1",
      "emailAddress": "dev1@example.com", "displayName": "Developer One", "active": true,
      "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" }
    },
    "reporter": { "self": "http://localhost:8080/rest/api/2/user?username=admin", "name": "admin", "key": "admin", "emailAddress": "admin@example.com", "displayName": "Administrator", "active": true, "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" } },
    "creator":  { "self": "http://localhost:8080/rest/api/2/user?username=admin", "name": "admin", "key": "admin", "emailAddress": "admin@example.com", "displayName": "Administrator", "active": true, "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" } },
    "created": "2024-01-01T10:00:00.000+0000",
    "updated": "2024-01-01T10:00:00.000+0000",
    "resolutiondate": null,
    "duedate": null,
    "labels": [], "components": [], "fixVersions": [], "attachment": [], "subtasks": [],
    "comment": { "comments": [], "maxResults": 10, "total": 0, "startAt": 0 },
    "worklog": { "worklogs": [], "maxResults": 20, "total": 0, "startAt": 0 }
  }
}
```

Unknown issue → `404` with `{"errorMessages":["Issue Does Not Exist"],"errors":{}}`.

---

## POST /issue

Also available as `POST /issues`.

```bash
curl -u developer1:any -X POST http://localhost:8080/rest/api/2/issue \
  -H 'Content-Type: application/json' \
  -d '{
        "fields": {
          "project": {"key": "APIRE"},
          "summary": "Fix login redirect",
          "description": "Redirect loops on SSO logout",
          "issuetype": {"name": "Bug"},
          "priority": {"name": "High"},
          "assignee": {"name": "developer1"}
        }
      }'
```

Returns `201`:

```json
{ "id": "10002", "key": "APIRE-2", "self": "http://localhost:8080/rest/api/2/issue/10002" }
```

## PUT /issue/{key}

```bash
curl -u admin:any -X PUT http://localhost:8080/rest/api/2/issue/APIRE-1 \
  -H 'Content-Type: application/json' \
  -d '{"fields": {"summary": "Updated summary", "status": {"name": "Done"}}}'
```

Returns `204 No Content`.

## DELETE /issue/{key}

```bash
curl -u admin:any -X DELETE http://localhost:8080/rest/api/2/issue/APIRE-1
```

Returns `204`. A subsequent `GET` returns `404`.

---

## GET /issue/{key}/transitions

```bash
curl -u admin:any http://localhost:8080/rest/api/2/issue/APIRE-1/transitions
```

```json
{
  "expand": "transitions",
  "transitions": [
    { "id": "11", "name": "To Do",       "self": "http://localhost:8080/rest/api/2/issue/APIRE-1/transitions", "to": { "id": "1", "name": "To Do",       "statusCategory": { "id": 2, "key": "new",           "colorName": "blue-gray", "name": "To Do" } } },
    { "id": "21", "name": "In Progress", "self": "http://localhost:8080/rest/api/2/issue/APIRE-1/transitions", "to": { "id": "3", "name": "In Progress", "statusCategory": { "id": 4, "key": "indeterminate", "colorName": "yellow",    "name": "In Progress" } } },
    { "id": "31", "name": "In Review",   "self": "http://localhost:8080/rest/api/2/issue/APIRE-1/transitions", "to": { "id": "4", "name": "In Review",   "statusCategory": { "id": 4, "key": "indeterminate", "colorName": "yellow",    "name": "In Progress" } } },
    { "id": "41", "name": "Done",        "self": "http://localhost:8080/rest/api/2/issue/APIRE-1/transitions", "to": { "id": "5", "name": "Done",        "statusCategory": { "id": 3, "key": "done",          "colorName": "green",     "name": "Done" } } }
  ]
}
```

## POST /issue/{key}/transitions

```bash
curl -u admin:any -X POST http://localhost:8080/rest/api/2/issue/APIRE-1/transitions \
  -H 'Content-Type: application/json' \
  -d '{"transition": {"id": "21"}}'
```

Returns `204` and updates the issue status. Transition id → status:
`11` → To Do, `21` → In Progress, `31` → In Review, `41` → Done.

---

## GET /issue/{key}/changelog

Minimal changelog stub for clients that request field history. This mock does not track
field history, so `histories` is always empty. Accepts the issue key or numeric id;
unknown issue → `404` with the standard error body.

```bash
curl -u admin:any http://localhost:8080/rest/api/2/issue/APIRE-1/changelog
```

```json
{ "startAt": 0, "maxResults": 50, "total": 0, "histories": [] }
```

---

## Comments

### GET /issue/{key}/comment

```bash
curl -u admin:any http://localhost:8080/rest/api/2/issue/APIRE-1/comment
```

### POST /issue/{key}/comment

```bash
curl -u admin:any -X POST http://localhost:8080/rest/api/2/issue/APIRE-1/comment \
  -H 'Content-Type: application/json' \
  -d '{"body": "Looks good to me."}'
```

Returns `201`:

```json
{
  "self": "http://localhost:8080/rest/api/2/issue/APIRE-1/comment/10100",
  "id": "10100",
  "author": { "self": "http://localhost:8080/rest/api/2/user?username=admin", "name": "admin", "key": "admin", "emailAddress": "admin@example.com", "displayName": "Administrator", "active": true, "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" } },
  "body": "Looks good to me.",
  "updateAuthor": { "self": "http://localhost:8080/rest/api/2/user?username=admin", "name": "admin", "key": "admin", "emailAddress": "admin@example.com", "displayName": "Administrator", "active": true, "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" } },
  "created": "2024-01-01T10:00:00.000+0000",
  "updated": "2024-01-01T10:00:00.000+0000"
}
```

---

## Search

### GET /search

```bash
curl -u admin:any --get http://localhost:8080/rest/api/2/search \
  --data-urlencode 'jql=project = APIRE AND status = "In Progress" ORDER BY created DESC' \
  --data-urlencode 'maxResults=50' \
  --data-urlencode 'startAt=0'
```

### POST /search

```bash
curl -u admin:any -X POST http://localhost:8080/rest/api/2/search \
  -H 'Content-Type: application/json' \
  -d '{"jql": "assignee = currentUser()", "maxResults": 50, "startAt": 0}'
```

Response:

```json
{
  "expand": "names,schema",
  "startAt": 0,
  "maxResults": 50,
  "total": 5,
  "issues": [ "...full issue shapes..." ]
}
```

See [JQL.md](JQL.md) for supported query syntax.

---

## Users

### GET /user

Look up by `username` or `key`.

```bash
curl -u admin:any 'http://localhost:8080/rest/api/2/user?username=john.doe'
curl -u admin:any 'http://localhost:8080/rest/api/2/user?key=john.doe'
```

```json
{
  "self": "http://localhost:8080/rest/api/2/user?username=john.doe",
  "name": "john.doe",
  "key": "john.doe",
  "emailAddress": "john@example.com",
  "displayName": "John Doe",
  "active": true,
  "avatarUrls": { "48x48": "", "24x24": "", "16x16": "", "32x32": "" }
}
```

Unknown user → `404`.

### GET /user/search

```bash
curl -u admin:any 'http://localhost:8080/rest/api/2/user/search?query=john'
```

Returns an array of matching user objects (matched on `name` / `displayName` / email).

---

## Metadata

```bash
curl -u admin:any http://localhost:8080/rest/api/2/priority
curl -u admin:any http://localhost:8080/rest/api/2/status
curl -u admin:any http://localhost:8080/rest/api/2/issuetype
curl -u admin:any http://localhost:8080/rest/api/2/field
```

`GET /priority` returns:

```json
[
  { "id": "1", "name": "Highest", "self": "http://localhost:8080/rest/api/2/priority/1", "iconUrl": "", "statusColor": "ff0000" },
  { "id": "2", "name": "High",    "self": "http://localhost:8080/rest/api/2/priority/2", "iconUrl": "", "statusColor": "ff7700" },
  { "id": "3", "name": "Medium",  "self": "http://localhost:8080/rest/api/2/priority/3", "iconUrl": "", "statusColor": "ffaa00" },
  { "id": "4", "name": "Low",     "self": "http://localhost:8080/rest/api/2/priority/4", "iconUrl": "", "statusColor": "2aaee6" },
  { "id": "5", "name": "Lowest",  "self": "http://localhost:8080/rest/api/2/priority/5", "iconUrl": "", "statusColor": "57d9a3" }
]
```

---

## License stub

```bash
curl -u admin:any \
  http://localhost:8080/rest/plugins/applications/1.0/installed/jira-software/license
```

```json
{
  "valid": true,
  "evaluation": false,
  "maximumNumberOfUsers": -1,
  "contactEmail": "admin@mockjira.com",
  "creationDate": "2020-01-01",
  "expiryDate": "2099-12-31",
  "rawLicense": "AAABRg0ODAoPeJytUEtPwzAMvvdXROLasOxACipb1WkgTaJSmxi4RC1LoFIS",
  "licenseType": "COMMERCIAL",
  "unlimited": true
}
```

---

## Admin (no `/rest` prefix)

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/admin` | HTML dashboard |
| GET | `/api/admin/data` | Store contents + recent request log (JSON) |
| GET | `/api/admin/issue/{key}` | Single-issue detail for the dashboard panel (JSON) |
| DELETE | `/api/admin/reset` | Clear all data and reset counters |

```bash
curl http://localhost:8080/api/admin/data
curl http://localhost:8080/api/admin/issue/APIRE-1
curl -X DELETE http://localhost:8080/api/admin/reset
```

`GET /api/admin/issue/{key}` returns the flat dashboard row for one issue plus its full
`description` (never `null` — coerced to `""`), `comments`, `reporter`, `created`, and
`updated`. Unknown issue → `404 {"error": "not found"}`.
