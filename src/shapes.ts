/**
 * JSON shape builders for the Mock Jira Server (Server / Data Center flavor).
 *
 * Every function here produces Server-style JSON. User objects use "name" and
 * "key" (username strings) and NEVER emit "accountId", "accountType", or
 * "locale" (those are Jira Cloud only). Self-links derive from base().
 *
 * Imports are intentionally minimal to avoid import cycles: this module must
 * not import the store.
 */

import { settings } from "./config";

// ---------------------------------------------------------------------------
// Data tables (module constants)
// ---------------------------------------------------------------------------

export interface StatusCategoryDef {
  id: number;
  key: string;
  colorName: string;
  name: string;
}

export interface StatusDef {
  id: string;
  category: StatusCategoryDef;
}

// name -> {id, category: {id, key, colorName, name}}
export const STATUS_DEFS: Record<string, StatusDef> = {
  "To Do": {
    id: "1",
    category: { id: 2, key: "new", colorName: "blue-gray", name: "To Do" },
  },
  "In Progress": {
    id: "3",
    category: { id: 4, key: "indeterminate", colorName: "yellow", name: "In Progress" },
  },
  "In Review": {
    id: "4",
    category: { id: 4, key: "indeterminate", colorName: "yellow", name: "In Progress" },
  },
  "Done": {
    id: "5",
    category: { id: 3, key: "done", colorName: "green", name: "Done" },
  },
  "Closed": {
    id: "6",
    category: { id: 3, key: "done", colorName: "green", name: "Done" },
  },
};

// [id, name, statusColor]
export const PRIORITY_DEFS: Array<[string, string, string]> = [
  ["1", "Highest", "ff0000"],
  ["2", "High", "ff7700"],
  ["3", "Medium", "ffaa00"],
  ["4", "Low", "2aaee6"],
  ["5", "Lowest", "57d9a3"],
];

// [id, name]
export const ISSUETYPE_DEFS: Array<[string, string]> = [
  ["10001", "Task"],
  ["10002", "Bug"],
  ["10003", "Story"],
];

// [id, name, toStatus]
export const TRANSITION_DEFS: Array<[string, string, string]> = [
  ["11", "To Do", "To Do"],
  ["21", "In Progress", "In Progress"],
  ["31", "In Review", "In Review"],
  ["41", "Done", "Done"],
];

// Field metadata for GET /field: [id, name, schema]
const FIELD_DEFS: Array<[string, string, Record<string, unknown>]> = [
  ["summary", "Summary", { type: "string" }],
  ["description", "Description", { type: "string" }],
  ["status", "Status", { type: "status" }],
  ["priority", "Priority", { type: "priority" }],
  ["issuetype", "Issue Type", { type: "issuetype" }],
  ["project", "Project", { type: "project" }],
  ["assignee", "Assignee", { type: "user" }],
  ["reporter", "Reporter", { type: "user" }],
  ["creator", "Creator", { type: "user" }],
  ["created", "Created", { type: "datetime" }],
  ["updated", "Updated", { type: "datetime" }],
  ["labels", "Labels", { type: "array", items: "string" }],
  ["resolution", "Resolution", { type: "resolution" }],
  ["comment", "Comment", { type: "array", items: "comment" }],
  ["duedate", "Due Date", { type: "date" }],
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function base(): string {
  return settings.BASE_URL.replace(/\/+$/, "");
}

export function nowJira(): string {
  // "2026-07-29T10:00:00.000Z" -> "2026-07-29T10:00:00.000+0000"
  return new Date().toISOString().replace("Z", "+0000");
}

export function avatarUrls(): Record<string, string> {
  return { "48x48": "", "24x24": "", "16x16": "", "32x32": "" };
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/**
 * Server-style user object.
 *
 * `u` may be a full stored-user dict or a minimal
 * {name, key, displayName, emailAddress, active}. Returns null for null
 * input. NEVER emits accountId/accountType/locale.
 */
export function userShape(u: any): any {
  if (u == null) return null;
  const name = u.name ?? null;
  const key = (u.key || name) ?? null;
  return {
    self: base() + "/rest/api/2/user?username=" + (name || ""),
    name,
    key,
    emailAddress: u.emailAddress === undefined ? "" : u.emailAddress,
    displayName: (u.displayName || name) ?? null,
    active: u.active === undefined ? true : u.active,
    avatarUrls: avatarUrls(),
  };
}

// ---------------------------------------------------------------------------
// Status / Priority / Issue type
// ---------------------------------------------------------------------------

export function statusShape(name: string): any {
  const known = typeof name === "string" && Object.hasOwn(STATUS_DEFS, name);
  const d = known ? STATUS_DEFS[name] : STATUS_DEFS["To Do"];
  const sid = d.id;
  const cat = d.category;
  return {
    id: sid,
    name: known ? name : "To Do",
    self: base() + "/rest/api/2/status/" + sid,
    description: "",
    iconUrl: base() + "/",
    statusCategory: {
      id: cat.id,
      key: cat.key,
      colorName: cat.colorName,
      name: cat.name,
      self: base() + "/rest/api/2/statuscategory/" + String(cat.id),
    },
  };
}

export function priorityShape(name: string): any {
  let pid = "3";
  let pname = "Medium";
  for (const [id, defName] of PRIORITY_DEFS) {
    if (defName === name) {
      pid = id;
      pname = defName;
      break;
    }
  }
  return {
    id: pid,
    name: pname,
    self: base() + "/rest/api/2/priority/" + pid,
    iconUrl: "",
  };
}

export function issuetypeShape(name: string): any {
  let iid = "10001";
  let iname = "Task";
  for (const [id, defName] of ISSUETYPE_DEFS) {
    if (defName === name) {
      iid = id;
      iname = defName;
      break;
    }
  }
  return {
    id: iid,
    name: iname,
    self: base() + "/rest/api/2/issuetype/" + iid,
    description: "",
    iconUrl: "",
    subtask: false,
  };
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export function projectRef(project: any): any {
  const pid = String(project.id);
  return {
    id: pid,
    key: project.key ?? null,
    name: project.name ?? null,
    self: base() + "/rest/api/2/project/" + pid,
    projectTypeKey: project.projectTypeKey === undefined ? "software" : project.projectTypeKey,
  };
}

export function projectShape(project: any): any {
  const pid = String(project.id);
  const lead = project.lead;
  let leadUser: any;
  if (typeof lead === "string") {
    leadUser = userShape({ name: lead, key: lead, displayName: lead });
  } else if (lead !== null && typeof lead === "object" && !Array.isArray(lead)) {
    leadUser = userShape(lead);
  } else {
    leadUser = null;
  }
  return {
    id: pid,
    key: project.key ?? null,
    name: project.name ?? null,
    self: base() + "/rest/api/2/project/" + pid,
    projectTypeKey: project.projectTypeKey === undefined ? "software" : project.projectTypeKey,
    lead: leadUser,
    description: project.description === undefined ? "" : project.description,
    components: [],
    versions: [],
    issueTypes: ISSUETYPE_DEFS.map(([, n]) => issuetypeShape(n)),
    avatarUrls: avatarUrls(),
    assigneeType: "PROJECT_LEAD",
  };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface BuildIssueOptions {
  key: string;
  numericId: number | string;
  project: any;
  summary: any;
  description?: any;
  issuetypeName?: string;
  priorityName?: string;
  statusName?: string;
  assigneeUser?: any;
  reporterUser?: any;
  creatorUser?: any;
  created?: string | null;
  updated?: string | null;
  labels?: any[] | null;
  duedate?: any;
  comments?: any[] | null;
}

export function buildIssue(opts: BuildIssueOptions): any {
  const created = opts.created || nowJira();
  const updated = opts.updated || nowJira();
  const labels = opts.labels ?? [];
  const comments = opts.comments ?? [];
  const nid = String(opts.numericId);
  const reporter = userShape(opts.reporterUser ?? null);
  const creator = userShape(opts.creatorUser ?? opts.reporterUser ?? null);
  const assignee = userShape(opts.assigneeUser ?? null);
  return {
    id: nid,
    key: opts.key,
    self: base() + "/rest/api/2/issue/" + nid,
    expand: "renderedFields,names,schema,operations,editmeta,changelog",
    fields: {
      summary: opts.summary ?? null,
      description: opts.description ?? null,
      status: statusShape(opts.statusName ?? "To Do"),
      priority: priorityShape(opts.priorityName ?? "Medium"),
      issuetype: issuetypeShape(opts.issuetypeName ?? "Task"),
      project: projectRef(opts.project),
      assignee,
      reporter,
      creator,
      created,
      updated,
      resolutiondate: null,
      duedate: opts.duedate ?? null,
      labels,
      components: [],
      fixVersions: [],
      attachment: [],
      subtasks: [],
      comment: {
        comments,
        maxResults: 10,
        total: comments.length,
        startAt: 0,
      },
      worklog: {
        worklogs: [],
        maxResults: 20,
        total: 0,
        startAt: 0,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Search / Transitions / Project statuses
// ---------------------------------------------------------------------------

export function searchPayload(
  issues: any[],
  startAt: number,
  maxResults: number,
  total: number
): any {
  return {
    expand: "names,schema",
    startAt,
    maxResults,
    total,
    issues,
  };
}

export function transitionsPayload(issueKey: string): any {
  const selfUrl = base() + "/rest/api/2/issue/" + String(issueKey) + "/transitions";
  const transitions = TRANSITION_DEFS.map(([tid, tname, toStatus]) => {
    const d = STATUS_DEFS[toStatus];
    const cat = d.category;
    return {
      id: tid,
      name: tname,
      self: selfUrl,
      to: {
        id: d.id,
        name: toStatus,
        statusCategory: {
          id: cat.id,
          key: cat.key,
          colorName: cat.colorName,
          name: cat.name,
        },
      },
    };
  });
  return { expand: "transitions", transitions };
}

function projectStatusEntry(name: string): any {
  const d = STATUS_DEFS[name];
  const cat = d.category;
  return {
    id: d.id,
    name,
    self: base() + "/rest/api/2/status/" + d.id,
    statusCategory: {
      id: cat.id,
      key: cat.key,
      colorName: cat.colorName,
      name: cat.name,
    },
  };
}

export function projectStatusesPayload(): any[] {
  return ISSUETYPE_DEFS.map(([iid, iname]) => ({
    id: iid,
    name: iname,
    subtask: false,
    self: base() + "/rest/api/2/issuetype/" + iid,
    statuses: ["To Do", "In Progress", "In Review", "Done"].map(projectStatusEntry),
  }));
}

// ---------------------------------------------------------------------------
// List endpoints
// ---------------------------------------------------------------------------

export function priorityList(): any[] {
  return PRIORITY_DEFS.map(([pid, pname, color]) => ({
    id: pid,
    name: pname,
    self: base() + "/rest/api/2/priority/" + pid,
    iconUrl: "",
    statusColor: color,
  }));
}

export function statusList(): any[] {
  return ["To Do", "In Progress", "In Review", "Done", "Closed"].map(statusShape);
}

export function issuetypeList(): any[] {
  return ISSUETYPE_DEFS.map(([, n]) => issuetypeShape(n));
}

export function fieldList(): any[] {
  return FIELD_DEFS.map(([fid, fname, schema]) => ({
    id: fid,
    name: fname,
    custom: false,
    orderable: true,
    navigable: true,
    searchable: true,
    clauseNames: [fid],
    schema: { ...schema },
  }));
}

// ---------------------------------------------------------------------------
// Server meta / myself / license / comment / error
// ---------------------------------------------------------------------------

export function serverInfo(): any {
  return {
    baseUrl: base(),
    version: "8.20.14",
    versionNumbers: [8, 20, 14],
    deploymentType: "Server",
    buildNumber: 820014,
    buildDate: "2022-01-01T00:00:00.000+0000",
    scmInfo: "mock",
    serverTitle: "Mock Jira Server",
    defaultLocale: { locale: "en_US" },
  };
}

export function myselfShape(u: any): any {
  const shaped = userShape(u) || {};
  return {
    ...shaped,
    groups: { size: 1, items: [] },
    applicationRoles: { size: 1, items: [] },
  };
}

export function licenseStub(): any {
  return {
    valid: true,
    evaluation: false,
    maximumNumberOfUsers: -1,
    contactEmail: "admin@mockjira.com",
    creationDate: "2020-01-01",
    expiryDate: "2099-12-31",
    rawLicense: "AAABRg0ODAoPeJytUEtPwzAMvvdXROLasOxACipb1WkgTaJSmxi4RC1LoFIS",
    licenseType: "COMMERCIAL",
    unlimited: true,
    expired: false,
  };
}

export function commentShape(
  cid: string | number,
  body: string,
  authorUser: any,
  created: string,
  updated: string
): any {
  const au = userShape(authorUser);
  return {
    self: base() + "/rest/api/2/comment/" + String(cid),
    id: String(cid),
    author: au,
    body,
    updateAuthor: au,
    created,
    updated,
  };
}

export function errorBody(messages: string | string[]): any {
  const list = typeof messages === "string" ? [messages] : [...messages];
  return { errorMessages: list, errors: {} };
}
