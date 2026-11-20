import equal from "fast-deep-equal";
import {
  buildWorkspaceStructureProjects,
  type WorkspaceSort,
  type WorkspaceStructure,
  type WorkspaceStructureProject,
} from "@/projects/workspace-structure";
import type { ProjectLastAgentSetup } from "@getpaseo/protocol/messages";
import type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import { deriveEffectiveWorkspaceStatus } from "@/workspace-status";
import type { ReportedWorkLookup } from "@/workspace-status/reported-work";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "../session-store";

export type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
export type { WorkspaceStructure, WorkspaceStructureProject } from "@/projects/workspace-structure";

export interface SessionsSnapshot {
  sessions: Record<
    string,
    {
      hasHydratedWorkspaces?: boolean;
      hasWorkspaceDirectorySnapshot?: boolean;
      workspaces: Map<string, WorkspaceDescriptor>;
      projects?: Map<string, ProjectDescriptor>;
      agents?: Map<string, Agent>;
      workspaceAgentActivity?: ReadonlyMap<string, WorkspaceAgentActivity>;
    }
  >;
}

export interface SidebarOrderSnapshot {
  projectOrder: string[];
}

const EMPTY_WORKSPACE_KEYS: string[] = [];
const EMPTY_WORKSPACE_STRUCTURE: WorkspaceStructure = { projects: [] };

export const workspaceEqualityFns = {
  identity: Object.is as (a: unknown, b: unknown) => boolean,
  deep: equal as (a: unknown, b: unknown) => boolean,
};

function applyStoredOrdering<T>(input: {
  items: T[];
  storedOrder: readonly string[];
  getKey: (item: T) => string;
}): T[] {
  if (input.items.length <= 1 || input.storedOrder.length === 0) {
    return input.items;
  }

  const itemByKey = new Map<string, T>();
  for (const item of input.items) {
    itemByKey.set(input.getKey(item), item);
  }

  const prunedOrder: string[] = [];
  const seen = new Set<string>();
  for (const key of input.storedOrder) {
    if (!itemByKey.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    prunedOrder.push(key);
  }

  if (prunedOrder.length === 0) {
    return input.items;
  }

  const orderedSet = new Set(prunedOrder);
  const ordered: T[] = [];
  let orderedIndex = 0;

  for (const item of input.items) {
    const key = input.getKey(item);
    if (!orderedSet.has(key)) {
      ordered.push(item);
      continue;
    }

    const targetKey = prunedOrder[orderedIndex] ?? key;
    orderedIndex += 1;
    ordered.push(itemByKey.get(targetKey) ?? item);
  }

  return ordered;
}

export function selectWorkspace(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceDescriptor | null {
  if (!serverId || !workspaceId) {
    return null;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId,
  });
  return workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
}

export function selectWorkspaceFields<T>(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
  project: (w: WorkspaceDescriptor) => T,
): T | null {
  const workspace = selectWorkspace(state, serverId, workspaceId);
  return workspace ? project(workspace) : null;
}

export function selectWorkspaceDirectory(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return selectWorkspace(state, serverId, workspaceId)?.workspaceDirectory || null;
}

export function selectWorkspaceExists(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): boolean {
  return selectWorkspace(state, serverId, workspaceId) !== null;
}

export function selectHasHydratedWorkspaces(
  state: SessionsSnapshot,
  serverId: string | null,
): boolean {
  return serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false;
}

export function selectHydratedWorkspaceServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => state.sessions[serverId]?.hasHydratedWorkspaces === true);
}

export function selectWorkspaceDirectoryServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => {
    const session = state.sessions[serverId];
    return (
      session?.hasHydratedWorkspaces === true || session?.hasWorkspaceDirectorySnapshot === true
    );
  });
}

export function selectWorkspaceStructureProjects(
  state: SessionsSnapshot,
  serverIds: readonly string[],
  workspaceSort?: WorkspaceSort,
): WorkspaceStructureProject[] {
  const sessions: Array<{
    serverId: string;
    workspaces: Iterable<WorkspaceDescriptor>;
    projects: Iterable<ProjectDescriptor>;
  }> = [];

  for (const serverId of serverIds) {
    const session = state.sessions[serverId];
    const workspaces = session?.workspaces;
    const projects = session?.projects;
    if (!projects || projects.size === 0) {
      continue;
    }
    sessions.push({
      serverId,
      workspaces: workspaces?.values() ?? [],
      projects: projects.values(),
    });
  }

  if (sessions.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE.projects;
  }

  return buildWorkspaceStructureProjects({ sessions, workspaceSort });
}

export function createWorkspaceStructureProjectsSelector(
  serverIds: readonly string[],
  workspaceSort?: WorkspaceSort,
): (state: SessionsSnapshot) => WorkspaceStructureProject[] {
  let previousInputs: Array<{
    workspaces: Map<string, WorkspaceDescriptor> | undefined;
    projects: Map<string, ProjectDescriptor> | undefined;
  }> | null = null;
  let previousProjects: WorkspaceStructureProject[] | null = null;

  return (state) => {
    const inputs = serverIds.map((serverId) => ({
      workspaces: state.sessions[serverId]?.workspaces,
      projects: state.sessions[serverId]?.projects,
    }));
    const priorInputs = previousInputs;
    const unchanged =
      priorInputs !== null &&
      inputs.every(
        (input, index) =>
          input.workspaces === priorInputs[index]?.workspaces &&
          input.projects === priorInputs[index]?.projects,
      );
    if (unchanged && previousProjects) {
      return previousProjects;
    }

    previousInputs = inputs;
    const next = selectWorkspaceStructureProjects(state, serverIds, workspaceSort);
    const previousByKey = new Map(previousProjects?.map((project) => [project.viewKey, project]));
    previousProjects = next.map((project) => {
      const previous = previousByKey.get(project.viewKey);
      return previous && equal(previous, project) ? previous : project;
    });
    return previousProjects;
  };
}

export function selectProject(
  state: SessionsSnapshot,
  serverId: string | null,
  projectId: string | null,
): ProjectDescriptor | null {
  if (!serverId || !projectId) return null;
  return state.sessions[serverId]?.projects?.get(projectId) ?? null;
}

export function selectProjectIdForServer(
  state: SessionsSnapshot,
  input: {
    sourceServerId: string;
    projectId: string;
    targetServerId: string;
  },
): string | null {
  if (input.sourceServerId === input.targetServerId) return input.projectId;
  const source = selectProject(state, input.sourceServerId, input.projectId);
  if (!source?.projectKey) return null;
  for (const project of state.sessions[input.targetServerId]?.projects?.values() ?? []) {
    if (project.projectKey === source.projectKey) return project.projectId;
  }
  return null;
}

export function selectProjectOrder(state: SidebarOrderSnapshot): string[] {
  return state.projectOrder ?? EMPTY_WORKSPACE_KEYS;
}

export function composeWorkspaceStructure(input: {
  projects: WorkspaceStructureProject[];
  projectOrder: readonly string[];
  workspaceOrderByProject?: Readonly<Record<string, string[]>>;
}): WorkspaceStructure {
  if (input.projects.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE;
  }

  const orderedProjects = applyStoredOrdering({
    items: input.projects,
    storedOrder: input.projectOrder,
    getKey: (project) => project.viewKey,
  });

  return {
    // Keep the shared automatic projection immutable when applying a sidebar preference.
    // eslint-disable-next-line oxc/no-map-spread
    projects: orderedProjects.map((project) => {
      const storedOrder = input.workspaceOrderByProject?.[project.viewKey];
      if (!storedOrder) return project;
      const orderedProject = { ...project };
      orderedProject.workspaceKeys = applyStoredOrdering({
        items: project.workspaceKeys,
        storedOrder,
        getKey: (key) => key,
      });
      return orderedProject;
    }),
  };
}

export function selectWorkspaceKeys(state: SessionsSnapshot, serverId: string | null): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  return workspaces ? Array.from(workspaces.keys()) : EMPTY_WORKSPACE_KEYS;
}

export function selectRecommendedProjectPaths(
  state: SessionsSnapshot,
  serverId: string | null,
): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  if (!workspaces) {
    return EMPTY_WORKSPACE_KEYS;
  }
  return Array.from(workspaces.values())
    .map((workspace) => workspace.projectRootPath)
    .filter((path) => path.length > 0);
}

/** The composer settings of a project's latest agent, shaped like an applied agent profile. */
export interface RecentAgentSetup {
  provider: string;
  modelId: string;
  modeId: string;
  thinkingOptionId: string;
  featureValues: Record<string, unknown>;
}

export interface RecentProjectActivity {
  projectId: string;
  /** Epoch ms of the project's latest prompt, or its newest workspace when nothing was prompted. */
  lastUsedAt: number;
  /**
   * The setup of the project's most recently prompted top-level agent; null without one. Hosts
   * that save it on the project keep it after that agent is archived.
   */
  agentSetup: RecentAgentSetup | null;
}

const EMPTY_RECENT_PROJECTS: RecentProjectActivity[] = [];

function activityTime(item: { lastUserMessageAt: Date | null; createdAt: Date | null }): number {
  return (item.lastUserMessageAt ?? item.createdAt)?.getTime() ?? 0;
}

function agentSetup(agent: Agent): RecentAgentSetup {
  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) {
    featureValues[feature.id] = feature.value;
  }
  return {
    provider: agent.provider,
    modelId: agent.model ?? "",
    modeId: agent.currentModeId ?? "",
    thinkingOptionId: agent.thinkingOptionId ?? "",
    featureValues,
  };
}

function savedAgentSetup(setup: ProjectLastAgentSetup): RecentAgentSetup {
  return {
    provider: setup.provider,
    modelId: setup.model ?? "",
    modeId: setup.modeId ?? "",
    thinkingOptionId: setup.thinkingOptionId ?? "",
    featureValues: { ...setup.featureValues },
  };
}

type RecentProjectEntry = RecentProjectActivity & { agentTime: number };
type RecentProjectEntries = Map<string, RecentProjectEntry>;

function touchRecentProject(
  entries: RecentProjectEntries,
  projectId: string,
  time: number,
): RecentProjectEntry {
  const entry = entries.get(projectId);
  if (entry) {
    if (time > entry.lastUsedAt) entry.lastUsedAt = time;
    return entry;
  }
  const created = { projectId, lastUsedAt: time, agentSetup: null, agentTime: -1 };
  entries.set(projectId, created);
  return created;
}

// The host's saved setup outlives the agent that ran it, so a project whose recent agents are all
// archived still offers what you last used, not an older agent that is still open.
function applySavedAgentSetups(
  entries: RecentProjectEntries,
  projects: Iterable<ProjectDescriptor>,
): void {
  for (const project of projects) {
    const saved = project.projectLastAgentSetup;
    const time = saved ? Date.parse(saved.promptedAt) : Number.NaN;
    if (!saved || !Number.isFinite(time)) continue;
    const entry = touchRecentProject(entries, project.projectId, time);
    if (time > entry.agentTime) {
      entry.agentTime = time;
      entry.agentSetup = savedAgentSetup(saved);
    }
  }
}

function applyOpenAgents(
  entries: RecentProjectEntries,
  agents: Iterable<Agent>,
  projectIdByWorkspaceId: Map<string, string>,
): void {
  for (const agent of agents) {
    if (agent.parentAgentId) continue;
    const projectId = agent.workspaceId ? projectIdByWorkspaceId.get(agent.workspaceId) : undefined;
    const entry = projectId ? entries.get(projectId) : undefined;
    if (!entry) continue;
    const time = activityTime(agent);
    // On a tie the open agent is the one the host saved; it also has any later setup change.
    if (time >= entry.agentTime) {
      entry.agentTime = time;
      entry.agentSetup = agentSetup(agent);
    }
    if (time > entry.lastUsedAt) entry.lastUsedAt = time;
  }
}

/** The host's projects, most recently used first, each with its latest agent's setup. */
export function selectRecentProjects(
  state: SessionsSnapshot,
  serverId: string | null,
): RecentProjectActivity[] {
  const session = serverId ? state.sessions[serverId] : undefined;
  const projects = session?.projects ?? new Map<string, ProjectDescriptor>();
  if (!session || (session.workspaces.size === 0 && projects.size === 0)) {
    return EMPTY_RECENT_PROJECTS;
  }
  const entries: RecentProjectEntries = new Map();
  const projectIdByWorkspaceId = new Map<string, string>();
  for (const workspace of session.workspaces.values()) {
    projectIdByWorkspaceId.set(workspace.id, workspace.projectId);
    touchRecentProject(entries, workspace.projectId, activityTime(workspace));
  }
  applySavedAgentSetups(entries, projects.values());
  applyOpenAgents(entries, session.agents?.values() ?? [], projectIdByWorkspaceId);
  return Array.from(entries.values())
    .sort(
      (left, right) =>
        right.lastUsedAt - left.lastUsedAt || left.projectId.localeCompare(right.projectId),
    )
    .map(({ projectId, lastUsedAt, agentSetup: setup }) => ({
      projectId,
      lastUsedAt,
      agentSetup: setup,
    }));
}

export function selectProjectRootPaths(state: SessionsSnapshot, serverId: string | null): string[] {
  const projects = serverId ? state.sessions[serverId]?.projects : undefined;
  if (!projects || projects.size === 0) {
    return EMPTY_WORKSPACE_KEYS;
  }
  return Array.from(projects.values(), (project) => project.projectRootPath);
}

export function selectHasWorkspaces(state: SessionsSnapshot, serverId: string | null): boolean {
  if (!serverId) {
    return false;
  }
  return (state.sessions[serverId]?.workspaces?.size ?? 0) > 0;
}

/** Each workspace's status as the sidebar derives it, plugin reports included, so the badge counts what the sidebar asks of you. */
export function selectWorkspaceStatusesForBadges(
  state: SessionsSnapshot,
  reportedWork?: ReportedWorkLookup,
): DesktopBadgeWorkspaceStatus[] {
  const statuses: DesktopBadgeWorkspaceStatus[] = [];
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const workspace of session.workspaces.values()) {
      const derived = deriveEffectiveWorkspaceStatus({
        serverId,
        workspace,
        workspaceAgentActivity: session.workspaceAgentActivity,
        reportedWork,
      });
      statuses.push(derived.status);
    }
  }
  return statuses;
}
