import { useCallback, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronLeft, CircleStop } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ComposerTrackMark, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { LiveElapsed } from "@/components/message";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useMenuContext, type MenuPageDefinition } from "@/components/ui/menu";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { formatTimeOfDay } from "@/utils/time";
import { useOverlayRegistration, type KeyboardInputEvent } from "@/keyboard";
import { useOverlayLayer } from "@/lib/overlay-root";
import type { PaseoAgentBackgroundWorkItem } from "@getpaseo/client";
import { createHostBackgroundWorkModel } from "./host";
import {
  backgroundWorkBucket,
  backgroundWorkState,
  backgroundWorkText,
  type BackgroundWorkState,
} from "./presentation";
export { createHostBackgroundWorkModel } from "./host";

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedCircleStop = withUnistyles(CircleStop);
const BACK_ICON_SIZE = 18;
const PAGE_PREFIX = "background-work:";

type Model = ReturnType<typeof createHostBackgroundWorkModel>;

interface TaskEntry {
  key: string;
  item: PaseoAgentBackgroundWorkItem;
  live: boolean;
  stopStatus?: "pending" | "error";
}

function kindKey(kind: string): "shell" | "monitor" | "heartbeat" | "other" {
  if (kind === "shell" || kind === "monitor" || kind === "heartbeat") return kind;
  return "other";
}

function entryKey(item: PaseoAgentBackgroundWorkItem): string {
  return item.stopToken ?? item.id;
}

export function BackgroundWorkTrack({ model, count }: { model: Model; count: number }) {
  const { t } = useTranslation();
  const { items, status, stops } = useSyncExternalStore(
    model.subscribe,
    model.getSnapshot,
    model.getSnapshot,
  );
  const ready = status === "ready";
  const entries = useMemo<TaskEntry[]>(() => {
    const missing = Object.values(stops ?? {}).filter(
      (entry) => !items?.some((item) => item.stopToken === entry.item.stopToken),
    );
    return [...(items ?? []), ...missing.map((entry) => entry.item)].map((item) => ({
      key: entryKey(item),
      item,
      live: Boolean(items?.some((entry) => entry.stopToken === item.stopToken)),
      stopStatus: stops?.[item.stopToken ?? ""]?.status,
    }));
  }, [items, stops]);
  // The compact sheet opens a task as a page of its own, so the engine draws the back header and
  // Android Back returns to the list. The popover never opens these: there the detail replaces
  // the list in place, because a page on a popover is a flyout beside it.
  const pages = useMemo<MenuPageDefinition[]>(
    () =>
      entries.map((entry) => ({
        id: `${PAGE_PREFIX}${entry.key}`,
        title: backgroundWorkText(
          entry.item,
          t(`message.backgroundWork.${kindKey(entry.item.kind)}`),
        ).title,
        content: <BackgroundWorkDetail entry={entry} model={model} ready={ready} onBack={null} />,
      })),
    [entries, model, ready, t],
  );
  if (count === 0 && entries.length === 0) return null;
  const visibleCount = items?.length || count;
  return (
    <ComposerTrackPill
      testID="background-work"
      panelTitle={t("message.backgroundWork.title")}
      pages={pages}
      segments={[
        {
          bucket: "running",
          text:
            visibleCount === 1
              ? t("message.backgroundWork.pillOne")
              : t("message.backgroundWork.pillMany", { count: visibleCount }),
        },
      ]}
    >
      <BackgroundWorkPanel entries={entries} model={model} status={status} />
    </ComposerTrackPill>
  );
}

function BackgroundWorkPanel({
  entries,
  model,
  status,
}: {
  entries: TaskEntry[];
  model: Model;
  status: "loading" | "stale" | "ready" | "error";
}) {
  const { t } = useTranslation();
  const { presentation } = useMenuContext("BackgroundWorkPanel");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const back = useCallback(() => {
    setSelectedKey(null);
    // The list remounts on Back, so the row that opened the detail is a new element: focus it
    // once it is there, or keyboard focus falls to the page.
    if (!isWeb || !selectedKey) return;
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-testid="background-work-row-${CSS.escape(selectedKey)}"]`,
        )
        ?.focus();
    });
  }, [selectedKey]);
  // A task that leaves the list (it finished, or its stop went through) takes its detail with it.
  const selected =
    presentation === "popover" ? entries.find((entry) => entry.key === selectedKey) : undefined;
  if (selected) {
    return (
      <BackgroundWorkDetail
        entry={selected}
        model={model}
        ready={status === "ready"}
        onBack={back}
      />
    );
  }
  return (
    <>
      {status === "loading" || status === "stale" ? (
        <ComposerTrackRow>
          <Text style={styles.facts}>{t("message.backgroundWork.waiting")}</Text>
        </ComposerTrackRow>
      ) : null}
      {status === "error" ? (
        <>
          <ComposerTrackRow>
            <Text style={styles.facts}>{t("message.backgroundWork.error")}</Text>
          </ComposerTrackRow>
          <ComposerTrackRow
            onPress={model.retry}
            closeOnSelect={false}
            accessibilityLabel={t("message.backgroundWork.retry")}
          >
            <Text style={styles.title}>{t("message.backgroundWork.retry")}</Text>
          </ComposerTrackRow>
        </>
      ) : null}
      {entries.map((entry) => (
        <BackgroundWorkRow
          key={entry.key}
          entry={entry}
          model={model}
          ready={status === "ready"}
          sheet={presentation === "sheet"}
          onSelect={setSelectedKey}
        />
      ))}
    </>
  );
}

function useTaskPresentation(entry: TaskEntry, ready: boolean) {
  const { t } = useTranslation();
  const kind = t(`message.backgroundWork.${kindKey(entry.item.kind)}`);
  const { title } = backgroundWorkText(entry.item, kind);
  const state = backgroundWorkState(entry);
  const canStop = entry.item.canStop && ready && entry.live;
  return { kind, title, state, canStop };
}

function stateLabelKey(state: BackgroundWorkState): string {
  if (state === "running") return "message.backgroundWork.statusRunning";
  if (state === "stopping") return "message.backgroundWork.stopping";
  return "message.backgroundWork.notRunning";
}

function BackgroundWorkRow({
  entry,
  model,
  ready,
  sheet,
  onSelect,
}: {
  entry: TaskEntry;
  model: Model;
  ready: boolean;
  sheet: boolean;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { kind, title, state, canStop } = useTaskPresentation(entry, ready);
  const { item, stopStatus } = entry;
  const stop = useCallback(() => {
    void model.stopItem(item);
  }, [model, item]);
  const dismiss = useCallback(
    () => model.dismissStop(item.stopToken ?? ""),
    [model, item.stopToken],
  );
  const select = useCallback(() => onSelect(entry.key), [onSelect, entry.key]);
  // The tooltip names the action alone; the row already says which task it stops.
  const stopTooltip = useMemo(
    () => <Text style={styles.tooltipText}>{t("message.backgroundWork.stop")}</Text>,
    [t],
  );
  const actionsAlwaysVisible = isNative || isCompact;
  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <ComposerTrackMark bucket={backgroundWorkBucket({ state, stopStatus })} />
        <View style={styles.rowText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.facts} numberOfLines={1}>
            {stopStatus === "error" ? (
              t("message.backgroundWork.stopError")
            ) : (
              <>
                {kind} ·{" "}
                {state === "running" ? (
                  <LiveElapsed startedAt={new Date(item.startedAt)} active style={styles.facts} />
                ) : (
                  t(stateLabelKey(state))
                )}
              </>
            )}
          </Text>
        </View>
        {canStop && state === "running" ? (
          <View style={actionsAlwaysVisible || active ? styles.actionVisible : styles.actionHidden}>
            <ToolbarButton
              label={`${t("message.backgroundWork.stop")} ${title}`}
              tooltip={stopTooltip}
              tooltipSide="top"
              compact={isCompact}
              onPress={stop}
              testID={`background-work-stop-${entry.key}`}
            >
              <ThemedCircleStop
                size={paneContentToolbarIconSize(isCompact)}
                uniProps={mutedIconColorMapping}
              />
            </ToolbarButton>
          </View>
        ) : null}
        {!entry.live && stopStatus === "error" ? (
          <Button variant="ghost" size="sm" onPress={dismiss}>
            {t("message.backgroundWork.dismiss")}
          </Button>
        ) : null}
      </>
    ),
    [
      actionsAlwaysVisible,
      canStop,
      dismiss,
      entry.live,
      entry.key,
      isCompact,
      item.startedAt,
      kind,
      state,
      stop,
      stopStatus,
      stopTooltip,
      t,
      title,
    ],
  );
  return (
    <ComposerTrackRow
      accessibilityLabel={title}
      testID={`background-work-row-${entry.key}`}
      opensPage={sheet ? `${PAGE_PREFIX}${entry.key}` : undefined}
      onPress={select}
      closeOnSelect={false}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

/**
 * One task, opened from the list. The host reports no output for background work, so the command
 * is the content: in full, selectable, wrapping, and scrolling on its own when it is long.
 */
function BackgroundWorkDetail({
  entry,
  model,
  ready,
  onBack,
}: {
  entry: TaskEntry;
  model: Model;
  ready: boolean;
  /** Null on the sheet, whose own header carries Back and the title. */
  onBack: (() => void) | null;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { kind, title, state, canStop } = useTaskPresentation(entry, ready);
  const { item, stopStatus } = entry;
  const stop = useCallback(() => {
    void model.stopItem(item);
  }, [model, item]);
  const dismiss = useCallback(
    () => model.dismissStop(item.stopToken ?? ""),
    [model, item.stopToken],
  );
  const startedAt = new Date(item.startedAt);
  // In the popover the detail is its own overlay scope on top of the menu's: Escape goes back to the
  // list instead of closing the popover, focus moves to Back on open, and returns to the row on Back.
  const floatingLayer = useOverlayLayer("floating");
  const handleKeyDown = useCallback(
    (event: KeyboardInputEvent) => {
      if (event.key !== "Escape" || !onBack) return false;
      event.preventDefault();
      event.stopPropagation();
      onBack();
      return true;
    },
    [onBack],
  );
  const setOverlayScope = useOverlayRegistration({
    keys: ["Escape"],
    active: onBack !== null,
    layer: floatingLayer,
    onKeyDown: handleKeyDown,
  });
  return (
    <View
      ref={setOverlayScope}
      collapsable={false}
      style={styles.detail}
      testID="background-work-detail"
    >
      {onBack ? (
        <View style={styles.detailHeader}>
          <ToolbarButton
            label={t("common.back")}
            tooltipSide="top"
            compact={isCompact}
            onPress={onBack}
            testID="background-work-detail-back"
          >
            <ThemedChevronLeft size={BACK_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
          <Text style={styles.detailTitle} numberOfLines={2}>
            {title}
          </Text>
        </View>
      ) : null}
      <View style={styles.detailFacts}>
        <View style={styles.detailStatus}>
          <ComposerTrackMark bucket={backgroundWorkBucket({ state, stopStatus })} />
          <Text style={styles.facts}>
            {t(stateLabelKey(state))} · {kind}
            {entry.live ? (
              <>
                {" · "}
                <LiveElapsed
                  startedAt={startedAt}
                  active={state === "running"}
                  style={styles.facts}
                />
              </>
            ) : null}
          </Text>
        </View>
        <Text style={styles.facts}>
          {t("message.backgroundWork.started", { time: formatTimeOfDay(startedAt) })}
        </Text>
      </View>
      {item.command ? (
        <View style={styles.commandSection}>
          <Text style={styles.sectionLabel}>{t("message.backgroundWork.command")}</Text>
          <ScrollView style={styles.commandBlock} contentContainerStyle={styles.commandContent}>
            <Text
              style={styles.command}
              selectable
              dataSet={CODE_SURFACE_DATASET}
              testID="background-work-detail-command"
            >
              {item.command}
            </Text>
          </ScrollView>
        </View>
      ) : null}
      {stopStatus === "error" ? (
        <Text style={styles.error}>{t("message.backgroundWork.stopError")}</Text>
      ) : null}
      {canStop ? (
        <Button
          variant="secondary"
          size="md"
          style={styles.stopButton}
          accessibilityLabel={`${t("message.backgroundWork.stop")} ${title}`}
          disabled={stopStatus === "pending"}
          onPress={stop}
          testID="background-work-detail-stop"
        >
          {stopStatus === "pending"
            ? t("message.backgroundWork.stopping")
            : t("message.backgroundWork.stop")}
        </Button>
      ) : null}
      {!entry.live && stopStatus === "error" ? (
        <Button variant="secondary" size="md" style={styles.stopButton} onPress={dismiss}>
          {t("message.backgroundWork.dismiss")}
        </Button>
      ) : null}
    </View>
  );
}

/** Tall enough for a dozen wrapped lines; a longer command scrolls inside its block. */
const COMMAND_MAX_HEIGHT = 200;

const styles = StyleSheet.create((theme) => {
  const action = {
    flexDirection: "row",
    alignItems: "center",
  } as const;
  return {
    // `flexBasis: "auto"` rather than `flex: 1`, for the same reason the subagent rows give: a
    // zero-basis label adds nothing to the panel's intrinsic width.
    rowText: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0 },
    title: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
    facts: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      fontVariant: ["tabular-nums"],
    },
    actionVisible: { ...action, opacity: 1, pointerEvents: "auto" },
    actionHidden: { ...action, opacity: 0, pointerEvents: "none" },
    tooltipText: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
    detail: {
      gap: theme.spacing[3],
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
    },
    detailHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      marginLeft: -theme.spacing[1],
    },
    detailTitle: {
      flexShrink: 1,
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
    },
    detailFacts: { gap: theme.spacing[1] },
    detailStatus: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
    commandSection: { gap: theme.spacing[1] },
    sectionLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
    commandBlock: {
      maxHeight: COMMAND_MAX_HEIGHT,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface2,
    },
    commandContent: { padding: theme.spacing[2] },
    command: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foreground,
    },
    error: { fontSize: theme.fontSize.sm, color: theme.colors.statusDanger },
    stopButton: { alignSelf: "stretch" },
  };
});
