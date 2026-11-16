import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

export interface RevealFileInFileManager {
  /** "Reveal in Finder", "Reveal in Explorer", … */
  label: string;
  reveal: (path: string) => Promise<void>;
}

/**
 * Shows a workspace file in the OS file manager. Null when the desktop bridge has no
 * file-manager target, the daemon is remote, or the workspace directory is unknown.
 */
export function useRevealFileInFileManager(input: {
  serverId: string;
  workspaceId: string;
}): RevealFileInFileManager | null {
  const { t } = useTranslation();
  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(input.serverId);
  const workspaceRoot = useWorkspaceFields(
    input.serverId,
    input.workspaceId,
    (workspace) => workspace.workspaceDirectory,
  );
  const { targets } = useDesktopOpenTargets({ isLocalExecution: isLocalDaemon });
  const target = targets.find((candidate) => candidate.kind === "file-manager") ?? null;

  const reveal = useCallback(
    async (path: string) => {
      if (!target || !workspaceRoot) return;
      try {
        await openDesktopTarget({
          editorId: target.id,
          workspacePath: workspaceRoot,
          filePath: buildAbsoluteExplorerPath({ workspaceRoot, entryPath: path }),
        });
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileExplorer.errors.revealFailed"),
        );
      }
    },
    [target, workspaceRoot, t, toast],
  );

  return useMemo(
    () =>
      target && workspaceRoot
        ? { label: t("workspace.fileActions.revealIn", { target: target.label }), reveal }
        : null,
    [target, workspaceRoot, reveal, t],
  );
}
