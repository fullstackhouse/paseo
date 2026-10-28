import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { GestureResponderEvent } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { Archive } from "lucide-react-native";
import { paneContentToolbarIconSize, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { Theme } from "@/styles/theme";

const ThemedArchive = withUnistyles(Archive);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Archives the row's workspace in one click, beside the kebab that also offers it. */
export function SidebarWorkspaceArchiveButton({
  onArchive,
  testID,
}: {
  onArchive: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();

  // The button sits inside the row's own pressable; without this the press also opens the row.
  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onArchive();
    },
    [onArchive],
  );

  return (
    <ToolbarButton
      label={t("sidebar.workspace.actions.archive")}
      onPressIn={handlePressIn}
      onPress={handlePress}
      testID={testID}
    >
      <ThemedArchive
        size={paneContentToolbarIconSize(false)}
        uniProps={foregroundMutedColorMapping}
      />
    </ToolbarButton>
  );
}
