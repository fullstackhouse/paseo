import { useCallback, useMemo, type ReactElement } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { HostProjectListItem } from "@/projects/host-projects";
import { ProjectIcon } from "./icons";

/**
 * One-click project choice: the host's most recent projects as pills, so switching between the
 * usual few skips the picker and its search. The selected one is filled; the row keeps its order
 * when you pick, so a pill never moves under the pointer.
 */
export function RecentProjects({
  optionIds,
  projectByOptionId,
  iconDataByProjectViewKey,
  selectedOptionId,
  disabled,
  onSelect,
}: {
  optionIds: readonly string[];
  projectByOptionId: Map<string, HostProjectListItem>;
  iconDataByProjectViewKey: Map<string, string | null>;
  selectedOptionId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}): ReactElement | null {
  if (optionIds.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
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
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const handlePress = useCallback(() => onSelect(optionId), [onSelect, optionId]);
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      leftIcon={icon}
      numberOfLines={1}
      style={styles.pill}
      disabled={disabled}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      testID={`new-workspace-recent-project-${project.viewKey}`}
    >
      {project.projectName}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flexGrow: 0,
    marginBottom: theme.spacing[3],
  },
  // Same inset as the field row below, so the first pill's border lines up with the composer's.
  row: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  pill: {
    borderRadius: theme.borderRadius.full,
    borderColor: theme.colors.borderAccent,
  },
}));
