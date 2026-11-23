import { useCallback, useMemo } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { getDesktopHost } from "@/desktop/host";
import { resolvePreferredEditorId, usePreferredEditor } from "@/hooks/use-preferred-editor";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import type { InlinePathTarget } from "./parse";

/**
 * Where to point an editor or file manager for a chat link. Files inside the workspace open
 * with the workspace as the project; anything else opens next to its own folder.
 */
export function planFileLinkDesktopOpen(input: { path: string; workspaceRoot?: string }): {
  workspacePath: string;
  filePath: string;
} {
  const filePath = input.path.replace(/(.)[\\/]+$/, "$1");
  const root = input.workspaceRoot?.trim().replace(/(.)[\\/]+$/, "$1");
  if (
    root &&
    (filePath === root || filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`))
  ) {
    return { workspacePath: root, filePath };
  }
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const parent = separatorIndex > 0 ? filePath.slice(0, separatorIndex) : filePath.slice(0, 1);
  return { workspacePath: parent || filePath, filePath };
}

export function canOpenFileLinkWithDefaultApp(): boolean {
  return typeof getDesktopHost()?.opener?.openPath === "function";
}

export interface FileLinkDesktopActions {
  editorLabel: string | null;
  revealLabel: string | null;
  openInEditor: (target: InlinePathTarget) => void;
  reveal: (target: InlinePathTarget) => void;
  copyPath: (target: InlinePathTarget) => void;
}

/** Desktop actions for a chat file link. Callers gate on a local daemon. */
export function useFileLinkDesktopActions(input: {
  serverId: string;
  workspaceRoot?: string;
}): FileLinkDesktopActions {
  const { t } = useTranslation();
  const toast = useToast();
  const { workspaceRoot } = input;
  const { preferredEditorId } = usePreferredEditor({ serverId: input.serverId, projectId: null });
  const { targets } = useDesktopOpenTargets({ isLocalExecution: true });
  const editorTarget = useMemo(() => {
    const editors = targets.filter((target) => target.kind === "editor");
    const preferredId = resolvePreferredEditorId(
      editors.map((target) => target.id),
      preferredEditorId,
    );
    return editors.find((target) => target.id === preferredId) ?? null;
  }, [preferredEditorId, targets]);
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager") ?? null;

  const showError = useCallback(
    (cause: unknown) => {
      toast.error(cause instanceof Error ? cause.message : t("common.errors.error"));
    },
    [t, toast],
  );

  const openInEditor = useCallback(
    (target: InlinePathTarget) => {
      if (!editorTarget) return;
      const planned = planFileLinkDesktopOpen({ path: target.path, workspaceRoot });
      void openDesktopTarget({
        editorId: editorTarget.id,
        ...planned,
        ...(target.lineStart ? { line: target.lineStart } : {}),
      }).catch(showError);
    },
    [editorTarget, showError, workspaceRoot],
  );

  const reveal = useCallback(
    (target: InlinePathTarget) => {
      if (!fileManagerTarget) return;
      const planned = planFileLinkDesktopOpen({ path: target.path, workspaceRoot });
      void openDesktopTarget({ editorId: fileManagerTarget.id, ...planned }).catch(showError);
    },
    [fileManagerTarget, showError, workspaceRoot],
  );

  const copyPath = useCallback(
    (target: InlinePathTarget) => {
      void Clipboard.setStringAsync(target.path).then(() => toast.copied(), showError);
    },
    [showError, toast],
  );

  return useMemo(
    () => ({
      editorLabel: editorTarget
        ? t("workspace.fileActions.openIn", { target: editorTarget.label })
        : null,
      revealLabel: fileManagerTarget
        ? t("workspace.fileActions.revealIn", { target: fileManagerTarget.label })
        : null,
      openInEditor,
      reveal,
      copyPath,
    }),
    [copyPath, editorTarget, fileManagerTarget, openInEditor, reveal, t],
  );
}

/** Cmd/Ctrl+click on a chat file link: open it in the OS default app, never run it. */
export function useOpenFileLinkWithDefaultApp(): (target: InlinePathTarget) => void {
  const { t } = useTranslation();
  const toast = useToast();
  return useCallback(
    (target: InlinePathTarget) => {
      const openPath = getDesktopHost()?.opener?.openPath;
      if (!openPath) return;
      void (async () => {
        try {
          const result = await openPath(target.path);
          if (!result.opened) {
            toast.error(t("common.errors.executableBlocked", { path: target.path }));
          }
        } catch (cause) {
          toast.error(cause instanceof Error ? cause.message : t("common.errors.error"));
        }
      })();
    },
    [t, toast],
  );
}
