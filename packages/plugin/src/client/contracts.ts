import type { WorkspaceRef, AgentRef, ProjectRef, TerminalRef } from "../refs.js";
import type { PluginText } from "../text.js";
import type { ComponentType } from "react";
import type { PluginPaseoApi } from "./reference-api.js";
import type { AgentTimelineItem, JsonValue } from "@getpaseo/protocol/agent-types";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import type { PluginFile } from "./file.js";
import type {
  PluginComposer,
  PluginComposerItemContribution,
  PluginComposerSelector,
} from "./composer.js";
import type { PluginNewWorkspaceItemContribution } from "./new-workspace.js";
import type {
  PluginRpcContract,
  PluginSubscribeOptions,
  PluginSubscriptionContract,
  PluginSubscriptionHandle,
  PluginWireInput,
} from "../rpc.js";
import type {
  PluginButtonRegistration,
  PluginHeaderButtonContribution,
  PluginComposerPillContribution,
} from "./buttons.js";
import type {
  PluginTheme,
  PluginWorkspaceSnapshot,
  PluginAgentSnapshot,
  PluginThemeContribution,
  PluginAttachmentSourceContribution,
  PluginTimelineTransformResult,
  PluginCleanup,
} from "../contracts.js";
import type { PluginIconProps, PluginSerializableIcon } from "../icons.js";

export interface PluginHostProps {
  theme: PluginTheme;
  host: {
    id: string;
    label: string;
  };
  layout: {
    compact: boolean;
    platform: "ios" | "android" | "web";
  };
}

export interface PluginNavigableHostProps extends PluginHostProps {
  /** Client-owned navigation. Undefined on older hosts; hide dependent affordances when absent. */
  readonly navigation?: {
    /** This client supports the focusHost option on agent/workspace navigation. */
    readonly supportsFocusHost?: boolean;
    /** Present only on Electron. The browser runs locally; serverId selects workspace ownership. */
    readonly openBrowser?: (input: {
      readonly url: string;
      readonly workspaceId: string;
      readonly serverId?: string;
    }) => void;
    readonly openAgent: (input: {
      readonly agentId: string;
      readonly serverId?: string;
      /** Select only the destination host in the sidebar and clear project/label filters. */
      readonly focusHost?: boolean;
      /**
       * Scrolls the chat to the timeline entry at this position: `seq` is an entry's `seqStart` from a
       * projected timeline fetch (`agents.ref(id).timeline.refetch()` on the plugin server). Ignored
       * when `epoch` is not the chat's current epoch, on native, and by older hosts; the chat then
       * opens at its tail.
       */
      readonly timelinePosition?: AgentTimelinePosition;
    }) => void;
    readonly openWorkspace: (input: {
      readonly workspaceId: string;
      readonly serverId?: string;
      /** Select only the destination host in the sidebar and clear project/label filters. */
      readonly focusHost?: boolean;
    }) => void;
    /**
     * Opens a screen another plugin added with `addScreen`. Throws when that plugin or screen is
     * not on the host. Undefined on older hosts.
     */
    readonly openPluginScreen?: (input: PluginScreenTarget) => void;
    /** Whether `openPluginScreen` would open that screen now. Undefined on older hosts. */
    readonly hasPluginScreen?: (input: Omit<PluginScreenTarget, "params">) => boolean;
  };
}

/** A position in an agent's timeline. */
export interface AgentTimelinePosition {
  readonly epoch: string;
  readonly seq: number;
}

/** A screen of any plugin on a host; `serverId` defaults to the rendering host. */
export interface PluginScreenTarget {
  readonly pluginId: string;
  readonly screenId: string;
  readonly params?: PluginScreenParams;
  readonly serverId?: string;
  /** Opens the screen as a tab in this workspace instead of over the app. Older hosts ignore it. */
  readonly workspaceId?: string;
  /**
   * Where the `workspaceId` tab opens: `"workspace"` (default) or `"explorer"`, the sidebar beside
   * the conversation. Ignored without `workspaceId`. Older hosts ignore it and use the workspace.
   * On compact layouts the screen opens in a bottom sheet over the current tab, whatever this says.
   */
  readonly location?: PluginPanelLocation;
}

/** String keys and values: params travel in the screen's URL. */
export type PluginScreenParams = Record<string, string>;

export interface PluginOpenScreenInput {
  screenId: string;
  params?: PluginScreenParams;
  /** Opens the screen as a tab in this workspace instead of over the app. Older hosts ignore it. */
  workspaceId?: string;
  /**
   * Where the `workspaceId` tab opens: `"workspace"` (default) or `"explorer"`, the sidebar beside
   * the conversation. Ignored without `workspaceId`. Older hosts ignore it and use the workspace.
   * On compact layouts the screen opens in a bottom sheet over the current tab, whatever this says.
   */
  location?: PluginPanelLocation;
}

export interface PluginScreenLocation {
  screenId: string;
  params: PluginScreenParams;
}

export interface PluginSurfaceProps extends PluginNavigableHostProps {}

/** A title the open screen sets for itself, e.g. once it has loaded what its params point at. */
export interface PluginScreenRuntimeTitle {
  label: string;
  /** Longer text for the tab's tooltip; `label` when omitted. */
  tooltip?: string;
}

export interface PluginScreenProps extends PluginSurfaceProps {
  /** The params the screen was opened with; `{}` when none. */
  params: PluginScreenParams;
  /**
   * Replaces the registered title in the screen's header and workspace tab; null restores it.
   * A tab remembers the title across reloads. Undefined on older hosts.
   */
  setTitle?: (title: PluginScreenRuntimeTitle | null) => void;
}

export interface PluginPopoverProps extends PluginHostProps {
  close(): void;
  openScreen(input: PluginOpenScreenInput): void;
}

export interface PluginSidebarItemProps extends PluginHostProps {
  /** This plugin's screen open on this item's host, with its params, else null. */
  currentScreen: PluginScreenLocation | null;
  openScreen(input: PluginOpenScreenInput): void;
  /** Anchored to the item on wide layouts; a bottom sheet on compact layouts. */
  openPopover(Content: ComponentType<PluginPopoverProps>): void;
}

export interface PluginSidebarItemContribution<Text extends PluginText = string> {
  id: string;
  /** Settings row label, accessibility label, and default label for SidebarRow. */
  title: Text;
  Component: ComponentType<PluginSidebarItemProps>;
}

export interface PluginSidebarViewProps extends Pick<PluginHostProps, "theme" | "layout"> {
  active: { workspace: WorkspaceRef | null; agent: AgentRef | null };
  navigation: {
    openWorkspace(ref: WorkspaceRef): void;
    openAgent(ref: AgentRef): void;
    openTerminal(ref: TerminalRef): void;
    openProject(ref: ProjectRef): void;
  };
  dismiss(): void;
}

export interface PluginSidebarViewContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  description?: Text;
  Component: ComponentType<PluginSidebarViewProps>;
}

export interface PluginWorkspaceRowBadgeItemProps extends PluginHostProps {
  workspaceId: string;
}

/**
 * Part of the line under a workspace's title in the sidebar, on every workspace of the plugin's host.
 * Render `WorkspaceRowBadge`, or nothing when there is nothing to say about this workspace.
 */
export interface PluginWorkspaceRowBadgeItemContribution<Text extends PluginText = string> {
  id: string;
  /** The item's toggle in the sidebar's Show menu. */
  title: Text;
  icon: PluginIcon;
  Component: ComponentType<PluginWorkspaceRowBadgeItemProps>;
}

/** What a plugin knows about one workspace, for the host's workspace summary and attention. */
export interface PluginWorkspaceSummaryItemState {
  /** Short text such as "2 waiting on you"; the item's title is shown when omitted. */
  label?: string;
  count?: number;
  /** True while something in this workspace waits on the human. */
  needsYou?: boolean;
  /**
   * Identifies what currently needs the human, such as the newest ask's id. Change it when a new
   * thing arrives: the host treats an unseen key as new attention.
   */
  key?: string;
  /** A workspace panel of this plugin to open in Explorer when the item needs the human. */
  panelId?: string;
  /**
   * Where the workspace's work stands, as its agent reported it. FSH-only: the sidebar groups an
   * idle workspace by this (and by `needsYou`) instead of by whether its last turn was read. `null` clears it.
   */
  workState?: PluginWorkspaceWorkState | null;
  /**
   * The workspace's status as its agent reported it, shown as the Overview's Status card.
   * FSH-only. `null` clears it.
   */
  status?: PluginWorkspaceStatus | null;
  /**
   * The things in this workspace that wait on the human, one Overview row each. FSH-only. An empty
   * list says this plugin has nothing waiting here.
   */
  entries?: PluginWorkspaceSummaryEntry[];
  /**
   * Things this plugin's agents have taken on but not finished, one Overview In progress row each.
   * FSH-only. An empty list says there are none. Like `entries`, the host renders an open row with
   * `EntryComponent`.
   */
  inProgress?: PluginWorkspaceInProgressEntry[];
  /**
   * The pull requests the workspace's work lives in, listed at the end of the Overview for
   * information. Replaces the host's own branch PR there; an empty list says there are none.
   * FSH-only. Publish it on its own item, without `status`, and set `entries: []` beside it:
   * hosts that don't know this field otherwise list the item as a one-line fact.
   */
  pullRequests?: PluginWorkspacePullRequest[];
  /** True while `pullRequests` couldn't be refreshed (the forge is unreachable); the rows keep their last facts. */
  pullRequestsStale?: boolean;
}

/** One pull request on the Overview. Pressing it opens `url`, or the PR tab for the branch's own PR. */
export interface PluginWorkspacePullRequest {
  /** Stable id, such as the PR's URL. */
  id: string;
  number: number;
  title: string;
  url: string;
  /** The repository's name, only for a PR outside the workspace's repository: shown as `repo#58`. */
  repo?: string;
  state: "open" | "draft" | "merged" | "closed";
  /** The most urgent fact, such as "2 failing" or "changes requested"; the state is shown when omitted. */
  facts?: string;
  /** Colors the row's facts. */
  tone?: "success" | "warning" | "danger" | "muted";
}

/**
 * `waiting`: on the human. `blocked`: on something else (other workspaces, a reviewer, CI); grouped
 * under Blocked, not needs you. Hosts without `blocked` drop it, leaving the workspace to its turn state.
 */
export type PluginWorkspaceWorkState = "waiting" | "blocked" | "working" | "done";

export interface PluginWorkspaceStatus {
  state: "working" | "waiting_on_you" | "blocked" | "done";
  /** True once an agent turn started after the status was written: the human already replied. */
  answered?: boolean;
  /** The whole job and its overall progress, shown above the Status card. Survives turn-level updates. */
  goal?: string;
  summary: string;
  /** What the agent is doing right now. */
  now?: string;
  /** When the status was last written, in epoch milliseconds. */
  updatedAt: number;
  /**
   * What a blocked workspace waits on, listed under the Status card. FSH-only; older hosts drop it.
   * Send it only while `state` is `blocked`.
   */
  blockedBy?: PluginWorkspaceBlocker[];
}

/** One thing a blocked workspace waits on. Pressing it opens `agentId`, else `workspaceId`, else `url`. */
export interface PluginWorkspaceBlocker {
  kind: "pr" | "agent" | "workspace" | "person" | "other";
  /** What it is, such as "#42 Fix the login redirect", an agent's title, or a name. */
  label: string;
  /** Short facts, such as "open · checks failing". */
  detail?: string;
  /** An http(s) link, opened externally. */
  url?: string;
  agentId?: string;
  workspaceId?: string;
  /** Colors `detail`. */
  tone?: "success" | "warning" | "danger" | "muted";
}

export interface PluginWorkspaceSummaryEntry {
  /** Stable id the user can name, such as "A4". */
  id: string;
  title: string;
  /** A short facts line, such as "Decision · 2 options". */
  detail?: string;
}

/** One thing an agent has taken on but not finished, as an Overview In progress row. FSH-only. */
export interface PluginWorkspaceInProgressEntry {
  id: string; // "A158"
  title: string; // "PR #2104 — invoices list"
  /** What it waits on: "CI running", "review requested", "next release". Age only when omitted. */
  waitingOn?: string;
  /** Colors `waitingOn`. */
  tone?: "success" | "warning" | "danger" | "muted";
  /** The agent that holds it; its running turn counts as movement. */
  agentId?: string;
  /** True while something outside the agent will report back, such as a watched open PR. */
  watched?: boolean;
  /** When it last changed, epoch ms: the row's age and its sort key. */
  updatedAt: number;
}

/**
 * One fact about a workspace, set per workspace. The host uses `needsYou` to decide whether entering
 * the workspace opens Explorer, and on which panel.
 */
export interface PluginWorkspaceSummaryItemContribution<
  Text extends PluginText = string,
> extends PluginWorkspaceSummaryItemState {
  id: string;
  workspaceId: string;
  title: Text;
  /**
   * Renders one of `entries` in full where the Overview lists it, so the human can act on it there
   * instead of opening the plugin's panel. Fixed for the item's lifetime. FSH-only.
   */
  EntryComponent?: ComponentType<PluginWorkspaceSummaryEntryProps>;
}

export interface PluginWorkspaceSummaryEntryProps extends PluginNavigableHostProps {
  workspaceId: string;
  /** An `entries[].id` or `inProgress[].id` of this item. */
  entryId: string;
  /** True for the Overview's first move: show it open, with its actions. */
  defaultExpanded: boolean;
  /**
   * Set by hosts that keep one entry open at a time: show the entry open when true, and report
   * toggles through `onExpandedChange` instead of keeping local state. FSH-only.
   */
  expanded?: boolean;
  onExpandedChange?(expanded: boolean): void;
  /**
   * For an `inProgress` entry: nothing moves it (no running turn of its agent, no live background
   * work, not watched, unchanged for 10 minutes), as its In progress row says. FSH-only.
   */
  nothingMoving?: boolean;
}

export interface PluginWorkspaceSummaryItemRegistration {
  update(patch: PluginWorkspaceSummaryItemState): void;
  remove(): void;
}

/**
 * A Lucide icon name, inline SVG markup, or a component. Components receive the surface's size
 * and color; buttons widen the props with their host and target context.
 */
export type PluginIcon<Props extends PluginIconProps = PluginIconProps> =
  | PluginSerializableIcon
  | ComponentType<Props>;

export type PluginPanelLocation = "workspace" | "explorer";

export interface PluginOpenPanelOptions {
  location?: PluginPanelLocation;
}

interface PluginWorkspacePanelBase<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  locations?: readonly PluginPanelLocation[];
}

export interface PluginTab {
  /** Shows the tab's unsaved dot and asks before closing. */
  setModified(modified: boolean): void;
  /** Opaque persisted JSON. Undefined until written; the panel validates it. */
  readonly state: unknown;
  setState(state: JsonValue): void;
}

export interface PluginPanelProps<Params> extends PluginNavigableHostProps {
  workspaceId: string;
  readonly params: Readonly<Params>;
  revision: number;
  tab: PluginTab;
}
export interface PluginWorkspacePanelParams {}
export interface PluginAgentPanelParams {
  readonly agentId: string;
}
export interface PluginFilePanelParams {
  readonly path: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}
export interface PluginWorkspacePanelProps extends PluginPanelProps<PluginWorkspacePanelParams> {
  // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
  /** @deprecated Use the panel registration to select the context. */
  context: "workspace";
}
export interface PluginAgentPanelProps extends PluginPanelProps<PluginAgentPanelParams> {
  // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
  /** @deprecated Use the panel registration to select the context. */
  context: "agent";
  // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
  /** @deprecated Read `params.agentId`. */
  agentId: string;
}
export interface PluginFilePanelProps extends PluginPanelProps<PluginFilePanelParams> {
  file: PluginFile;
}

export interface PluginFilePanelContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  /** Extensions without the dot, case-insensitive, and exact filenames. */
  files: { extensions: readonly string[]; filenames?: readonly string[] };
  Component: ComponentType<PluginFilePanelProps>;
}

export interface PluginClientOpenPanelOptions extends PluginOpenPanelOptions {
  workspaceId: string;
  agentId?: string;
}

// COMPAT(pluginSidebarAliases): added in v0.11.0, remove after 2027-03-29
interface PluginClientContextAliases {
  /** @deprecated Use `addScreen`. */
  addSurface(id: string, Component: ComponentType<PluginSurfaceProps>): PluginCleanup;
  /** @deprecated Use `addSidebarHeaderItem`. */
  addSidebarItem(contribution: PluginSidebarContribution<PluginText>): PluginCleanup;
}

export interface PluginClientContext extends PluginCommandCapabilities, PluginClientContextAliases {
  readonly i18n: import("./translations.js").PluginI18n;
  /** Play a base64-encoded audio file on this client; resolves when playback ends. */
  playAudio(source: { base64: string; mimeType: string }): Promise<void>;
  addSettingsScreen(contribution: PluginSettingsScreenContribution<PluginText>): PluginCleanup;
  addScreen(contribution: PluginScreenContribution<PluginText>): PluginCleanup;
  addSidebarView(contribution: PluginSidebarViewContribution<PluginText>): PluginCleanup;
  addSidebarHeaderItem(contribution: PluginSidebarItemContribution<PluginText>): PluginCleanup;
  addSidebarFooterItem(contribution: PluginSidebarItemContribution<PluginText>): PluginCleanup;
  addAgentPanel(contribution: PluginAgentPanelContribution<PluginText>): PluginCleanup;
  addWorkspaceRowBadgeItem(
    contribution: PluginWorkspaceRowBadgeItemContribution<PluginText>,
  ): PluginCleanup;
  /** Set what this plugin knows about one workspace; see `PluginWorkspaceSummaryItemContribution`. */
  addWorkspaceSummaryItem(
    contribution: PluginWorkspaceSummaryItemContribution<PluginText>,
  ): PluginWorkspaceSummaryItemRegistration;
  addWorkspacePanel(contribution: PluginWorkspacePanelContribution<PluginText>): PluginCleanup;
  addCommandCenterItem(
    contribution: PluginCommandCenterItemContribution<PluginText>,
  ): PluginCleanup;
  addSlashCommand(contribution: PluginClientSlashCommandContribution<PluginText>): PluginCleanup;
  addHeaderButton(
    contribution: PluginHeaderButtonContribution<PluginText>,
  ): PluginButtonRegistration<PluginText>;
  addComposerPill(
    contribution: PluginComposerPillContribution<PluginText>,
  ): PluginButtonRegistration<PluginText>;
  addAttachmentSource(contribution: PluginAttachmentSourceContribution<PluginText>): PluginCleanup;
  addComposerItem(contribution: PluginComposerItemContribution): PluginCleanup;
  addNewWorkspaceItem(contribution: PluginNewWorkspaceItemContribution): PluginCleanup;
  addTheme(contribution: PluginThemeContribution<PluginText>): PluginCleanup;
  addFilePanel(contribution: PluginFilePanelContribution<PluginText>): PluginCleanup;
  addTimelineTransformer<ItemType extends AgentTimelineItem["type"]>(
    contribution: PluginTimelineTransformerContribution<ItemType>,
  ): PluginCleanup;
  addTimelineRenderer<Schema extends ZodType>(
    contribution: PluginTimelineRendererContribution<Schema>,
  ): PluginCleanup;
  openPanel(id: string, options: PluginClientOpenPanelOptions): void;
  /**
   * Subscribes to a plugin subscription on this client's host. Paseo re-subscribes after a
   * reconnect and releases what is left when the plugin stops.
   */
  subscribe<InputSchema extends ZodType, EventSchema extends ZodType>(
    contract: PluginSubscriptionContract<InputSchema, EventSchema>,
    input: PluginWireInput<ZodInput<InputSchema>>,
    onEvent: (event: ZodOutput<EventSchema>) => void,
    options?: PluginSubscribeOptions,
  ): PluginSubscriptionHandle;
}

export type PluginClientContribution = (client: PluginClientContext) => PluginCleanup;

export type PluginWorkspacePanelContribution<Text extends PluginText = string> =
  | (PluginWorkspacePanelBase<Text> & {
      // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
      /** @deprecated Omit context. */
      context?: "workspace";
      Component: ComponentType<PluginWorkspacePanelProps>;
    })
  | (PluginWorkspacePanelBase<Text> & {
      // COMPAT(pluginAgentPanelAlias): added in v0.13.0, remove after 2027-04-23
      /** @deprecated Register with `addAgentPanel`. */
      context: "agent";
      Component: ComponentType<PluginAgentPanelProps>;
    });

export interface PluginAgentPanelContribution<
  Text extends PluginText = string,
> extends PluginWorkspacePanelBase<Text> {
  Component: ComponentType<PluginAgentPanelProps>;
}

export interface PluginSettingsScreenContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  Component: ComponentType<PluginSurfaceProps>;
}

/** The screen header's title: fixed, or derived from the params the screen was opened with. */
export type PluginScreenTitle<Text extends PluginText = string> =
  | Text
  | ((params: PluginScreenParams) => Text);

export interface PluginScreenContribution<Text extends PluginText = string> {
  id: string;
  title: PluginScreenTitle<Text>;
  Component: ComponentType<PluginScreenProps>;
}

export interface PluginSurfaceContribution {
  id: string;
  Component: ComponentType<PluginSurfaceProps>;
}

/** @deprecated Use `PluginSidebarItemContribution` with `addSidebarHeaderItem`. */
export interface PluginSidebarContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  surface: string;
}

export type PluginTimelineTransformerContribution<
  ItemType extends AgentTimelineItem["type"] = AgentTimelineItem["type"],
> = ItemType extends AgentTimelineItem["type"]
  ? {
      id: string;
      query: {
        itemType: ItemType;
      };
      transform(input: {
        item: Extract<AgentTimelineItem, { type: ItemType }>;
        phase: "streaming" | "complete";
      }): PluginTimelineTransformResult | undefined;
    }
  : never;

export interface PluginTimelineItemProps<Data = unknown> extends PluginNavigableHostProps {
  agentId: string;
  /** The agent's workspace, when the host knows it. Pass it to `openPluginScreen` to open a tab there. */
  workspaceId?: string;
  item: {
    type: "plugin";
    kind: string;
    version: number;
    data: Data;
  };
  timestamp: Date;
}

export interface PluginTimelineRendererContribution<Schema extends ZodType = ZodType> {
  kind: string;
  version: number;
  schema: Schema;
  Component: ComponentType<PluginTimelineItemProps<ZodOutput<Schema>>>;
}

export interface PluginCommandCapabilities {
  paseo: PluginPaseoApi;
  rpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    input: PluginWireInput<ZodInput<InputSchema>>,
  ): Promise<ZodOutput<OutputSchema>>;
  openScreen(input: PluginOpenScreenInput): void;
  /** The composers `selector` names, whether or not their tabs are open; see `useComposers`. */
  composers(selector: PluginComposerSelector): readonly PluginComposer[];
  /**
   * The `location` values `openScreen` honours for a `workspaceId` tab. Undefined on hosts that ignore
   * `location` and always open the tab in the main pane; check for `"explorer"` before relying on it.
   */
  readonly screenTabLocations?: readonly PluginPanelLocation[];
  /** @deprecated Use `openScreen`. */
  openSurface(id: string): void;
  openSettings(id: string): void;
}

export interface PluginGlobalCommandContext extends PluginCommandCapabilities {
  context: "global";
}

export interface PluginWorkspaceCommandContext extends PluginCommandCapabilities {
  context: "workspace";
  workspace: PluginWorkspaceSnapshot;
  openPanel(id: string, options?: PluginOpenPanelOptions): void;
}

export interface PluginAgentCommandContext extends PluginCommandCapabilities {
  context: "agent";
  workspace: PluginWorkspaceSnapshot;
  agent: PluginAgentSnapshot;
  openPanel(id: string, options?: PluginOpenPanelOptions): void;
}

interface PluginCommandCenterItemBase<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  keywords?: readonly string[];
}

export type PluginCommandCenterItemContribution<Text extends PluginText = string> =
  | (PluginCommandCenterItemBase<Text> & {
      context: "global";
      onSelect(context: PluginGlobalCommandContext): void | Promise<void>;
    })
  | (PluginCommandCenterItemBase<Text> & {
      context: "workspace";
      onSelect(context: PluginWorkspaceCommandContext): void | Promise<void>;
    })
  | (PluginCommandCenterItemBase<Text> & {
      context: "agent";
      onSelect(context: PluginAgentCommandContext): void | Promise<void>;
    });

interface PluginClientSlashCommandBase<Text extends PluginText = string> {
  name: string;
  description: Text;
  argumentHint: Text;
}

export type PluginClientSlashCommandContribution<Text extends PluginText = string> =
  | (PluginClientSlashCommandBase<Text> & {
      context: "workspace";
      onSubmit(context: PluginWorkspaceCommandContext & { args: string }): void | Promise<void>;
    })
  | (PluginClientSlashCommandBase<Text> & {
      context: "agent";
      onSubmit(context: PluginAgentCommandContext & { args: string }): void | Promise<void>;
    });

export type SettingsState<Schema extends ZodType> = (
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "invalid"; error: string; revision: string }
  | { status: "ready"; values: ZodOutput<Schema>; revision: string }
) & {
  saving: boolean;
  saveError: string | null;
  /** Save an entire document against the revision currently displayed. Never throws. */
  save(values: ZodOutput<Schema>, revision: string): Promise<boolean>;
  reset(): Promise<boolean>;
  reload(): Promise<void>;
};
