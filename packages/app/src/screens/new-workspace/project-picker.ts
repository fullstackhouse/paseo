import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComboboxOption as ComboboxOptionType } from "@/components/ui/combobox";
import { isWorkspaceArchivePending } from "@/contexts/session-workspace-upserts";
import {
  filterWorkspaceProjectsForHost,
  getHostProjectId,
  getHostProjectSourceDirectory,
  resolveInitialWorkspaceProject,
  type HostProjectListItem,
} from "@/projects/host-projects";
import {
  createManualProjectSelectionContextKey,
  createProjectSelectionContextKey,
  createProjectSelection,
  reconcileProjectSelection,
  resolveInitialProjectSelectionSource,
  resolveProjectSelection,
  type ProjectSelection,
  type ProjectSelectionContext,
} from "./project-selection";
import {
  useRecentProjects,
  type RecentAgentSetup,
  type RecentProjectActivity,
} from "@/stores/session-store-hooks";
import { useProjectCategoryMatcher } from "@/projects/categories/store";
import { selectPinnedProjects } from "@/projects/pins/model";
import { usePinnedProjectsStore } from "@/projects/pins/store";

const PROJECT_OPTION_PREFIX = "project:";
const RECENT_PROJECT_LIMIT = 6;

interface NewWorkspaceProjectPickerInput {
  selectedServerId: string;
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  routeProjectContextViewKey: string | null;
  lastActiveProject: HostProjectListItem | null;
  allowAllProjects: boolean;
}

interface NewWorkspaceProjectPickerState {
  selectedProject: HostProjectListItem | null;
  selectedSourceDirectory: string | null;
  projectPickerOptions: ComboboxOptionType[];
  projectByOptionId: Map<string, HostProjectListItem>;
  recentProjectChoices: RecentProjectChoice[];
  pinnedProjectChoices: RecentProjectChoice[];
  selectedProjectOptionId: string;
  projectTriggerLabel: string;
  handleSelectProjectOption: (id: string) => void;
}

function projectOptionId(projectId: string): string {
  return `${PROJECT_OPTION_PREFIX}${projectId}`;
}

function computeProjectOptionData(projects: readonly HostProjectListItem[]) {
  const projectByOptionId = new Map<string, HostProjectListItem>();
  const options = projects.map((project) => {
    const id = projectOptionId(project.viewKey);
    projectByOptionId.set(id, project);
    return { id, label: project.projectName };
  });
  return { options, projectByOptionId };
}

export interface RecentProjectChoice {
  optionId: string;
  project: HostProjectListItem;
  lastUsedAt: number;
  agentSetup: RecentAgentSetup | null;
}

/**
 * The host's most recently used projects, newest first, each with the setup its latest agent ran
 * with. Only projects the picker offers count, and the list is left empty when it would offer no
 * choice beyond the picker.
 */
export function resolveRecentProjectChoices(input: {
  projects: readonly HostProjectListItem[];
  recentProjects: readonly RecentProjectActivity[];
  serverId: string;
  limit?: number;
}): RecentProjectChoice[] {
  const projectByHostProjectId = new Map<string, HostProjectListItem>();
  for (const project of input.projects) {
    const hostProjectId = getHostProjectId(project, input.serverId);
    if (hostProjectId) projectByHostProjectId.set(hostProjectId, project);
  }
  const choices: RecentProjectChoice[] = [];
  for (const recent of input.recentProjects) {
    const project = projectByHostProjectId.get(recent.projectId);
    if (!project) continue;
    const optionId = projectOptionId(project.viewKey);
    if (choices.some((choice) => choice.optionId === optionId)) continue;
    choices.push({
      optionId,
      project,
      lastUsedAt: recent.lastUsedAt,
      agentSetup: recent.agentSetup,
    });
    if (choices.length === (input.limit ?? RECENT_PROJECT_LIMIT)) break;
  }
  return choices.length > 1 ? choices : [];
}

/**
 * The pinned projects this host can start a workspace in, in pin order and narrowed to the
 * sidebar's project category. Each carries its latest agent setup when it has one, like a recent
 * project card.
 */
export function resolvePinnedProjectChoices(input: {
  projects: readonly HostProjectListItem[];
  pinnedViewKeys: readonly string[];
  matchesCategory: ((viewKey: string) => boolean) | null;
  recentProjects: readonly RecentProjectActivity[];
  serverId: string;
}): RecentProjectChoice[] {
  const recentByProjectId = new Map<string, RecentProjectActivity>();
  for (const recent of input.recentProjects) {
    if (!recentByProjectId.has(recent.projectId)) recentByProjectId.set(recent.projectId, recent);
  }
  return selectPinnedProjects(input).map((project) => {
    const hostProjectId = getHostProjectId(project, input.serverId);
    const recent = hostProjectId ? recentByProjectId.get(hostProjectId) : undefined;
    return {
      optionId: projectOptionId(project.viewKey),
      project,
      lastUsedAt: recent?.lastUsedAt ?? 0,
      agentSetup: recent?.agentSetup ?? null,
    };
  });
}

function resolveWorkspaceIdFromProjectWorkspaceKey(input: {
  selectedServerId: string;
  workspaceKey: string;
}): string | null {
  const prefix = `${input.selectedServerId}:`;
  return input.workspaceKey.startsWith(prefix) ? input.workspaceKey.slice(prefix.length) : null;
}

function hasPendingArchiveForProject(input: {
  selectedServerId: string;
  project: HostProjectListItem;
}): boolean {
  for (const workspaceKey of input.project.workspaceKeys) {
    const workspaceId = resolveWorkspaceIdFromProjectWorkspaceKey({
      selectedServerId: input.selectedServerId,
      workspaceKey,
    });
    if (
      workspaceId &&
      isWorkspaceArchivePending({ serverId: input.selectedServerId, workspaceId })
    ) {
      return true;
    }
  }

  return false;
}

export function useNewWorkspaceProjectPicker({
  selectedServerId,
  projects,
  routeProject,
  routeProjectContextViewKey,
  lastActiveProject,
  allowAllProjects,
}: NewWorkspaceProjectPickerInput): NewWorkspaceProjectPickerState {
  const selectableProjects = useMemo(
    () =>
      filterWorkspaceProjectsForHost({ projects, serverId: selectedServerId, allowAllProjects }),
    [allowAllProjects, projects, selectedServerId],
  );
  const initialProject = useMemo(
    () =>
      resolveInitialWorkspaceProject({
        routeProject,
        lastActiveProject,
        projects: selectableProjects,
        serverId: selectedServerId,
        allowAllProjects,
      }),
    [allowAllProjects, lastActiveProject, routeProject, selectableProjects, selectedServerId],
  );

  const selectionContextKey = createProjectSelectionContextKey({
    selectedServerId,
    routeProjectViewKey: routeProjectContextViewKey,
    allowAllProjects,
  });
  const manualSelectionContextKey = createManualProjectSelectionContextKey({
    routeProjectViewKey: routeProjectContextViewKey,
  });
  const shouldPreserveMissingProject = useCallback(
    (project: HostProjectListItem) =>
      hasPendingArchiveForProject({
        selectedServerId,
        project,
      }),
    [selectedServerId],
  );
  const selectionContext = useMemo<ProjectSelectionContext>(
    () => ({
      contextKey: selectionContextKey,
      manualContextKey: manualSelectionContextKey,
      selectedServerId,
      initialProject,
      initialProjectSource: resolveInitialProjectSelectionSource({
        initialProject,
        routeProject,
        lastActiveProject,
      }),
      projects: selectableProjects,
      routeProject,
      lastActiveProject,
      shouldPreserveMissingProject,
    }),
    [
      initialProject,
      lastActiveProject,
      manualSelectionContextKey,
      routeProject,
      selectableProjects,
      selectedServerId,
      selectionContextKey,
      shouldPreserveMissingProject,
    ],
  );
  const [projectSelection, setProjectSelection] = useState<ProjectSelection>(() =>
    createProjectSelection(selectionContext),
  );

  useEffect(() => {
    setProjectSelection((current) => reconcileProjectSelection(current, selectionContext));
  }, [selectionContext]);

  const activeSelection = reconcileProjectSelection(projectSelection, selectionContext);
  const selectedProject = resolveProjectSelection(activeSelection, selectionContext);
  const { options: projectPickerOptions, projectByOptionId } = useMemo(
    () => computeProjectOptionData(selectableProjects),
    [selectableProjects],
  );
  const recentProjects = useRecentProjects(selectedServerId);
  const pinnedViewKeys = usePinnedProjectsStore((state) => state.pinnedViewKeys);
  const matchesCategory = useProjectCategoryMatcher();
  const pinnedProjectChoices = useMemo(
    () =>
      resolvePinnedProjectChoices({
        projects: selectableProjects,
        pinnedViewKeys,
        matchesCategory,
        recentProjects,
        serverId: selectedServerId,
      }),
    [matchesCategory, pinnedViewKeys, recentProjects, selectableProjects, selectedServerId],
  );
  // A pinned project already has its card at the top; the recent list skips it.
  const recentProjectChoices = useMemo(() => {
    const pinned = new Set(pinnedProjectChoices.map((choice) => choice.optionId));
    return resolveRecentProjectChoices({
      projects: selectableProjects.filter(
        (project) => !pinned.has(projectOptionId(project.viewKey)),
      ),
      recentProjects,
      serverId: selectedServerId,
    });
  }, [pinnedProjectChoices, recentProjects, selectableProjects, selectedServerId]);
  const handleSelectProjectOption = useCallback(
    (id: string) => {
      const project = projectByOptionId.get(id);
      if (!project) return;
      if (
        !allowAllProjects &&
        !project.hosts.some((host) => host.worktreeSupport !== "unsupported")
      )
        return;
      setProjectSelection({
        contextKey: manualSelectionContextKey,
        project,
        originProject: project,
        source: "manual",
      });
    },
    [allowAllProjects, manualSelectionContextKey, projectByOptionId],
  );

  return {
    selectedProject,
    selectedSourceDirectory: selectedProject
      ? getHostProjectSourceDirectory(selectedProject, selectedServerId)
      : null,
    projectPickerOptions,
    projectByOptionId,
    recentProjectChoices,
    pinnedProjectChoices,
    selectedProjectOptionId: selectedProject ? projectOptionId(selectedProject.viewKey) : "",
    projectTriggerLabel: selectedProject?.projectName ?? "Choose project",
    handleSelectProjectOption,
  };
}
