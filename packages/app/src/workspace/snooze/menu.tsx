import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import {
  MenuHint,
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  MenuTextField,
  useMenuContext,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { parseSnoozeUntil } from "./custom-until";
import { snoozePresets, type SnoozePreset, type SnoozePresetId } from "./presets";

/** The `MenuSubTrigger` on a workspace's menu that opens the snooze choices. */
export const WORKSPACE_SNOOZE_PAGE_ID = "workspaceSnooze";
const WORKSPACE_SNOOZE_CUSTOM_PAGE_ID = "workspaceSnoozeCustom";

/** What the agent hears when a "Snooze and continue" ends. Agent-facing, so not translated. */
const CONTINUE_PROMPT = "Continue where you left off.";

export interface SnoozeTarget {
  serverId: string;
  workspaceId: string;
  /** The host can prompt the workspace's agent when a timed snooze ends. */
  canContinue: boolean;
}

export interface SetWorkspaceSnoozeInput {
  target: SnoozeTarget;
  snoozed: boolean;
  until: string | null;
  wakePrompt?: string;
}

export type SetWorkspaceSnooze = (input: SetWorkspaceSnoozeInput) => void;

const PRESET_LABEL_KEYS: Record<SnoozePresetId, string> = {
  tonight: "sidebar.workspace.snooze.tonight",
  tomorrow: "sidebar.workspace.snooze.tomorrow",
  nextWeek: "sidebar.workspace.snooze.nextWeek",
  indefinite: "sidebar.workspace.snooze.indefinite",
};

export function useSetWorkspaceSnooze(): SetWorkspaceSnooze {
  const { t } = useTranslation();
  const toast = useToast();
  const { mutate } = useMutation({
    mutationFn: async ({ target, snoozed, until, wakePrompt }: SetWorkspaceSnoozeInput) => {
      const client = getHostRuntimeStore().getClient(target.serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await client.setWorkspaceSnoozed(target.workspaceId, snoozed, until, { wakePrompt });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
  });
  return useCallback((input: SetWorkspaceSnoozeInput) => mutate(input), [mutate]);
}

/** The Snooze pages behind a workspace's menu, shared by the kebab and the context menu. */
export function useWorkspaceSnoozeMenuPages(
  target: SnoozeTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const setSnooze = useSetWorkspaceSnooze();
  // Shared by the presets page and the custom page, which can both be open at once as flyouts.
  const [continueWork, setContinueWork] = useState(false);
  const snoozeUntil = useCallback(
    (until: string | null) => {
      if (!target) return;
      setSnooze({
        target,
        snoozed: true,
        until,
        ...(continueWork ? { wakePrompt: CONTINUE_PROMPT } : {}),
      });
      setContinueWork(false);
    },
    [continueWork, setSnooze, target],
  );
  return useMemo(() => {
    if (!target) return [];
    return [
      {
        id: WORKSPACE_SNOOZE_PAGE_ID,
        title: t("sidebar.workspace.snooze.title"),
        content: (
          <WorkspaceSnoozePage
            canContinue={target.canContinue}
            continueWork={continueWork}
            onContinueWorkChange={setContinueWork}
            onSnooze={snoozeUntil}
          />
        ),
      },
      {
        id: WORKSPACE_SNOOZE_CUSTOM_PAGE_ID,
        title: t("sidebar.workspace.snooze.custom"),
        // A page you type into is not one the pointer opens or dismisses on its own.
        hoverIntent: false,
        content: <WorkspaceSnoozeCustomPage onSnooze={snoozeUntil} />,
      },
    ];
  }, [continueWork, snoozeUntil, t, target]);
}

function useSnoozeTimeFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const { i18n } = useTranslation();
  return useMemo(() => new Intl.DateTimeFormat(i18n.language, options), [i18n.language, options]);
}

const PRESET_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
};
const CUSTOM_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * One page for both kinds of snooze. "Continue work when it ends" toggles in place and keeps the
 * menu open; while it is on, "Until I wake it" goes away: an open-ended snooze has no moment to
 * resume at.
 */
function WorkspaceSnoozePage({
  canContinue,
  continueWork,
  onContinueWorkChange,
  onSnooze,
}: {
  canContinue: boolean;
  continueWork: boolean;
  onContinueWorkChange: (value: boolean) => void;
  onSnooze: (until: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const toggleContinueWork = useCallback(
    () => onContinueWorkChange(!continueWork),
    [continueWork, onContinueWorkChange],
  );
  // Read once per open: the presets are relative to when you look at them.
  const presets = useMemo(
    () => snoozePresets(new Date()).filter((preset) => !continueWork || preset.until !== null),
    [continueWork],
  );
  const formatter = useSnoozeTimeFormatter(PRESET_TIME_FORMAT);
  return (
    <>
      {canContinue ? (
        <>
          <MenuItem
            selected={continueWork}
            showSelectedCheck
            closeOnSelect={false}
            onSelect={toggleContinueWork}
            testID="workspace-snooze-continue-toggle"
          >
            {t("sidebar.workspace.snooze.continueToggle")}
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      {presets.map((preset) => (
        <SnoozePresetRow
          key={preset.id}
          preset={preset}
          label={t(PRESET_LABEL_KEYS[preset.id])}
          description={preset.until ? formatter.format(new Date(preset.until)) : undefined}
          onSnooze={onSnooze}
          alignWithToggle={canContinue}
        />
      ))}
      <MenuSubTrigger
        id={WORKSPACE_SNOOZE_CUSTOM_PAGE_ID}
        showSelectedCheck={canContinue}
        testID="workspace-snooze-custom"
      >
        {t("sidebar.workspace.snooze.custom")}
      </MenuSubTrigger>
    </>
  );
}

/** A typed end time (`fri 14:00`, `2h`, `2026-11-20 09:30`), previewed as you type. */
function WorkspaceSnoozeCustomPage({
  onSnooze,
}: {
  onSnooze: (until: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("WorkspaceSnoozeCustomPage");
  const [text, setText] = useState("");
  const until = parseSnoozeUntil(text, new Date());
  const formatter = useSnoozeTimeFormatter(CUSTOM_TIME_FORMAT);
  const submit = useCallback(() => {
    // Re-read at submit time: a relative entry like `2h` counts from the press, not the keystroke.
    const resolved = parseSnoozeUntil(text, new Date());
    if (resolved) onSnooze(resolved.toISOString());
  }, [onSnooze, text]);
  // Enter closes the menu the way pressing the row does, once there is something to snooze until.
  const submitFromKeyboard = useCallback(() => {
    if (parseSnoozeUntil(text, new Date())) menu.selectItem(submit, true);
  }, [menu, submit, text]);
  let hint = t("sidebar.workspace.snooze.customHint");
  if (until) hint = formatter.format(until);
  else if (text.trim()) hint = t("sidebar.workspace.snooze.customInvalid");
  return (
    <>
      <MenuTextField
        onChangeText={setText}
        placeholder={t("sidebar.workspace.snooze.customPlaceholder")}
        autoFocus
        onSubmitEditing={submitFromKeyboard}
        testID="workspace-snooze-custom-input"
      />
      <MenuHint testID="workspace-snooze-custom-hint">{hint}</MenuHint>
      <MenuSeparator />
      <MenuItem disabled={!until} onSelect={submit} testID="workspace-snooze-custom-submit">
        {t("sidebar.workspace.snooze.title")}
      </MenuItem>
    </>
  );
}

function SnoozePresetRow({
  preset,
  label,
  description,
  onSnooze,
  alignWithToggle,
}: {
  preset: SnoozePreset;
  label: string;
  description: string | undefined;
  onSnooze: (until: string | null) => void;
  /** Reserve the toggle's check column so every label on the page starts on one rail. */
  alignWithToggle: boolean;
}): ReactElement {
  const handleSelect = useCallback(() => onSnooze(preset.until), [onSnooze, preset.until]);
  return (
    <MenuItem
      description={description}
      showSelectedCheck={alignWithToggle}
      onSelect={handleSelect}
      testID={`workspace-snooze-${preset.id}`}
    >
      {label}
    </MenuItem>
  );
}
