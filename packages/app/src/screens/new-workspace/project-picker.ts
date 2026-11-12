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
import { useRecentProjectIds } from "@/stores/session-store-hooks";

const PROJECT_OPTION_PREFIX = "project:";
const RECENT_PROJECT_LIMIT = 5;

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
  recentProjectOptionIds: string[];
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

/**
 * Option ids of the host's most recently used projects, newest first. Only projects the picker
 * offers count, and the list is left empty when it would offer no choice beyond the picker.
 */
export function resolveRecentProjectOptionIds(input: {
  projects: readonly HostProjectListItem[];
  recentProjectIds: readonly string[];
  serverId: string;
  limit?: number;
}): string[] {
  const projectByHostProjectId = new Map<string, HostProjectListItem>();
  for (const project of input.projects) {
    const hostProjectId = getHostProjectId(project, input.serverId);
    if (hostProjectId) projectByHostProjectId.set(hostProjectId, project);
  }
  const optionIds: string[] = [];
  for (const projectId of input.recentProjectIds) {
    const project = projectByHostProjectId.get(projectId);
    if (!project) continue;
    const optionId = projectOptionId(project.viewKey);
    if (!optionIds.includes(optionId)) optionIds.push(optionId);
    if (optionIds.length === (input.limit ?? RECENT_PROJECT_LIMIT)) break;
  }
  return optionIds.length > 1 ? optionIds : [];
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
  const recentProjectIds = useRecentProjectIds(selectedServerId);
  const recentProjectOptionIds = useMemo(
    () =>
      resolveRecentProjectOptionIds({
        projects: selectableProjects,
        recentProjectIds,
        serverId: selectedServerId,
      }),
    [recentProjectIds, selectableProjects, selectedServerId],
  );
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
    recentProjectOptionIds,
    selectedProjectOptionId: selectedProject ? projectOptionId(selectedProject.viewKey) : "",
    projectTriggerLabel: selectedProject?.projectName ?? "Choose project",
    handleSelectProjectOption,
  };
}
