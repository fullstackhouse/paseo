import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Icon, isRenderablePluginIcon } from "@/plugins/icons";
import type { Theme } from "@/styles/theme";

// Matches the sidebar row title's line height, so the glyph centers on the text.
export const WORKSPACE_TITLE_LINE_HEIGHT = 20;

const ThemedIcon = withUnistyles(Icon);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A plugin's icon before a workspace row's title. Nothing at all for an unknown name: an empty
 * wrapper would still pull the title out of line with unmarked rows.
 */
export function WorkspaceTitleIcon({ name }: { name: string | null }) {
  if (name === null || !isRenderablePluginIcon(name)) return null;
  return (
    <View style={styles.titleIcon} testID="sidebar-row-title-icon">
      <ThemedIcon name={name} size={14} uniProps={foregroundMutedColorMapping} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Pulled toward the title so it reads as part of it rather than as a separate item on the row.
  titleIcon: {
    height: WORKSPACE_TITLE_LINE_HEIGHT,
    justifyContent: "center",
    marginRight: -theme.spacing[1],
  },
}));
