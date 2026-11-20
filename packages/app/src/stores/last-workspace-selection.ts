import { z } from "zod";

export interface ActiveWorkspaceSelection {
  serverId: string;
  workspaceId: string;
}

export const LAST_WORKSPACE_SELECTION_STORAGE_KEY = "paseo:last-workspace-route-selection";

export interface LastWorkspaceSelectionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

const ActiveWorkspaceSelectionSchema: z.ZodType<ActiveWorkspaceSelection> = z.strictObject({
  serverId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
});

function normalizeWorkspaceSelection(input: unknown): ActiveWorkspaceSelection | null {
  const result = ActiveWorkspaceSelectionSchema.safeParse(input);
  return result.success ? result.data : null;
}

function isSameSelection(
  a: ActiveWorkspaceSelection | null,
  b: ActiveWorkspaceSelection | null,
): boolean {
  return a !== null && b !== null && a.serverId === b.serverId && a.workspaceId === b.workspaceId;
}

function parseStoredWorkspaceSelection(stored: string | null): ActiveWorkspaceSelection | null {
  if (!stored) {
    return null;
  }
  try {
    return normalizeWorkspaceSelection(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function createLastWorkspaceSelectionStore(storage: LastWorkspaceSelectionStorage) {
  let selection: ActiveWorkspaceSelection | null = null;
  // The selection read from storage at startup, until the user navigates elsewhere.
  // Only this one may be forgotten when it turns out to be gone: any other selection
  // was navigated to in this session, and its workspace may simply not have arrived yet.
  let restoredSelection: ActiveWorkspaceSelection | null = null;
  let hydrated = false;
  let hydrationPromise: Promise<void> | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  function remember(next: ActiveWorkspaceSelection) {
    const normalized = normalizeWorkspaceSelection(next);
    if (!normalized) {
      return;
    }
    if (isSameSelection(selection, normalized)) {
      return;
    }
    selection = normalized;
    restoredSelection = null;
    revision += 1;
    notifyListeners();
    // workspaceId is opaque; do not parse this persisted selection back into a path.
    void storage.write(JSON.stringify(normalized)).catch(() => {});
  }

  function hydrate(): Promise<void> {
    if (hydrationPromise) {
      return hydrationPromise;
    }
    const hydrationRevision = revision;
    hydrationPromise = storage
      .read()
      .then((stored) => {
        if (revision === hydrationRevision) {
          selection = parseStoredWorkspaceSelection(stored);
          restoredSelection = selection;
          if (stored !== null && selection === null) {
            void storage.clear().catch(() => {});
          }
        }
        return undefined;
      })
      .catch(() => {
        if (revision === hydrationRevision) {
          selection = null;
        }
      })
      .finally(() => {
        hydrated = true;
        notifyListeners();
      });
    return hydrationPromise;
  }

  /** Forgets the selection restored from storage, if `target` is still that selection. */
  function forgetRestored(target: ActiveWorkspaceSelection): boolean {
    if (!isSameSelection(restoredSelection, target) || !isSameSelection(selection, target)) {
      return false;
    }
    selection = null;
    restoredSelection = null;
    revision += 1;
    notifyListeners();
    void storage.clear().catch(() => {});
    return true;
  }

  return {
    forgetRestored,
    getRestoredSelection: () => restoredSelection,
    getSelection: () => selection,
    hydrate,
    isHydrated: () => hydrated,
    remember,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
