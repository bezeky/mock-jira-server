"""Seed data loader for the Mock Jira Server (Server / Data Center flavor).

``load_seed_data(store)`` populates the store with a small, deterministic data
set: three Server-style users, three projects, and five issues per project.

Idempotency is the caller's responsibility: ``main.py`` invokes this only when
``store.list_projects()`` is empty. Numeric ids come from the store's issue
sequence (starting at 10001) via ``store.next_issue_key_and_id``.
"""

from app import shapes


# (name, displayName, emailAddress)
_USERS = [
    ("admin", "Mock Admin", "admin@mockjira.com"),
    ("developer1", "Developer One", "dev@mockjira.com"),
    ("qaengineer", "QA Engineer", "qa@mockjira.com"),
]

# (key, id, name)
_PROJECTS = [
    ("APIRE", "10000", "APIRE Security Gateway"),
    ("OFS", "10001", "OFSecMan Platform"),
    ("DEMO", "10002", "Demo Project"),
]

# project_key -> list of (summary, issuetype, priority, status, assignee)
# assignee "unassigned" => no assignee (None)
_ISSUES = {
    "APIRE": [
        ("Implement API rate limiting", "Task", "High", "In Progress", "developer1"),
        ("Fix JWT token expiry", "Bug", "Highest", "In Progress", "developer1"),
        ("Add OAuth2 support", "Story", "Medium", "To Do", "unassigned"),
        ("Write API documentation", "Task", "Low", "Done", "qaengineer"),
        ("Security audit remediation", "Bug", "High", "To Do", "unassigned"),
    ],
    "OFS": [
        ("Set up CTEM pipeline", "Task", "High", "In Progress", "developer1"),
        ("Offensive scan module", "Story", "Medium", "To Do", "unassigned"),
        ("Fix false positive rate", "Bug", "High", "In Review", "qaengineer"),
        ("Reporting dashboard", "Task", "Medium", "Done", "developer1"),
        ("SIEM integration", "Story", "High", "To Do", "unassigned"),
    ],
    "DEMO": [
        ("Hello World endpoint", "Task", "Low", "Done", "developer1"),
        ("Test search functionality", "Task", "Medium", "In Progress", "qaengineer"),
        ("Sample bug report", "Bug", "High", "To Do", "unassigned"),
        ("Add demo seed data", "Task", "Low", "Done", "admin"),
        ("Configure mock webhooks", "Task", "Medium", "To Do", "unassigned"),
    ],
}


def load_seed_data(store):
    """Seed users, projects, then issues. Assumes an empty store."""
    # --- Users -------------------------------------------------------------
    for name, display_name, email in _USERS:
        user = shapes.user_shape(
            {
                "name": name,
                "key": name,
                "displayName": display_name,
                "emailAddress": email,
                "active": True,
            }
        )
        store.save_user(user)

    admin_user = store.get_user_by_name("admin")

    # --- Projects ----------------------------------------------------------
    projects_by_key = {}
    for key, pid, name in _PROJECTS:
        stored_project = {
            "id": pid,
            "key": key,
            "name": name,
            "projectTypeKey": "software",
            "lead": "admin",
        }
        store.save_project(stored_project)
        projects_by_key[key] = stored_project

    # --- Issues ------------------------------------------------------------
    for key, _pid, _name in _PROJECTS:
        project = projects_by_key[key]
        for summary, issuetype, priority, status, assignee in _ISSUES[key]:
            issue_key, numeric_id = store.next_issue_key_and_id(key)
            if assignee == "unassigned":
                assignee_user = None
            else:
                assignee_user = store.get_user_by_name(assignee)
            now = shapes.now_jira()
            issue = shapes.build_issue(
                key=issue_key,
                numeric_id=numeric_id,
                project=project,
                summary=summary,
                issuetype_name=issuetype,
                priority_name=priority,
                status_name=status,
                assignee_user=assignee_user,
                reporter_user=admin_user,
                creator_user=admin_user,
                created=now,
                updated=now,
            )
            store.save_issue(issue)
