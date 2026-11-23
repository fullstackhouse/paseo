import type { MenuEntry, MenuProps } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, type ReactElement } from "react";
import { Text } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { MenuItem, MenuRoot, MenuSeparator, MenuSurface, MenuTrigger } from "@/components/ui/menu";
import { extraMutedIconColorMapping } from "@/components/ui/icon-color";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import {
  isToolbarLabelTriggerHighlighted,
  ToolbarLabelTriggerIcon,
  toolbarLabelTriggerStyle,
  toolbarLabelTriggerTextStyle,
} from "@/components/ui/toolbar-label-trigger";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { PluginIconView } from "../icons";

const MENU_ICON_SIZE = 14;
const LABEL_TRIGGER_ICON_SIZE = 14;

const ThemedPluginIcon = withUnistyles(PluginIconView);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const destructiveIconMapping = (theme: Theme) => ({ color: theme.colors.destructive });

type MenuAction = Extract<MenuEntry, { onSelect(): void }>;

function isSeparator(entry: MenuEntry): entry is Extract<MenuEntry, { separator: true }> {
  return "separator" in entry && entry.separator === true;
}

/** Drops leading, trailing, and consecutive separators, as plugin button menus do. */
export function visibleMenuEntries(items: readonly MenuEntry[]): readonly MenuEntry[] {
  const visible: MenuEntry[] = [];
  for (const entry of items) {
    if (isSeparator(entry)) {
      const previous = visible.at(-1);
      if (!previous || isSeparator(previous)) continue;
    }
    visible.push(entry);
  }
  const last = visible.at(-1);
  if (last && isSeparator(last)) visible.pop();
  return visible;
}

function PluginMenuItem({ entry, testID }: { entry: MenuAction; testID?: string }) {
  const { icon, destructive } = entry;
  const leading = useMemo(
    () =>
      icon ? (
        <ThemedPluginIcon
          icon={icon}
          size={MENU_ICON_SIZE}
          uniProps={destructive ? destructiveIconMapping : mutedIconMapping}
        />
      ) : null,
    [icon, destructive],
  );
  const select = useCallback(() => entry.onSelect(), [entry]);
  return (
    <MenuItem
      leading={leading}
      destructive={destructive}
      disabled={entry.disabled}
      onSelect={select}
      testID={testID ? `${testID}-${entry.id}` : undefined}
    >
      {entry.label}
    </MenuItem>
  );
}

function IconTrigger({ trigger, disabled, testID }: Omit<MenuProps, "items" | "compactMode">) {
  const compact = useIsCompactFormFactor();
  return (
    <ToolbarButton
      kind="menu"
      label={trigger.accessibilityLabel}
      compact={compact}
      disabled={disabled}
      testID={testID}
    >
      <ThemedPluginIcon
        icon={trigger.icon}
        size={paneContentToolbarIconSize(compact)}
        uniProps={extraMutedIconColorMapping}
      />
    </ToolbarButton>
  );
}

function LabelTrigger({
  trigger,
  label,
  disabled,
  testID,
}: Omit<MenuProps, "items" | "compactMode"> & { label: string }) {
  return (
    <MenuTrigger
      accessibilityRole="button"
      accessibilityLabel={trigger.accessibilityLabel}
      disabled={disabled}
      testID={testID}
      style={toolbarLabelTriggerStyle}
    >
      {(state) => {
        const highlighted = isToolbarLabelTriggerHighlighted(state);
        return (
          <>
            <ToolbarLabelTriggerIcon>
              <ThemedPluginIcon
                icon={trigger.icon}
                size={LABEL_TRIGGER_ICON_SIZE}
                uniProps={highlighted ? foregroundIconMapping : mutedIconMapping}
              />
            </ToolbarLabelTriggerIcon>
            <Text style={toolbarLabelTriggerTextStyle(highlighted)} numberOfLines={1}>
              {label}
            </Text>
          </>
        );
      }}
    </MenuTrigger>
  );
}

/**
 * The plugin kit's menu: the host's menu engine behind a host-drawn trigger. Rows go through
 * `MenuItem`, so selection waits out the iOS teardown grace like every other menu.
 */
export function Menu({
  items,
  trigger,
  compactMode = "sheet",
  disabled,
  testID,
}: MenuProps): ReactElement {
  const entries = useMemo(() => visibleMenuEntries(items), [items]);
  return (
    <MenuRoot compactMode={compactMode}>
      {trigger.label ? (
        <LabelTrigger trigger={trigger} label={trigger.label} disabled={disabled} testID={testID} />
      ) : (
        <IconTrigger trigger={trigger} disabled={disabled} testID={testID} />
      )}
      <MenuSurface
        align="end"
        sheetTitle={trigger.label ?? trigger.accessibilityLabel}
        testID={testID ? `${testID}-content` : undefined}
      >
        {entries.map((entry) =>
          isSeparator(entry) ? (
            <MenuSeparator key={entry.id} />
          ) : (
            <PluginMenuItem key={entry.id} entry={entry} testID={testID} />
          ),
        )}
      </MenuSurface>
    </MenuRoot>
  );
}
