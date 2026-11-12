import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { buildAgentProfileTags } from "@/agent-profiles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { RecentAgentSetup } from "@/stores/session-store-hooks";
import { formatCompactTimeAgo } from "@/utils/time";
import { ProjectIcon } from "./form/icons";
import type { RecentProjectChoice } from "./project-picker";

/**
 * "Recent projects": the host's latest projects as cards, each naming the setup its last agent ran
 * with. Choosing one picks the project and that setup in one click. `grid` sits under the composer
 * on wide layouts; `scroll` is a single swipeable row above the compact fields. Cards keep their
 * order when you pick, so one never moves under the pointer.
 */
export function RecentProjectCards({
  layout,
  serverId,
  choices,
  iconDataByProjectViewKey,
  selectedOptionId,
  disabled,
  onSelect,
  style,
}: {
  layout: "grid" | "scroll";
  serverId: string;
  choices: readonly RecentProjectChoice[];
  iconDataByProjectViewKey: Map<string, string | null>;
  selectedOptionId: string;
  disabled: boolean;
  onSelect: (choice: RecentProjectChoice) => void;
  style?: StyleProp<ViewStyle>;
}): ReactElement | null {
  const { t } = useTranslation();
  const { entries } = useProvidersSnapshot(choices.length > 0 ? serverId : null, { cwd: null });
  if (choices.length === 0) return null;
  const cards = choices.map((choice) => (
    <View key={choice.optionId} style={layout === "grid" ? styles.gridCell : styles.scrollCell}>
      <RecentProjectCard
        choice={choice}
        entries={entries}
        iconDataUri={iconDataByProjectViewKey.get(choice.project.viewKey) ?? null}
        selected={choice.optionId === selectedOptionId}
        disabled={disabled}
        onSelect={onSelect}
      />
    </View>
  ));
  return (
    <SettingsSection
      title={t("newWorkspace.recentProjects")}
      flush
      style={style}
      testID="new-workspace-recent-projects"
    >
      {layout === "grid" ? (
        <View style={styles.grid} accessibilityRole="radiogroup">
          {cards}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.scroll}
          contentContainerStyle={styles.scrollRow}
          accessibilityRole="radiogroup"
        >
          {cards}
        </ScrollView>
      )}
    </SettingsSection>
  );
}

/** "Opus 5.5 · Auto · High": the model names its provider, so the provider shows only without one. */
export function summarizeAgentSetup(
  setup: RecentAgentSetup,
  entries: readonly ProviderSnapshotEntry[] | undefined,
): string {
  // Agents may record a model alias ("haiku"); the catalog labels the model it stands for.
  const model = entries
    ?.find((entry) => entry.provider === setup.provider)
    ?.models?.find(
      (candidate) => candidate.id === setup.modelId || candidate.aliases?.includes(setup.modelId),
    );
  const tags = buildAgentProfileTags({
    profile: {
      id: "",
      name: "",
      provider: setup.provider,
      model: model?.id ?? setup.modelId,
      modeId: setup.modeId,
      thinkingOptionId: setup.thinkingOptionId,
    },
    entries,
    formatFeatureCount: () => "",
  });
  const hasModel = tags.some((tag) => tag.id === "model");
  return tags
    .filter((tag) => tag.id !== "features" && !(hasModel && tag.id === "provider"))
    .map((tag) => tag.label)
    .join(" · ");
}

function RecentProjectCard({
  choice,
  entries,
  iconDataUri,
  selected,
  disabled,
  onSelect,
}: {
  choice: RecentProjectChoice;
  entries: readonly ProviderSnapshotEntry[] | undefined;
  iconDataUri: string | null;
  selected: boolean;
  disabled: boolean;
  onSelect: (choice: RecentProjectChoice) => void;
}): ReactElement {
  const { project, agentSetup, lastUsedAt } = choice;
  const summary = agentSetup ? summarizeAgentSetup(agentSetup, entries) : "";
  const timeAgo = lastUsedAt > 0 ? formatCompactTimeAgo(new Date(lastUsedAt)) : "";
  const handlePress = useCallback(() => onSelect(choice), [choice, onSelect]);
  const cardStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.card,
      !disabled && hovered && styles.cardHovered,
      selected && styles.cardSelected,
      !disabled && pressed && styles.cardPressed,
      disabled && styles.cardDisabled,
    ],
    [disabled, selected],
  );
  const accessibilityLabel = useMemo(
    () => [project.projectName, summary].filter(Boolean).join(", "),
    [project.projectName, summary],
  );
  return (
    <PressHighlight
      onPress={handlePress}
      disabled={disabled}
      style={cardStyle}
      highlightStyle={styles.cardHighlight}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      aria-checked={selected}
      testID={`new-workspace-recent-project-${project.viewKey}`}
    >
      <View style={styles.titleLine}>
        <ProjectIcon
          projectViewKey={project.viewKey}
          projectName={project.projectName}
          iconDataUri={iconDataUri}
        />
        <Text style={styles.name} numberOfLines={1}>
          {project.projectName}
        </Text>
        {timeAgo ? <Text style={styles.time}>{timeAgo}</Text> : null}
      </View>
      {/* Always rendered (a no-break space when empty), so a project with no agent yet keeps the
          card's height. */}
      <Text style={styles.summary} numberOfLines={1}>
        {summary || "\u00a0"}
      </Text>
    </PressHighlight>
  );
}

// Half the gap between cards; each grid cell pads by it and the grid pulls back by it.
const CELL_INSET = 4;
const SCROLL_CARD_WIDTH = 220;

const styles = StyleSheet.create((theme) => ({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    margin: -CELL_INSET,
  },
  gridCell: {
    width: "33.333%",
    padding: CELL_INSET,
  },
  // Bleeds to the screen edges so a card scrolls out of view instead of being cut at the inset.
  scroll: {
    marginHorizontal: -theme.spacing[4],
    flexGrow: 0,
  },
  scrollRow: {
    paddingHorizontal: theme.spacing[4],
    gap: CELL_INSET * 2,
  },
  scrollCell: {
    width: SCROLL_CARD_WIDTH,
  },
  card: {
    flexGrow: 1,
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
  },
  // One step above hover, as in the sidebar, so the selected card never reads as merely hovered.
  cardSelected: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.borderAccent,
  },
  cardPressed: {
    opacity: 0.85,
  },
  // The native finger-down flash; the card's style resolves per press state, so the corners are
  // restated here.
  cardHighlight: {
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  time: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  // Indented past the icon, so the setup reads under the name.
  summary: {
    paddingLeft: theme.iconSize.md + theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
