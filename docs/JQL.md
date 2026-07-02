# JQL Support

The mock server implements a pragmatic subset of JQL, evaluated in pure Python over the stored
issue objects. It is intentionally forgiving: **malformed queries never raise** — unrecognized
clauses are ignored and the server returns a best-effort result. An empty or missing `jql`
returns all issues.

Use it via `GET /rest/api/2/search?jql=...` or `POST /rest/api/2/search` with
`{"jql": "...", "maxResults": 50, "startAt": 0}`.

---

## How a query is parsed

1. **`ORDER BY` is extracted first** (case-insensitive). Everything before it is the condition
   part; everything after is the sort spec.
2. The condition part is split on **`OR`** (lowest precedence) into groups.
3. Each group is split on **`AND`** into individual predicates.
4. An issue **matches** if **any** OR-group matches, where a group matches only if **all** of
   its AND predicates hold.

Field names and string values are **case-insensitive**. String values may be quoted with
single (`'`) or double (`"`) quotes; quotes are required when the value contains spaces.

---

## Supported clauses

| Clause | Meaning |
| ------ | ------- |
| `project = X` | Match the issue's project **key or name** (case-insensitive) |
| `status = X` | Exact status name match |
| `status != X` | Status name does not match |
| `assignee = X` | Assignee username equals `X` |
| `assignee = currentUser()` | Assignee equals the Basic-auth username of the request |
| `assignee is EMPTY` | Issue has no assignee (`assignee` is null) |
| `issuetype = X` | Issue type name (e.g. `Task`, `Bug`, `Story`) |
| `priority = X` | Priority name (e.g. `High`, `Medium`) |
| `summary ~ "X"` | Case-insensitive **substring** match on the summary |
| `text ~ "X"` | Substring match across summary **and** description |
| `key = X` | Exact issue key match (case-insensitive), e.g. `APIRE-1` |

Operators supported: `=`, `!=`, `~` (contains), and `is EMPTY`.

### ORDER BY

```
ORDER BY <field> [ASC|DESC]
```

- Fields: `created`, `updated`, `key`.
- `created` / `updated` sort on the issue's timestamp fields; `key` sorts alphanumerically on
  the issue key.
- Direction defaults to `ASC` when omitted.

---

## Example queries

1. **All issues in a project**

   ```
   project = APIRE
   ```
   Returns every issue whose project key or name is `APIRE`.

2. **By project name (case-insensitive)**

   ```
   project = "apire security gateway"
   ```
   Same project, matched on the project's display name.

3. **Open work in progress**

   ```
   project = APIRE AND status = "In Progress"
   ```
   Issues in `APIRE` currently in the `In Progress` status.

4. **Everything not yet done**

   ```
   status != Done
   ```
   All issues whose status is anything other than `Done`.

5. **My assigned issues**

   ```
   assignee = currentUser()
   ```
   Issues assigned to the username in the request's Basic auth header.

6. **A specific person's issues**

   ```
   assignee = developer1
   ```
   Issues assigned to `developer1`.

7. **Unassigned issues**

   ```
   assignee is EMPTY
   ```
   Issues with no assignee.

8. **Bugs of high priority**

   ```
   issuetype = Bug AND priority = High
   ```
   Issues that are both `Bug` type and `High` priority.

9. **Summary contains a phrase**

   ```
   summary ~ "token expiry"
   ```
   Issues whose summary contains the substring `token expiry` (case-insensitive).

10. **Free-text search across summary and description**

    ```
    text ~ "redirect loop"
    ```
    Issues where either the summary or description contains `redirect loop`.

11. **Look up one issue by key**

    ```
    key = APIRE-1
    ```
    The single issue `APIRE-1` (case-insensitive).

12. **Combined AND + OR**

    ```
    project = APIRE AND status = "In Progress" OR assignee = currentUser()
    ```
    Matches issues that are (in `APIRE` **and** `In Progress`) **or** assigned to the current
    user. Note `OR` has the lowest precedence, so it splits the whole query into two groups.

13. **Sorted, newest first**

    ```
    project = APIRE ORDER BY created DESC
    ```
    All `APIRE` issues, most recently created first.

14. **Sorted by key ascending**

    ```
    status != Done ORDER BY key ASC
    ```
    All not-done issues, ordered by issue key.

---

## Notes and limitations

- Precedence is fixed: `OR` splits first, then `AND`. There is no parenthesis grouping.
- Unrecognized clauses (anything not in the table above) are silently ignored rather than
  causing an error.
- Comparisons on string fields are case-insensitive.
- Because evaluation is best-effort, a syntactically broken query will still return a (possibly
  empty or unfiltered) result instead of a `400`.
