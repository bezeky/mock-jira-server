/**
 * Seed data loader for the Mock Jira Server (Server / Data Center flavor).
 *
 * `loadSeedData(store)` populates the store with a deterministic data set:
 * the Server-style users below (mock + real company users), three projects,
 * and five issues per project.
 *
 * Idempotency is the caller's responsibility: index.ts invokes this only when
 * `store.listProjects()` is empty. Numeric ids come from the store's issue
 * sequence (starting at 10001) via `store.nextIssueKeyAndId`.
 */

import * as shapes from "./shapes";
import { Store } from "./store";

// [name, displayName, emailAddress]
const _USERS: Array<[string, string, string]> = [
  // Original mock users — keep for backward compat with existing seed issues
  ["admin", "Mock Admin", "admin@mockjira.com"],
  ["developer1", "Developer One", "dev@mockjira.com"],
  ["qaengineer", "QA Engineer", "qa@mockjira.com"],
  // Real company users — OSM sends these as assignee.name during ticket creation
  // Long-form email usernames (OSM LDAP format)
  ["mastergulsena", "Gülsena Buran", "mastergulsena@secrcomp.com"],
  ["gulsenabu", "Gülsena Buran", "gulsenabu@secrcomp.com"],
  ["bsinem", "Sinem Kılıçarslan", "sinemklc@gmail.com"],
  ["fundabussines", "Funda Sensen", "indabussines@secrcomp.com"],
  ["bsnsila2", "Sıla Kara", "bsnsila2@secrcomp.com"],
  ["maakinci", "Arda Akıncı", "maakinci@secrcomp.com"],
  // Short-form usernames (OSM may send either format)
  ["gulsenab", "Gülsena Buran", "gulsenab@secrcomp.com"],
  ["sinemk", "Sinem Kılıçarslan", "sinemk@secrcomp.com"],
  ["fundas", "Funda Sensen", "fundas@secrcomp.com"],
  ["silak", "Sıla Kara", "silak@secrcomp.com"],
  // Test accounts
  ["testmp", "Test User", "test@secrcomp.com"],
  // Full-email usernames (OSM may send the whole address as the username)
  ["bgulsena@secrcomp.com", "Gülsena Buran", "bgulsena@secrcomp.com"],
  ["mastersila2@secrcomp.com", "Sıla Kara", "mastersila2@secrcomp.com"],
  ["bsnsila2@secrcomp.com", "Sıla Kara", "bsnsila2@secrcomp.com"],
  ["silak@secrcomp.com", "Sıla Kara", "silak@secrcomp.com"],
  ["fundamaster@secrcomp.com", "Funda Sen", "fundamaster@secrcomp.com"],
  ["maakinci@secrcomp.com", "Arda Akıncı", "maakinci@secrcomp.com"],
  ["masterfurkan", "Furkan", "masterfurkan@gmail.com"],
  ["masterfurkan@gmail.com", "Furkan", "masterfurkan@gmail.com"],
  ["businessfurkan", "Furkan", "businessfurkan@gmail.com"],
  ["businessfurkan@gmail.com", "Furkan", "businessfurkan@gmail.com"],
];

// [key, id, name]
const _PROJECTS: Array<[string, string, string]> = [
  ["APIRE", "10000", "APIRE Security Gateway"],
  ["OFS", "10001", "OFSecMan Platform"],
  ["DEMO", "10002", "Demo Project"],
];

// project_key -> list of [summary, issuetype, priority, status, assignee]
// assignee "unassigned" => no assignee (null)
const _ISSUES: Record<string, Array<[string, string, string, string, string]>> = {
  APIRE: [
    ["Implement API rate limiting", "Task", "High", "In Progress", "developer1"],
    ["Fix JWT token expiry", "Bug", "Highest", "In Progress", "developer1"],
    ["Add OAuth2 support", "Story", "Medium", "To Do", "unassigned"],
    ["Write API documentation", "Task", "Low", "Done", "qaengineer"],
    ["Security audit remediation", "Bug", "High", "To Do", "unassigned"],
  ],
  OFS: [
    ["Set up CTEM pipeline", "Task", "High", "In Progress", "developer1"],
    ["Offensive scan module", "Story", "Medium", "To Do", "unassigned"],
    ["Fix false positive rate", "Bug", "High", "In Review", "qaengineer"],
    ["Reporting dashboard", "Task", "Medium", "Done", "developer1"],
    ["SIEM integration", "Story", "High", "To Do", "unassigned"],
  ],
  DEMO: [
    ["Hello World endpoint", "Task", "Low", "Done", "developer1"],
    ["Test search functionality", "Task", "Medium", "In Progress", "qaengineer"],
    ["Sample bug report", "Bug", "High", "To Do", "unassigned"],
    ["Add demo seed data", "Task", "Low", "Done", "admin"],
    ["Configure mock webhooks", "Task", "Medium", "To Do", "unassigned"],
  ],
};

/** Seed users, projects, then issues. Assumes an empty store. */
export async function loadSeedData(store: Store): Promise<void> {
  // --- Users -------------------------------------------------------------
  for (const [name, displayName, email] of _USERS) {
    const user = shapes.userShape({
      name,
      key: name,
      displayName,
      emailAddress: email,
      active: true,
    });
    await store.saveUser(user);
  }

  const adminUser = await store.getUserByName("admin");

  // --- Projects ----------------------------------------------------------
  const projectsByKey: Record<string, any> = {};
  for (const [key, pid, name] of _PROJECTS) {
    const storedProject: any = {
      id: pid,
      key,
      name,
      projectTypeKey: "software",
      lead: "admin",
    };
    // APIRE explicitly carries its issueTypes so a post-reset admin
    // dashboard shows them correctly. Set BEFORE saveProject: the Postgres
    // store serializes the object at call time, so a post-save mutation
    // would never reach the JSONB payload.
    if (key === "APIRE") {
      storedProject.issueTypes = [
        { id: "10001", name: "Task", subtask: false },
        { id: "10002", name: "Bug", subtask: false },
        { id: "10003", name: "Story", subtask: false },
      ];
    }
    await store.saveProject(storedProject);
    projectsByKey[key] = storedProject;
  }

  // --- Issues ------------------------------------------------------------
  for (const [key] of _PROJECTS) {
    const project = projectsByKey[key];
    for (const [summary, issuetype, priority, status, assignee] of _ISSUES[key]) {
      const [issueKey, numericId] = await store.nextIssueKeyAndId(key);
      let assigneeUser: any = null;
      if (assignee !== "unassigned") {
        assigneeUser = await store.getUserByName(assignee);
      }
      const now = shapes.nowJira();
      const issue = shapes.buildIssue({
        key: issueKey,
        numericId,
        project,
        summary,
        issuetypeName: issuetype,
        priorityName: priority,
        statusName: status,
        assigneeUser,
        reporterUser: adminUser,
        creatorUser: adminUser,
        created: now,
        updated: now,
      });
      await store.saveIssue(issue);
    }
  }
}
