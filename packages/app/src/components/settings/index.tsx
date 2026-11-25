import {
  Children,
  isValidElement,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react-native";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  SettingsRowProps,
  SettingsSwitchProps,
  SettingsSelectProps,
  SettingsInputProps,
  SettingsActionProps,
} from "@getpaseo/plugin/client/ui";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { ControlSizeProvider } from "@/components/ui/control-size";
import { isWeb } from "@/constants/platform";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useSettingsRowLayout } from "./row-density";
import { SettingsRevealText } from "./reveal-text";
const ThemedChevron = withUnistyles(ChevronRight);
const hoveredIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export { SettingsGroup } from "./headings/settings-group";
export { SettingsSection } from "./headings/settings-section";
export { SettingsCollapsibleRow } from "./collapsible-row";
export { SettingsDetailRow } from "./detail-row";
export { SettingsInfoTip } from "./headings/settings-info-tip";
export { SettingsRevealText } from "./reveal-text";

/** What app screens can add to a plugin-facing row: an accessory beside the label, such as an info tip. */
interface AppRowExtras {
  labelAccessory?: ReactNode;
  /**
   * Makes the whole row open a detail: it highlights on hover and ends with a chevron. Controls in
   * the trailing slot must stop their press from reaching the row; `Switch` already does.
   */
  onPress?: () => void;
  /** Keeps the row from opening while its controls are disabled, such as during a pending action. */
  pressDisabled?: boolean;
}

interface AppSettingsRowProps extends Omit<SettingsRowProps, "hint">, AppRowExtras {
  hint?: ReactNode;
}

export function SettingsCard({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={settingsStyles.card} testID={testID}>
      {Children.toArray(children).map((child, index) => (
        <View
          key={isValidElement(child) ? child.key : index}
          style={index ? settingsStyles.rowBorder : undefined}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

export function SettingsRow({
  label,
  labelAccessory,
  hint,
  error,
  children,
  testID,
  onPress,
  pressDisabled,
}: AppSettingsRowProps) {
  const compact = useIsCompactFormFactor();
  const layout = useSettingsRowLayout();
  const rowStyle = useMemo(() => [layout.row, compact && styles.compactRow], [compact, layout]);
  const pressableRowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      rowStyle,
      !pressDisabled && hovered && styles.hovered,
      !pressDisabled && pressed && styles.pressed,
    ],
    [pressDisabled, rowStyle],
  );
  const handlePress = useCallback(() => {
    // A clicked row keeps focus, and the list behind the pushed detail screen then gets
    // aria-hidden around a focused element, which the browser blocks and logs.
    if (isWeb) (document.activeElement as HTMLElement | null)?.blur?.();
    onPress?.();
  }, [onPress]);
  const accessoryTitleStyle = useMemo(() => [layout.title, styles.accessoryLabel], [layout]);
  const content = (hovered: boolean) => (
    <>
      <View style={styles.label}>
        {labelAccessory ? (
          <View style={styles.labelRow}>
            <SettingsRevealText style={accessoryTitleStyle}>{label}</SettingsRevealText>
            {labelAccessory}
          </View>
        ) : (
          <SettingsRevealText style={layout.title}>{label}</SettingsRevealText>
        )}
        {typeof hint === "string" ? <Text style={layout.hint}>{hint}</Text> : hint}
        {error ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {error}
          </Text>
        ) : null}
      </View>
      {children || onPress ? (
        <View style={onPress ? [styles.control, styles.pressableControl] : styles.control}>
          <ControlSizeProvider size={layout.controlSize}>{children}</ControlSizeProvider>
          {onPress ? (
            <ThemedChevron
              size={ICON_SIZE.sm}
              uniProps={hovered ? hoveredIconColorMapping : mutedIconColorMapping}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID}>
        {content(false)}
      </View>
    );
  }
  return (
    <PressHighlight
      // The row press is a pointer shortcut, so it stays out of the accessibility tree and the tab
      // order: an accessible row would merge its switch and menu into one VoiceOver element, and
      // a "button" role renders a <button> on web that cannot hold them. Whatever the row opens
      // must also be reachable from a control inside it, such as the row's menu.
      accessible={false}
      tabIndex={-1}
      disabled={pressDisabled}
      onPress={handlePress}
      style={pressableRowStyle}
      highlightStyle={styles.pressed}
      testID={testID}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) =>
        content(!pressDisabled && !!hovered)
      }
    </PressHighlight>
  );
}

export function SettingsSwitch({ value, onValueChange, disabled, ...row }: SettingsSwitchProps) {
  return (
    <SettingsRow {...row}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={row.label}
      />
    </SettingsRow>
  );
}

function SettingsOption<Value extends string>({
  option,
  selected,
  onValueChange,
}: {
  option: { label: string; value: Value };
  selected: boolean;
  onValueChange(value: Value): void;
}) {
  const select = useCallback(() => onValueChange(option.value), [onValueChange, option.value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {option.label}
    </DropdownMenuItem>
  );
}

export function SettingsSelect<Value extends string>({
  value,
  options,
  onValueChange,
  disabled,
  ...row
}: SettingsSelectProps<Value> & AppRowExtras) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  return (
    <SettingsRow {...row}>
      <DropdownMenu>
        <DropdownTrigger
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${row.label}: ${selectedLabel}`}
        >
          {selectedLabel}
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={220}>
          {options.map((option) => (
            <SettingsOption
              key={option.value}
              option={option}
              selected={option.value === value}
              onValueChange={onValueChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  );
}

export function SettingsInput({
  initialValue,
  onChangeText,
  placeholder,
  disabled,
  secureTextEntry,
  ref,
  ...row
}: SettingsInputProps & AppRowExtras) {
  const compact = useIsCompactFormFactor();
  const input = useRef<EditingTextInputHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      blur: () => input.current?.blur(),
      getText: () => input.current?.getText() ?? "",
      replaceText: (text) => input.current?.replaceText(text),
    }),
    [],
  );
  return (
    <SettingsRow {...row}>
      <FormTextInput
        ref={input}
        initialValue={initialValue}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editable={!disabled}
        secureTextEntry={secureTextEntry}
        accessibilityLabel={row.label}
        size={compact ? "md" : undefined}
        style={styles.input}
      />
    </SettingsRow>
  );
}

export function SettingsAction({ actionLabel, onPress, disabled, ...row }: SettingsActionProps) {
  return (
    <SettingsRow {...row}>
      <Button variant="outline" onPress={onPress} disabled={disabled}>
        {actionLabel}
      </Button>
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  compactRow: { flexWrap: "wrap", gap: theme.spacing[3] },
  label: { flexGrow: 1, flexShrink: 1, flexBasis: 160, marginRight: theme.spacing[3] },
  labelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  accessoryLabel: { flexShrink: 1, minWidth: 0 },
  control: { flexShrink: 1, maxWidth: "100%" },
  pressableControl: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  hovered: { backgroundColor: theme.colors.surface2 },
  pressed: { backgroundColor: theme.colors.surface3 },
  input: { minWidth: 180 },
}));
