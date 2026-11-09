import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { MenuItem, type MenuPageDefinition } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { snoozePresets, type SnoozePreset, type SnoozePresetId } from "./presets";

/** The `MenuSubTrigger` on a workspace's menu that opens the snooze choices. */
export const WORKSPACE_SNOOZE_PAGE_ID = "workspaceSnooze";

export interface SnoozeTarget {
  serverId: string;
  workspaceId: string;
}

export interface SetWorkspaceSnoozeInput {
  target: SnoozeTarget;
  snoozed: boolean;
  until: string | null;
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
    mutationFn: async ({ target, snoozed, until }: SetWorkspaceSnoozeInput) => {
      const client = getHostRuntimeStore().getClient(target.serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await client.setWorkspaceSnoozed(target.workspaceId, snoozed, until);
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

function WorkspaceSnoozePage({ target }: { target: SnoozeTarget }): ReactElement {
  const { t, i18n } = useTranslation();
  const setSnooze = useSetWorkspaceSnooze();
  const snoozeUntil = useCallback(
    (until: string | null) => setSnooze({ target, snoozed: true, until }),
    [setSnooze, target],
  );
  // Read once per open: the presets are relative to when you look at them.
  const presets = useMemo(() => snoozePresets(new Date()), []);
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
      {presets.map((preset) => (
        <SnoozePresetRow
          key={preset.id}
          preset={preset}
          label={t(PRESET_LABEL_KEYS[preset.id])}
          description={preset.until ? formatter.format(new Date(preset.until)) : undefined}
          onSnooze={snoozeUntil}
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
}: {
  preset: SnoozePreset;
  label: string;
  description: string | undefined;
  onSnooze: (until: string | null) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onSnooze(preset.until), [onSnooze, preset.until]);
  return (
    <MenuItem
      description={description}
      onSelect={handleSelect}
      testID={`workspace-snooze-${preset.id}`}
    >
      {label}
    </MenuItem>
  );
}
