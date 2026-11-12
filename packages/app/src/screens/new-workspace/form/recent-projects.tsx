import { useCallback, useMemo, type ReactElement } from "react";
import { ScrollView, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { HostProjectListItem } from "@/projects/host-projects";
import { ProjectIcon } from "./icons";

/**
 * One-click project choice: the host's most recent projects as quiet pills, so switching between
 * the usual few skips the picker and its search. They read like the field badges below them —
 * borderless, muted until hovered — and the selected one carries the highlight fill. The row keeps
 * its order when you pick, so a pill never moves under the pointer.
 */
export function RecentProjects({
  optionIds,
  projectByOptionId,
  iconDataByProjectViewKey,
  selectedOptionId,
  disabled,
  onSelect,
  style,
}: {
  optionIds: readonly string[];
  projectByOptionId: Map<string, HostProjectListItem>;
  iconDataByProjectViewKey: Map<string, string | null>;
  selectedOptionId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}): ReactElement | null {
  if (optionIds.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel="Recent projects"
      testID="new-workspace-recent-projects"
    >
      {optionIds.map((optionId) => {
        const project = projectByOptionId.get(optionId);
        return project ? (
          <RecentProjectPill
            key={optionId}
            optionId={optionId}
            project={project}
            iconDataUri={iconDataByProjectViewKey.get(project.viewKey) ?? null}
            selected={optionId === selectedOptionId}
            disabled={disabled}
            onSelect={onSelect}
          />
        ) : null;
      })}
    </ScrollView>
  );
}

function RecentProjectPill({
  optionId,
  project,
  iconDataUri,
  selected,
  disabled,
  onSelect,
}: {
  optionId: string;
  project: HostProjectListItem;
  iconDataUri: string | null;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  const icon = useMemo(
    () => (
      <ProjectIcon
        projectViewKey={project.viewKey}
        projectName={project.projectName}
        iconDataUri={iconDataUri}
      />
    ),
    [iconDataUri, project.projectName, project.viewKey],
  );
  const handlePress = useCallback(() => onSelect(optionId), [onSelect, optionId]);
  return (
    <Button
      variant="ghost"
      leftIcon={icon}
      numberOfLines={1}
      style={selected ? styles.pillSelected : styles.pill}
      textStyle={selected ? styles.labelSelected : null}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={project.projectName}
      aria-checked={selected}
      onPress={handlePress}
      testID={`new-workspace-recent-project-${project.viewKey}`}
    >
      {project.projectName}
    </Button>
  );
}

// Room for the keyboard focus ring, which a horizontal ScrollView would otherwise clip.
const FOCUS_RING_ROOM = 4;

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flexGrow: 0,
    marginVertical: -FOCUS_RING_ROOM,
  },
  // The pill's own inset puts each project icon on the field badges' icon rail.
  row: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: FOCUS_RING_ROOM,
    gap: theme.spacing[1],
  },
  // Same box as a field badge, so the two rows share one rail and one rhythm.
  pill: {
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1.5],
  },
  pillSelected: {
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1.5],
    backgroundColor: theme.colors.interactionHighlight,
  },
  labelSelected: {
    color: theme.colors.foreground,
  },
}));
