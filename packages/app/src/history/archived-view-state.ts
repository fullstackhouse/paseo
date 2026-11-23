/** A failed refresh keeps the list the user was reading; only a first load that fails replaces it. */
export function resolveArchivedViewState(input: {
  nothingSearched: boolean;
  isInitialLoad: boolean;
  isError: boolean;
  workspaces: readonly unknown[];
}): "blank" | "loading" | "error" | "empty" | "list" {
  // No host could be asked; the banner says why. "No archived workspaces" would be a claim.
  if (input.nothingSearched) return "blank";
  if (input.isInitialLoad) return "loading";
  if (input.workspaces.length > 0) return "list";
  return input.isError ? "error" : "empty";
}
