import { useCallback, useMemo, type ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { Copy, ExternalLink, FolderOpen, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useFileLinkDesktopActions, type InlinePathTarget } from "@/assistant-file-links";
import { ContextMenuContent, ContextMenuItem, useContextMenu } from "@/components/ui/context-menu";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface FileLinkMenuProps {
  serverId: string;
  workspaceRoot?: string;
  resolve: () => Promise<InlinePathTarget | null>;
}

/** Right-click menu of a chat file link. Mounts its desktop hooks only while open. */
export function FileLinkMenu(props: FileLinkMenuProps): ReactElement | null {
  const { open } = useContextMenu();
  return open ? <FileLinkMenuContent {...props} /> : null;
}

function FileLinkMenuContent({
  serverId,
  workspaceRoot,
  resolve,
}: FileLinkMenuProps): ReactElement {
  const { t } = useTranslation();
  const actions = useFileLinkDesktopActions({ serverId, workspaceRoot });
  const withTarget = useCallback(
    (run: (target: InlinePathTarget) => void) => () => {
      void (async () => {
        const target = await resolve();
        if (target) run(target);
      })();
    },
    [resolve],
  );
  return (
    <ContextMenuContent align="start" width={220} testID="assistant-file-link-context-menu">
      {actions.editorLabel ? (
        <FileLinkMenuItem
          icon={ExternalLink}
          label={actions.editorLabel}
          onSelect={withTarget(actions.openInEditor)}
          testID="assistant-file-link-open-in-editor"
        />
      ) : null}
      {actions.revealLabel ? (
        <FileLinkMenuItem
          icon={FolderOpen}
          label={actions.revealLabel}
          onSelect={withTarget(actions.reveal)}
          testID="assistant-file-link-reveal"
        />
      ) : null}
      <FileLinkMenuItem
        icon={Copy}
        label={t("workspace.fileActions.copyPath")}
        onSelect={withTarget(actions.copyPath)}
        testID="assistant-file-link-copy-path"
      />
    </ContextMenuContent>
  );
}

function FileLinkMenuItem({
  icon,
  label,
  onSelect,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  testID: string;
}): ReactElement {
  const leading = useMemo(() => {
    const ThemedIcon = withUnistyles(icon);
    return <ThemedIcon size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />;
  }, [icon]);
  return (
    <ContextMenuItem leading={leading} onSelect={onSelect} testID={testID}>
      {label}
    </ContextMenuItem>
  );
}
