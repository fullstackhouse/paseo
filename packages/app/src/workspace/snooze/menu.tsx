import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { MenuItem, MenuSeparator, type MenuPageDefinition } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { snoozePresets, type SnoozePreset, type SnoozePresetId } from "./presets";

/** The `MenuSubTrigger` on a workspace's menu that opens the snooze choices. */
export const WORKSPACE_SNOOZE_PAGE_ID = "workspaceSnooze";

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

/** The Snooze page behind a workspace's menu, shared by the kebab and the context menu. */
export function useWorkspaceSnoozeMenuPages(
  target: SnoozeTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!target) return [];
    return [
      {
        id: WORKSPACE_SNOOZE_PAGE_ID,
        title: t("sidebar.workspace.snooze.title"),
        content: <WorkspaceSnoozePage target={target} />,
      },
    ];
  }, [t, target]);
}

/**
 * One page for both kinds of snooze. "Continue work when it ends" toggles in place and keeps the
 * menu open; while it is on, "Until I wake it" goes away: an open-ended snooze has no moment to
 * resume at.
 */
function WorkspaceSnoozePage({ target }: { target: SnoozeTarget }): ReactElement {
  const { t, i18n } = useTranslation();
  const setSnooze = useSetWorkspaceSnooze();
  const [continueWork, setContinueWork] = useState(false);
  const toggleContinueWork = useCallback(() => setContinueWork((value) => !value), []);
  const snoozeUntil = useCallback(
    (until: string | null) =>
      setSnooze({
        target,
        snoozed: true,
        until,
        ...(continueWork ? { wakePrompt: CONTINUE_PROMPT } : {}),
      }),
    [continueWork, setSnooze, target],
  );
  // Read once per open: the presets are relative to when you look at them.
  const presets = useMemo(
    () => snoozePresets(new Date()).filter((preset) => !continueWork || preset.until !== null),
    [continueWork],
  );
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.language],
  );
  return (
    <>
      {target.canContinue ? (
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
          onSnooze={snoozeUntil}
          alignWithToggle={target.canContinue}
        />
      ))}
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
