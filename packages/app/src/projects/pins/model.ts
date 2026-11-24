/**
 * Pinned projects: a per-device shortlist of projects shown as cards at the top of the New
 * workspace screen, each one picking that project for the new workspace.
 *
 * Keyed by `SidebarProjectEntry.viewKey`, like project categories and the sidebar's project order,
 * so a pin follows a project across hosts. Array order is the display order: newest pin last.
 */
export function togglePinnedProject(pinnedViewKeys: readonly string[], viewKey: string): string[] {
  return pinnedViewKeys.includes(viewKey)
    ? pinnedViewKeys.filter((key) => key !== viewKey)
    : [...pinnedViewKeys, viewKey];
}

/**
 * The pinned projects to show, in pin order. A pin whose project the host doesn't list (its
 * host is offline, or it was removed) is skipped rather than dropped, so it comes back with the
 * host. `matchesCategory` is the project category matcher; `null` shows every pin.
 */
export function selectPinnedProjects<Project extends { viewKey: string }>(input: {
  projects: readonly Project[];
  pinnedViewKeys: readonly string[];
  matchesCategory: ((viewKey: string) => boolean) | null;
}): Project[] {
  const byViewKey = new Map(input.projects.map((project) => [project.viewKey, project] as const));
  return input.pinnedViewKeys.flatMap((viewKey) => {
    const project = byViewKey.get(viewKey);
    if (!project) return [];
    if (input.matchesCategory && !input.matchesCategory(viewKey)) return [];
    return [project];
  });
}
