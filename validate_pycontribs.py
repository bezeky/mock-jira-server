from jira import JIRA

jira = JIRA(server="http://localhost:8080", basic_auth=("admin", "any-password"))

# Connection + Server-style user shape
me = jira.myself()
print("name:", me.get("name"))          # must be "admin", NOT accountId

# Read seeded issue
issue = jira.issue("APIRE-1")
print("summary:", issue.fields.summary)
print("status:", issue.fields.status.name)
print("reporter:", issue.fields.reporter.name)  # will crash if Cloud shape was used

# Search
results = jira.search_issues("project = APIRE AND status = 'In Progress'", maxResults=10)
print(f"found {len(results)} issues")

# Create
new = jira.create_issue(fields={
    "project": {"key": "DEMO"},
    "summary": "Library validation test",
    "issuetype": {"name": "Task"},
    "assignee": {"name": "developer1"}
})
print("created:", new.key)

# Comment
jira.add_comment("APIRE-1", "Test comment from pycontribs")
print("comment added OK")

# Transition
transitions = jira.transitions("APIRE-1")
print("transitions:", [t["name"] for t in transitions])
jira.transition_issue("APIRE-1", "21")  # move to In Progress
print("transition OK")

print("\n=== ALL VALIDATION STEPS PASSED ===")
