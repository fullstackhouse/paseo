import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ActionToast } from "@/components/action-toast";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";

export function WorkspaceArchivedToast({ onUndo }: { onUndo: () => void }) {
  const { t } = useTranslation();
  const undoKeys = useShortcutKeys("undo-archive-workspace");
  const undoShortcut = useMemo(
    () => (undoKeys ? <Shortcut chord={undoKeys} style={styles.shortcut} /> : null),
    [undoKeys],
  );

  return (
    <ActionToast
      message={t("sidebar.workspace.toasts.archived")}
      actionLabel={t("sidebar.workspace.toasts.undoArchive")}
      onAction={onUndo}
      actionTrailing={undoShortcut}
      actionTestID="workspace-archived-toast-undo"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  // Cancels the badge's own inset, which would otherwise add to the button's gap.
  shortcut: {
    marginLeft: -theme.spacing[1],
  },
}));
