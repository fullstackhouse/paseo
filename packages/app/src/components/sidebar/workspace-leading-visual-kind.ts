export type WorkspaceLeadingVisualKind = "avatar" | "project" | "status";

/**
 * What leads a sidebar workspace row. A plugin's avatar wins over the project icon a hoisted row
 * would show, and over the bare status of a row inside its project: either way the row reads as
 * the plugin's at a glance.
 */
export function workspaceLeadingVisualKind(input: {
  avatarDataUri: string | null;
  leadingProjectName: string | null;
}): WorkspaceLeadingVisualKind {
  if (input.avatarDataUri !== null) return "avatar";
  if (input.leadingProjectName) return "project";
  return "status";
}
