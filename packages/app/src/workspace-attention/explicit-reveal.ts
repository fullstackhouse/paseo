/**
 * Explorer tabs that a navigation revealed on purpose (a plugin opening its screen there, a PR open),
 * per workspace. Entering a workspace keeps such a tab selected instead of picking one for the
 * attention items: the user asked for that tab.
 *
 * A reveal counts only for the entry that follows it. Navigation reveals the tab before the workspace
 * screen mounts, so a short window separates "this entry" from a reveal made while the user stayed.
 */
const ENTRY_WINDOW_MS = 10_000;
const revealedAt = new Map<string, number>();

export function noteExplicitExplorerReveal(workspaceKey: string, now = Date.now()): void {
  revealedAt.set(workspaceKey, now);
}

/** True once per reveal, when it happened within the entry window. */
export function takeExplicitExplorerReveal(workspaceKey: string, now = Date.now()): boolean {
  const at = revealedAt.get(workspaceKey);
  revealedAt.delete(workspaceKey);
  return at !== undefined && now - at <= ENTRY_WINDOW_MS;
}
