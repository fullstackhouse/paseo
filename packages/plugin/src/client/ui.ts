import type {
  ComponentType,
  FunctionComponent,
  ReactNode,
  ForwardRefExoticComponent,
  RefAttributes,
  ReactElement,
  Ref,
} from "react";
import type {
  StyleProp,
  ViewStyle,
  ScrollView as NativeScrollView,
  ScrollViewProps,
  FlatList as NativeFlatList,
  FlatListProps,
  TextInput as NativeTextInput,
  TextInputProps,
  TextProps,
  View as NativeView,
} from "react-native";
import type { PluginIconProps } from "../icons.js";
import type { PluginIcon } from "./contracts.js";

export interface ModalProps {
  title: string;
  icon?: ReactNode;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}

export interface ModalContentProps {
  children: ReactNode;
  /** Paint the full body below the header. */
  style?: StyleProp<ViewStyle>;
  /** Overrides the default 24px padding and 16px gap. Safe-area clearance stays host-owned. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Default true. Set false for a bounded body with your own ScrollView or FlatList. */
  scrollable?: boolean;
}

export interface ModalComponent extends FunctionComponent<ModalProps> {
  Content: ComponentType<ModalContentProps>;
}

export type ToastVariant = "default" | "info" | "success" | "warning" | "error";

/** A button in the toast, such as Undo. Pressing it closes the toast. Hosts before it show the message alone. */
export interface ToastAction {
  label: string;
  onPress(): void;
}

export interface ToastOptions {
  variant?: ToastVariant;
  durationMs?: number;
  action?: ToastAction;
}

export interface ToastApi {
  /** Returns a function that closes this toast; older hosts return nothing. */
  show(message: string, options?: ToastOptions): (() => void) | void;
  error(message: string): void;
}

/** Renders a Lucide icon by `name`, or any plugin icon by `icon`. An unusable icon renders nothing. */
export type IconProps = Partial<PluginIconProps> &
  ({ name: string; icon?: never } | { icon: PluginIcon; name?: never });

export declare const Icon: ComponentType<IconProps>;
export declare const Modal: ModalComponent;

/** A Lucide icon name, as `Icon` takes in `name`. */
export type PluginIconName = string;

export type MenuEntry =
  | {
      /** Unique within the menu. */
      id: string;
      label: string;
      icon?: PluginIconName;
      /** Draws the row in the destructive tone. */
      destructive?: boolean;
      disabled?: boolean;
      /** Runs after the menu closes. On iOS it runs a beat after the press. */
      onSelect(): void;
    }
  | { id: string; separator: true };

export interface MenuProps {
  /** Leading, trailing, and consecutive separators are dropped. */
  items: readonly MenuEntry[];
  /** The host draws the trigger: a quiet icon button, with `label` beside the icon when set. */
  trigger: { icon: PluginIconName; accessibilityLabel: string; label?: string };
  /** Compact layouts: a bottom sheet (default) or a popover. Wide layouts always use a popover. */
  compactMode?: "sheet" | "popover";
  disabled?: boolean;
  /** On the trigger. Rows get `${testID}-${entry.id}`. */
  testID?: string;
}

/**
 * Paseo's menu, opened by a host-drawn trigger. Undefined on hosts older than the export;
 * check `Menu !== undefined` before rendering it.
 */
export declare const Menu: ComponentType<MenuProps>;
export declare function useToast(): ToastApi;
export interface StreamedTextProps extends Omit<TextProps, "children"> {
  text: string;
  phase: "streaming" | "complete";
}
/** Plain assistant text with host-owned streaming pacing and typography. */
export declare const StreamedText: ComponentType<StreamedTextProps>;

export type { PluginIconProps } from "../icons.js";

/** React Native scrolling with the host's sheet gestures when rendered inside a sheet. */
export declare const ScrollView: ForwardRefExoticComponent<
  ScrollViewProps & RefAttributes<NativeScrollView>
>;
/**
 * Returns a function that scrolls the nearest host scroll container (an SDK `ScrollView`, a popover,
 * the composer sheet or side panel) just enough to show a view, measured a frame after the call.
 * No-op outside one. Undefined on hosts older than the export; check `useRevealInScroll !== undefined`.
 */
export declare function useRevealInScroll(): (target: NativeView | null) => void;
export declare function FlatList<Item>(
  props: FlatListProps<Item> & { ref?: Ref<NativeFlatList<Item>> },
): ReactElement;
/** Copies text to this client's clipboard. Rejects when copying is unavailable or denied. */
export declare function copyText(text: string): Promise<void>;

/** Native input focus integrated with modal keyboard positioning. */
export declare const TextInput: ForwardRefExoticComponent<
  TextInputProps & RefAttributes<NativeTextInput>
>;

export interface SettingsSectionProps {
  title: string;
  info?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  testID?: string;
}
export interface SettingsRowProps {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
  testID?: string;
}
export interface SettingsSwitchProps extends SettingsRowProps {
  value: boolean;
  onValueChange(value: boolean): void;
  disabled?: boolean;
}
export interface SettingsSelectProps<Value extends string = string> extends SettingsRowProps {
  value: Value;
  options: readonly { label: string; value: Value }[];
  onValueChange(value: Value): void;
  disabled?: boolean;
}
export interface SettingsInputHandle {
  focus(): void;
  blur(): void;
  getText(): string;
  replaceText(text: string): void;
}
export interface SettingsInputProps extends SettingsRowProps {
  initialValue?: string;
  onChangeText(text: string): void;
  placeholder?: string;
  disabled?: boolean;
  secureTextEntry?: boolean;
  ref?: Ref<SettingsInputHandle>;
}
export interface SettingsActionProps extends SettingsRowProps {
  actionLabel: string;
  onPress(): void;
  disabled?: boolean;
}
// COMPAT(pluginSettingsGroup): added in v0.13.0, remove after 2027-04-20
/** @deprecated Use SettingsSection for plugin settings headings. */
export declare const SettingsGroup: ComponentType<SettingsSectionProps>;
export declare const SettingsSection: ComponentType<SettingsSectionProps>;
export declare const SettingsCard: ComponentType<{ children: ReactNode; testID?: string }>;
export declare const SettingsRow: ComponentType<SettingsRowProps>;
export declare const SettingsSwitch: ComponentType<SettingsSwitchProps>;
export declare function SettingsSelect<Value extends string>(
  props: SettingsSelectProps<Value>,
): ReactNode;
export declare const SettingsInput: ComponentType<SettingsInputProps>;
export declare const SettingsAction: ComponentType<SettingsActionProps>;

export interface ExternalLinkProps {
  href: string;
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  onError?: (error: unknown) => void;
}
export declare const ExternalLink: ComponentType<ExternalLinkProps>;

export type SidebarIcon = PluginIcon;
export interface SidebarRowProps {
  /**
   * Tells rows of one item apart when the item renders several: "bot-2". Unique within the item.
   * Omit it when the item renders one row.
   */
  id?: string;
  /** A Lucide icon name, inline SVG, or a component. */
  icon?: SidebarIcon;
  /** Defaults to the item's registered title. */
  label?: string;
  onPress(): void;
  active?: boolean;
  /** Right slot. Renders beside the row's pressable, so a button here presses on its own. */
  trailing?: ReactNode;
}
/** A sidebar navigation row. Render it from a sidebar item's `Component`. */
export declare const SidebarRow: ComponentType<SidebarRowProps>;
/** A line between groups of rows. Render it from a sidebar item's `Component`. */
export declare const SidebarSeparator: ComponentType;

export type WorkspaceRowBadgeTone = "muted" | "success" | "warning" | "danger" | "info";
export interface WorkspaceRowBadgeProps {
  /** A Lucide icon name, inline SVG, or a component. */
  icon?: SidebarIcon;
  label?: string;
  /** Default "muted". */
  tone?: WorkspaceRowBadgeTone;
  /** Defaults to `label`, then the item's `title`. */
  accessibilityLabel?: string;
}
/** One item on a sidebar workspace row's meta line. Render it from a workspace row badge item's `Component`. */
export declare const WorkspaceRowBadge: ComponentType<WorkspaceRowBadgeProps>;

/** Paseo's loading state. Fills the panel; the panel decides when to show it. */
export declare const Loading: ComponentType;

/** Render a local document URL in an isolated frame. */
export declare const DocumentFrame: ComponentType<{ url: string; testID?: string }>;

export interface MarkdownBlockRange {
  /** One-based source lines, including the gap before the next top-level block. */
  startLine: number;
  endLine: number;
}

export interface MarkdownProps {
  children: string;
  compact?: boolean;
  /** Insert review annotations after blocks. Return null to keep adjacent text together. */
  afterBlock?: (block: MarkdownBlockRange) => ReactNode;
}

/** Renders Markdown using Paseo’s theme, selection, and link behavior. */
export declare const Markdown: ComponentType<MarkdownProps> & {
  readonly supportsBlockAnnotations: true;
};

export interface ComposerControlProps {
  /** The control's label and tooltip. */
  title: string;
  /** A Lucide icon name, inline SVG, or a component. */
  icon: PluginIcon;
  disabled?: boolean;
}
/**
 * What a control's callback receives. A returned promise marks the control pending until it
 * settles, and Paseo reports a rejection to the user.
 */
export interface ToggleProps extends ComposerControlProps {
  value: boolean;
  onValueChange(event: { value: boolean }): void | Promise<void>;
}
export interface SelectProps<Value extends string = string> extends ComposerControlProps {
  value: Value;
  options: readonly { value: Value; label: string; description?: string }[];
  onValueChange(event: { value: Value }): void | Promise<void>;
}
export interface ActionPressEvent {}
export interface ActionProps extends ComposerControlProps {
  onPress(event: ActionPressEvent): void | Promise<void>;
}
/** One result of a `Combobox` search. Extra fields ride along to `onSelect`. */
export interface ComboboxItem {
  id: string;
  label: string;
  description?: string;
}
export interface ComboboxSearchEvent {
  /** Empty when the list opens. */
  query: string;
}
export interface ComboboxProps<
  Item extends ComboboxItem = ComboboxItem,
> extends ComposerControlProps {
  /** What the control shows. It need not be among the search results. */
  value: ComboboxItem | null;
  /**
   * Called when the list opens and again, debounced, as the user types. Paseo shows the loading
   * and error states, keeps the previous results while a search runs, and ignores a search that a
   * newer one replaced.
   */
  search(event: ComboboxSearchEvent): Promise<readonly Item[]>;
  onSelect(event: { item: Item }): void | Promise<void>;
}
/**
 * Paseo's controls. Render them from a composer item's or a New workspace item's `Component`.
 * Paseo draws them where the item sits: inline when the composer has room and as rows in its
 * overflow sheet when it does not, and as a field in the New workspace setup.
 */
export declare const Toggle: ComponentType<ToggleProps>;
export declare function Select<Value extends string>(props: SelectProps<Value>): ReactNode;
export declare const Action: ComponentType<ActionProps>;
export declare function Combobox<Item extends ComboboxItem>(props: ComboboxProps<Item>): ReactNode;

export interface PullRequestPanelCheck {
  name: string;
  status: "success" | "failure" | "pending" | "skipped" | "cancelled";
  url: string;
  workflow?: string;
  timing?: string;
}

export interface PullRequestPanelActivity {
  /** Unique across this pull request's reviews and comments. */
  id: string;
  kind: "review" | "comment";
  author: string;
  authorUrl?: string | null;
  avatarUrl?: string | null;
  body: string;
  url: string;
  /** ISO timestamp; the host orders activity and formats its age. */
  createdAt: string;
  reviewState?: "approved" | "changes_requested" | "commented";
  /** Matches the parent review's activity id to nest this comment's thread. */
  reviewId?: string;
  threadId?: string;
  threadIsResolved?: boolean;
  location?: {
    path: string;
    line?: number;
    startLine?: number;
    threadId?: string;
    isResolved?: boolean;
    isOutdated?: boolean;
  };
}

export interface PullRequestPanelData {
  /** Forge id, such as "github" or "gitlab". Unknown ids use neutral labels. */
  forge: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  repoOwner?: string;
  repoName?: string;
  checks: PullRequestPanelCheck[];
  activity: PullRequestPanelActivity[];
}

export interface PullRequestPanelProps {
  data: PullRequestPanelData;
  activityLoading?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Default true. Set false inside a parent scroll view. */
  scrollable?: boolean;
  /** Default true. Hide when the parent already names the pull request. */
  showHeader?: boolean;
  /** Optional freshness or commit label beside the shared toolbar actions. */
  toolbarMeta?: ReactNode;
}

/** The Explorer's checks and activity UI with plugin-supplied data; no workspace or writes. */
export declare const PullRequestPanel: ComponentType<PullRequestPanelProps>;
