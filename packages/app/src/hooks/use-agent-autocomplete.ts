import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AutocompleteOption, AutocompleteStatus } from "@/components/ui/autocomplete";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";
import {
  useAutocompleteCommands,
  type AgentSlashCommand,
  type DraftCommandConfig,
  type DraftCommandTarget,
} from "@/agent-commands";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useAutocomplete } from "./use-autocomplete";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { pluginDisplayName, usePluginList } from "@/plugins/plugin-list";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { CLIENT_SLASH_COMMANDS, type ClientSlashCommand } from "@/client-slash-commands";
import type { PluginClientSlashCommand } from "@/plugins/client-slash-commands";
import { mergeSlashCommandSources } from "@/plugins/client-slash-commands/model";
import {
  applySlashCommandReplacement,
  filterAndRankCommandAutocompleteEntries,
  filterInlineSkillCommandEntries,
  findActiveSlashCommand,
  type SlashCommandRange,
} from "@/utils/agent-command-autocomplete";
import {
  applyFileMentionReplacement,
  findActiveFileMention,
  type FileMentionRange,
} from "@/utils/file-mention-autocomplete";
import {
  applyChangeRequestMentionReplacement,
  filterChangeRequestMentionCandidates,
  findActiveChangeRequestMention,
  mergeChangeRequestMentionCandidates,
  type ChangeRequestMentionRange,
} from "@/utils/change-request-mention-autocomplete";
import type { ChangeRequestList } from "@getpaseo/client";
import { forgeFromRemoteUrl, getForgePresentation } from "@/git/forge";
import { buildForgeChangeRequestUrl, buildForgeRepositoryUrl } from "@/git/forge-url";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

interface UseAgentAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  setUserInput: (nextValue: string) => void;
  serverId: string;
  agentId: string;
  draft?: DraftCommandTarget;
  onAutocompleteApplied?: () => void;
  onClientSlashCommand?: (command: ClientSlashCommand) => void;
  canExecuteClientSlashCommand?: boolean;
  pluginClientSlashCommands?: readonly PluginClientSlashCommand[];
}

interface AgentAutocompleteKeyPressEvent {
  key: string;
  preventDefault: () => void;
  input: AgentAutocompleteInputSnapshot;
}

interface AgentAutocompleteInputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

type AgentAutocompleteOption =
  | (AutocompleteOption & { type: "client_command"; command: ClientSlashCommand })
  | (AutocompleteOption & {
      type: "plugin_command";
      command: PluginClientSlashCommand;
    })
  | (AutocompleteOption & { type: "provider_command" })
  | (AutocompleteOption & {
      type: "workspace_entry";
      entryPath: string;
      mention: FileMentionRange;
    })
  | (AutocompleteOption & {
      type: "change_request";
      reference: string;
    });

interface AgentAutocompleteResult {
  isVisible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  /** Shown in place of options; set exactly when `options` is empty. */
  status: AutocompleteStatus | null;
  onSelectOption: (option: AutocompleteOption, input?: AgentAutocompleteInputSnapshot) => void;
  onKeyPress: (event: AgentAutocompleteKeyPressEvent) => boolean;
}

interface AgentAutocompleteSnapshot {
  text: string;
  slashCommand: SlashCommandRange | null;
  fileMention: FileMentionRange | null;
  changeRequestMention: ChangeRequestMentionRange | null;
}

function resolveAgentAutocompleteSnapshot(input: {
  input?: AgentAutocompleteInputSnapshot;
  userInput: string;
  cursorIndex: number;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  activeChangeRequestMention: ChangeRequestMentionRange | null;
}): AgentAutocompleteSnapshot {
  if (!input.input) {
    return {
      text: input.userInput,
      slashCommand: input.activeSlashCommand,
      fileMention: input.activeFileMention,
      changeRequestMention: input.activeChangeRequestMention,
    };
  }

  const text = input.input.text;
  const cursorIndex = input.input.selection.start;
  return {
    text,
    slashCommand: findActiveSlashCommand({ text, cursorIndex }),
    fileMention: findActiveFileMention({ text, cursorIndex }),
    changeRequestMention: findActiveChangeRequestMention({ text, cursorIndex }),
  };
}

interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

type AvailableCommand =
  | { source: "client"; command: ClientSlashCommand }
  | { source: "plugin"; command: PluginClientSlashCommand }
  | { source: "provider"; command: AgentSlashCommand };

function resolveDraftQueryConfig(draft?: DraftCommandTarget): DraftCommandConfig | undefined {
  if (draft?.status !== "ready") {
    return undefined;
  }

  const draftConfig = draft.config;
  const cwd = draftConfig.cwd.trim();
  const modeId = draftConfig.modeId?.trim() ?? "";
  const model = draftConfig.model?.trim() ?? "";
  const thinkingOptionId = draftConfig.thinkingOptionId?.trim() ?? "";
  const providerOptions = draftConfig.providerOptions;
  return {
    provider: draftConfig.provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(providerOptions && Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
}

function mapDirectorySuggestionsToEntries(payload: {
  entries?: Array<{ path: string; kind: string }>;
  directories?: string[];
}): DirectorySuggestionEntry[] {
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries.flatMap((entry) => {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        (entry.kind !== "file" && entry.kind !== "directory")
      ) {
        return [];
      }
      return [{ path: entry.path, kind: entry.kind }];
    });
  }

  return (payload.directories ?? []).map((path) => ({
    path,
    kind: "directory" as const,
  }));
}

const CLIENT_COMMAND_ICONS = {
  "archive-agent": "archive",
  "replace-agent-with-draft": "new-draft",
} as const satisfies Record<ClientSlashCommand["kind"], AutocompleteOption["icon"]>;

interface CommandOptionContext {
  query: string;
  pluginNames: ReadonlyMap<string, string>;
  t: TFunction;
}

function mapCommandToOption(
  entry: AvailableCommand,
  context: CommandOptionContext,
): AgentAutocompleteOption {
  const command = entry.command;
  const base = {
    id: command.name,
    label: `/${command.name}`,
    // The label carries a leading slash the query does not.
    labelMatches: findHighlightRanges(context.query, command.name).map((range) => ({
      start: range.start + 1,
      length: range.length,
    })),
    argumentHint: command.argumentHint || undefined,
  };
  if (entry.source === "client") {
    return {
      ...base,
      type: "client_command",
      command: entry.command,
      icon: CLIENT_COMMAND_ICONS[entry.command.kind],
      description: context.t(entry.command.descriptionKey),
      tag: "Paseo",
    };
  }
  if (entry.source === "plugin") {
    return {
      ...base,
      type: "plugin_command",
      command: entry.command,
      icon: "plugin",
      description: entry.command.description,
      tag: context.pluginNames.get(entry.command.pluginId) ?? entry.command.pluginId,
    };
  }
  const isSkill = entry.command.kind === "skill";
  return {
    ...base,
    type: "provider_command",
    icon: isSkill ? "skill" : "command",
    description: entry.command.description,
    tag: isSkill ? context.t("agentAutocomplete.skillTag") : undefined,
  };
}

type AutocompleteMode = "command" | "file" | "change_request" | null;

interface BuildAutocompleteOptionsInput {
  mode: AutocompleteMode;
  commands: AgentSlashCommand[];
  pluginCommands: readonly PluginClientSlashCommand[];
  pluginNames: ReadonlyMap<string, string>;
  isDraftContext: boolean;
  commandFilterQuery: string;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  fileSuggestions: DirectorySuggestionEntry[];
  t: TFunction;
}

function buildAutocompleteOptions(input: BuildAutocompleteOptionsInput): AgentAutocompleteOption[] {
  if (input.mode === "command") {
    const providerCommands = input.commands.map((command) => ({
      source: "provider" as const,
      command,
    }));
    const rootCommands: AvailableCommand[] = mergeSlashCommandSources({
      builtIn: CLIENT_SLASH_COMMANDS,
      plugins: input.pluginCommands,
      provider: input.commands,
      onPluginCollision(command, winner) {
        console.warn(
          `[Plugins] Client slash command /${command.name} from ${command.pluginId} ignored; ${winner} command wins`,
        );
      },
    })
      .filter((entry) => !input.isDraftContext || entry.source !== "built-in")
      .map((entry): AvailableCommand => {
        if (entry.source === "built-in") return { source: "client", command: entry.command };
        return entry;
      });
    const availableCommands: AvailableCommand[] =
      input.activeSlashCommand?.position === "inline"
        ? filterInlineSkillCommandEntries(providerCommands)
        : rootCommands;
    const matches = filterAndRankCommandAutocompleteEntries(
      availableCommands,
      input.commandFilterQuery,
    );
    const context = {
      query: input.commandFilterQuery,
      pluginNames: input.pluginNames,
      t: input.t,
    };
    return orderAutocompleteOptions(matches).map((entry) => mapCommandToOption(entry, context));
  }

  const activeFileMention = input.activeFileMention;
  if (input.mode === "file" && activeFileMention) {
    const orderedEntries = orderAutocompleteOptions(input.fileSuggestions);
    return orderedEntries.map((entry) => ({
      type: "workspace_entry" as const,
      id: `${entry.kind}:${entry.path}`,
      label: entry.path,
      icon: entry.kind,
      entryPath: entry.path,
      mention: activeFileMention,
    }));
  }

  return [];
}

function resolveAutocompleteMode(args: {
  showFileAutocomplete: boolean;
  showChangeRequestAutocomplete: boolean;
  showCommandAutocomplete: boolean;
}): AutocompleteMode {
  if (args.showFileAutocomplete) {
    return "file";
  }
  // Before commands, so `/review #12` offers pull requests for the argument.
  if (args.showChangeRequestAutocomplete) {
    return "change_request";
  }
  if (args.showCommandAutocomplete) {
    return "command";
  }
  return null;
}

/** A closed `#` menu (see `resolveChangeRequestMenu`) hides the whole picker. */
function resolveMenuIsVisible(args: {
  isVisibleBeforeChangeRequests: boolean;
  mode: AutocompleteMode;
  changeRequestMenu: AutocompleteMenu | null;
}): boolean {
  if (args.mode === "change_request") return args.changeRequestMenu !== null;
  return args.isVisibleBeforeChangeRequests;
}

function resolveAutocompleteQuery(args: {
  mode: AutocompleteMode;
  commandFilterQuery: string;
  fileFilterQuery: string;
  changeRequestFilterQuery: string | undefined;
}): string {
  if (args.mode === "command") return args.commandFilterQuery;
  if (args.mode === "change_request") return args.changeRequestFilterQuery ?? "";
  return args.fileFilterQuery;
}

function resolveAutocompleteIsVisible(args: {
  mode: AutocompleteMode;
  canLoadCommands: boolean;
  serverId: string;
  autocompleteCwd: string;
}): boolean {
  if (args.mode === "command") {
    return args.canLoadCommands;
  }
  if (args.mode === "file" || args.mode === "change_request") {
    return Boolean(args.serverId) && args.autocompleteCwd.length > 0;
  }
  return false;
}

function resolveCanLoadCommands(args: {
  serverId: string;
  agentId: string;
  isDraftContext: boolean;
}): boolean {
  if (!args.serverId) {
    return false;
  }
  return Boolean(args.agentId) || args.isDraftContext;
}

type CommandsState = "ready" | "loading" | "error";

function resolveCommandsState(input: {
  canListCommands: boolean;
  isLoading: boolean;
  isError: boolean;
}): CommandsState {
  if (!input.canListCommands) return "ready";
  if (input.isError) return "error";
  if (input.isLoading) return "loading";
  return "ready";
}

interface AutocompleteMenu {
  options: AgentAutocompleteOption[];
  status: AutocompleteStatus | null;
}

/**
 * One state for the open menu, so options and a loading or error row cannot both claim it:
 * while a status row shows there are no options for Enter or Tab to pick.
 */
function resolveCommandMenu(input: {
  commandsState: CommandsState;
  options: () => AgentAutocompleteOption[];
  providerLabel: string | null;
  error: Error | null;
  onRetry: () => void;
  emptyText: string;
  t: TFunction;
}): AutocompleteMenu {
  const { t } = input;
  if (input.commandsState === "loading") {
    const message = input.providerLabel
      ? t("agentAutocomplete.loadingProviderCommands", { provider: input.providerLabel })
      : t("agentAutocomplete.loadingCommands");
    return { options: [], status: { kind: "loading", message } };
  }
  if (input.commandsState === "error") {
    const title = input.providerLabel
      ? t("agentAutocomplete.providerCommandsFailed", { provider: input.providerLabel })
      : t("agentAutocomplete.commandsFailed");
    return {
      options: [],
      status: { kind: "error", title, reason: input.error?.message, onRetry: input.onRetry },
    };
  }
  return withEmptyStatus(input.options(), input.emptyText);
}

function resolveFileMenu(input: {
  options: () => AgentAutocompleteOption[];
  isPending: boolean;
  isLoading: boolean;
  error: unknown;
  t: TFunction;
}): AutocompleteMenu {
  const options = input.options();
  if (input.isPending || (input.isLoading && options.length === 0)) {
    return {
      options: [],
      status: { kind: "loading", message: input.t("agentAutocomplete.searchingWorkspace") },
    };
  }
  if (input.error instanceof Error) {
    return {
      options: [],
      status: {
        kind: "error",
        title: input.t("agentAutocomplete.filesFailed"),
        reason: input.error.message,
      },
    };
  }
  return withEmptyStatus(options, input.t("agentAutocomplete.noFiles"));
}

/** A pull request the `#` menu offers: from the open list, or read by the exact number typed. */
interface ChangeRequestMentionItem {
  number: number;
  title: string;
  headRefName: string | null;
  state: "open" | "merged" | "closed";
}

const CHANGE_REQUEST_STATE_LABEL_KEYS: Partial<Record<ChangeRequestMentionItem["state"], string>> =
  {
    merged: "workspace.git.pr.states.merged",
    closed: "workspace.git.pr.states.closed",
  };

/** Open is the norm in this list, so only a merged or closed one is labelled. */
function describeChangeRequest(item: ChangeRequestMentionItem, t: TFunction): string | undefined {
  const stateKey = CHANGE_REQUEST_STATE_LABEL_KEYS[item.state];
  const parts = [stateKey ? t(stateKey) : null, item.headRefName].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function buildChangeRequestOptions(input: {
  items: readonly ChangeRequestMentionItem[];
  query: string;
  numberPrefix: string;
  t: TFunction;
}): AgentAutocompleteOption[] {
  const isNumberQuery = /^\d+$/.test(input.query);
  // The list opens above the input: the newest or best match sits next to it, preselected.
  const ordered = orderAutocompleteOptions(
    filterChangeRequestMentionCandidates(input.items, input.query),
  );
  return ordered.map((item) => {
    const reference = `${input.numberPrefix}${item.number}`;
    const label = `${reference} ${item.title}`;
    // A number query leaves the label plain: the typed digits already lead every row.
    const labelMatches = isNumberQuery
      ? []
      : findHighlightRanges(input.query, item.title).map((range) => ({
          start: range.start + reference.length + 1,
          length: range.length,
        }));
    return {
      type: "change_request" as const,
      id: `change_request:${item.number}`,
      label,
      labelMatches: input.query ? labelMatches : undefined,
      icon: "pull-request" as const,
      description: describeChangeRequest(item, input.t),
      reference,
    };
  });
}

function resolveChangeRequestListFailure(
  list: ChangeRequestList | undefined,
  error: unknown,
): { kind: "none" } | { kind: "hidden" } | { kind: "failed"; reason?: string } {
  if (error instanceof Error) return { kind: "failed", reason: error.message };
  if (!list || list.ok) return { kind: "none" };
  if (list.reason === "unsupported" || list.reason === "not_found") return { kind: "hidden" };
  return { kind: "failed", reason: list.error };
}

function changeRequestLoadingMenu(t: TFunction): AutocompleteMenu {
  return {
    options: [],
    status: { kind: "loading", message: t("agentAutocomplete.loadingChangeRequests") },
  };
}

/**
 * The menu hides where the host can't list the remote's pull requests (no forge it knows, or
 * a repository it can't find), so a `#` typed there stays plain text.
 */
export function resolveChangeRequestMenu(input: {
  list: ChangeRequestList | undefined;
  lookedUpItems: readonly ChangeRequestMentionItem[];
  query: string;
  numberPrefix: string;
  isPending: boolean;
  error: unknown;
  t: TFunction;
}): AutocompleteMenu | null {
  if (input.isPending) return changeRequestLoadingMenu(input.t);
  const failure = resolveChangeRequestListFailure(input.list, input.error);
  if (failure.kind === "hidden") return null;
  if (failure.kind === "failed") {
    return {
      options: [],
      status: {
        kind: "error",
        title: input.t("agentAutocomplete.changeRequestsFailed"),
        reason: failure.reason,
      },
    };
  }
  const listed = (input.list?.items ?? []).map(
    (item): ChangeRequestMentionItem => ({
      number: item.number,
      title: item.title,
      headRefName: item.headRef,
      state: "open",
    }),
  );
  const options = buildChangeRequestOptions({
    items: mergeChangeRequestMentionCandidates([listed, input.lookedUpItems]),
    query: input.query,
    numberPrefix: input.numberPrefix,
    t: input.t,
  });
  return withEmptyStatus(options, input.t("agentAutocomplete.noChangeRequests"));
}

function withEmptyStatus(options: AgentAutocompleteOption[], emptyText: string): AutocompleteMenu {
  return options.length > 0
    ? { options, status: null }
    : { options, status: { kind: "empty", message: emptyText } };
}

/** How long a command menu waits for commands before it opens on a loading row. */
const COMMANDS_LOADING_REVEAL_MS = 300;

/**
 * Whether the open command menu has waited long enough to show a loading row. Commands that
 * arrive sooner paint the list as the first frame; once the wait is over, loading (a retry)
 * shows at once so the open menu never closes on itself.
 */
function useLoadingRevealed(isMenuOpen: boolean): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!isMenuOpen) {
      setRevealed(false);
      return undefined;
    }
    const timer = setTimeout(() => setRevealed(true), COMMANDS_LOADING_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [isMenuOpen]);
  return revealed;
}

/** The names command rows and status rows show: the provider's label and each plugin's name. */
function useCommandSourceNames(input: {
  serverId: string;
  agentId: string;
  draftConfig: DraftCommandConfig | undefined;
  cwd: string;
  isCommandMenuOpen: boolean;
  commandsState: CommandsState;
  pluginCommandCount: number;
}): { providerLabel: string | null; pluginNames: ReadonlyMap<string, string> } {
  const agentProvider = useSessionStore(
    (state) => state.sessions[input.serverId]?.agents?.get(input.agentId)?.provider,
  );
  const provider = input.draftConfig?.provider ?? agentProvider;
  // Only a loading or error row names the provider; only plugin rows need plugin names.
  const { entries: providerEntries } = useProvidersSnapshot(input.serverId, {
    cwd: input.cwd,
    enabled: input.isCommandMenuOpen && input.commandsState !== "ready",
  });
  const pluginList = usePluginList(input.serverId, {
    enabled: input.isCommandMenuOpen && input.pluginCommandCount > 0,
  });
  const pluginNames = useMemo(
    () => new Map((pluginList.data ?? []).map((plugin) => [plugin.id, pluginDisplayName(plugin)])),
    [pluginList.data],
  );
  return {
    providerLabel: provider ? resolveProviderLabel(provider, providerEntries) : null,
    pluginNames,
  };
}

// A draft's agentId is a draft key the daemon does not know, so a draft lists
// commands by its config only, and not at all until that config is complete.
function resolveDraftCommandContext(draft: DraftCommandTarget | undefined) {
  const queryDraftConfig = resolveDraftQueryConfig(draft);
  const isDraftContext = draft !== undefined;
  return {
    isDraftContext,
    queryDraftConfig,
    canListCommands: !isDraftContext || queryDraftConfig !== undefined,
  };
}

function resolveCommandsEmptyText(args: {
  draft: DraftCommandTarget | undefined;
  t: TFunction;
}): string {
  if (args.draft?.status === "needs-project") {
    return args.t("agentAutocomplete.chooseProjectForCommands");
  }
  if (args.draft?.status === "needs-provider") {
    return args.t("agentAutocomplete.chooseModelForCommands");
  }
  return args.t("agentAutocomplete.noCommands");
}

/** How long a typed number settles before the picker reads that pull request on its own. */
const CHANGE_REQUEST_LOOKUP_DEBOUNCE_MS = 250;
/** Matches the host's list cache, so reopening `#` within it costs no forge call. */
const CHANGE_REQUEST_STALE_MS = 30_000;

type HostClient = ReturnType<typeof useHostRuntimeClient>;

/**
 * The open list covers the usual `#`, but a typed number may name an older open one or a
 * closed or merged one. A settled number that isn't listed is read on its own.
 */
function useChangeRequestNumberLookup(input: {
  client: HostClient;
  serverId: string;
  forge: string | null;
  repositoryUrl: string | null;
  query: string;
  list: ChangeRequestList | undefined;
  enabled: boolean;
}): ChangeRequestMentionItem[] {
  const settledQuery = useDebouncedValue(input.query, CHANGE_REQUEST_LOOKUP_DEBOUNCE_MS);
  const number = /^\d+$/.test(settledQuery) ? Number(settledQuery) : null;
  const isListed = input.list?.items.some((item) => item.number === number) ?? false;
  const url =
    number !== null && input.forge && input.repositoryUrl
      ? buildForgeChangeRequestUrl(input.forge, input.repositoryUrl, number)
      : null;
  const { client } = input;
  const { data } = useQuery({
    queryKey: ["changeRequestMentionRead", input.serverId, url],
    queryFn: async () => {
      if (!client || !url) return null;
      const [read] = await client.readChangeRequests([url]);
      return read ?? null;
    },
    enabled: input.enabled && input.list?.ok === true && url !== null && !isListed,
    staleTime: CHANGE_REQUEST_STALE_MS,
    retry: false,
  });
  return useMemo(() => {
    if (settledQuery !== input.query || !data?.ok || String(data.number) !== settledQuery) {
      return [];
    }
    return [{ number: data.number, title: data.title, headRefName: null, state: data.state }];
  }, [data, input.query, settledQuery]);
}

/**
 * The `#` menu: the repository's open pull requests from the host's pull request service,
 * filtered here as the user types, so the menu stays instant after the first `#`.
 * Null while closed, and where the menu hides (see `resolveChangeRequestMenu`).
 */
function useChangeRequestMentionMenu(input: {
  serverId: string;
  cwd: string;
  mention: ChangeRequestMentionRange | null;
  isOpen: boolean;
  isConnected: boolean;
}): AutocompleteMenu | null {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(input.serverId);
  const enabled = input.isOpen && input.isConnected && input.cwd.length > 0;
  const { status } = useCheckoutStatusQuery({ serverId: input.serverId, cwd: input.cwd });
  const remoteUrl = status?.remoteUrl ?? null;
  const cloudForge = forgeFromRemoteUrl(remoteUrl);
  // A self-hosted remote's forge needs the host to tell; a cloud one is known from its host.
  // Until the host answers the forge stays unknown, so no prefix or URL grammar is guessed.
  const prStatus = useCheckoutPrStatusQuery({
    serverId: input.serverId,
    cwd: input.cwd,
    enabled: enabled && remoteUrl !== null && cloudForge === null,
  });
  const forge = cloudForge ?? prStatus.resolvedForge;
  const isForgePending = remoteUrl !== null && forge === null && !prStatus.isError;
  const repositoryUrl = forge
    ? buildForgeRepositoryUrl(forge, { remoteUrl, forgeWeb: status?.forgeWeb })
    : null;
  const listQuery = useQuery({
    queryKey: ["changeRequestMentionList", input.serverId, repositoryUrl],
    queryFn: async () => {
      if (!client || !repositoryUrl) throw new Error(t("common.errors.daemonClientUnavailable"));
      return await client.listOpenChangeRequests(repositoryUrl);
    },
    enabled: enabled && client !== null && repositoryUrl !== null,
    staleTime: CHANGE_REQUEST_STALE_MS,
    retry: false,
  });
  const { data: list, error, isPending } = listQuery;
  const query = input.mention?.query ?? "";
  const lookedUpItems = useChangeRequestNumberLookup({
    client,
    serverId: input.serverId,
    forge,
    repositoryUrl,
    query: query.trim(),
    list,
    enabled,
  });
  return useMemo(() => {
    if (!enabled) return null;
    if (isForgePending) return changeRequestLoadingMenu(t);
    if (forge === null || repositoryUrl === null) return null;
    return resolveChangeRequestMenu({
      list,
      lookedUpItems,
      query,
      numberPrefix: getForgePresentation(forge).numberPrefix,
      isPending,
      error,
      t,
    });
  }, [
    enabled,
    error,
    forge,
    isForgePending,
    isPending,
    list,
    lookedUpItems,
    query,
    repositoryUrl,
    t,
  ]);
}

export function useAgentAutocomplete(input: UseAgentAutocompleteInput): AgentAutocompleteResult {
  const { t } = useTranslation();
  const {
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    draft,
    onAutocompleteApplied,
    onClientSlashCommand,
    canExecuteClientSlashCommand,
    pluginClientSlashCommands = [],
  } = input;

  const activeSlashCommand = useMemo(
    () =>
      findActiveSlashCommand({
        text: userInput,
        cursorIndex,
      }),
    [cursorIndex, userInput],
  );
  const showCommandAutocomplete = activeSlashCommand !== null;
  const commandFilterQuery = activeSlashCommand?.query ?? "";

  const activeFileMention = useMemo(
    () =>
      findActiveFileMention({
        text: userInput,
        cursorIndex,
      }),
    [cursorIndex, userInput],
  );
  const showFileAutocomplete = activeFileMention !== null;
  const activeChangeRequestMention = useMemo(
    () => findActiveChangeRequestMention({ text: userInput, cursorIndex }),
    [cursorIndex, userInput],
  );
  const showChangeRequestAutocomplete = activeChangeRequestMention !== null;
  const fileFilterQuery = activeFileMention?.query ?? "";
  const [debouncedFileFilterQuery, setDebouncedFileFilterQuery] = useState(fileFilterQuery);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileFilterQuery(fileFilterQuery), 180);
    return () => clearTimeout(timer);
  }, [fileFilterQuery]);

  const { isDraftContext, queryDraftConfig, canListCommands } = useMemo(
    () => resolveDraftCommandContext(draft),
    [draft],
  );
  const canLoadCommands = resolveCanLoadCommands({ serverId, agentId, isDraftContext });

  const agentCwd = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? "",
  );
  const autocompleteCwd = useMemo(() => {
    if (isDraftContext) {
      return queryDraftConfig?.cwd ?? "";
    }
    return agentCwd.trim();
  }, [agentCwd, isDraftContext, queryDraftConfig]);

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const mode = resolveAutocompleteMode({
    showFileAutocomplete,
    showChangeRequestAutocomplete,
    showCommandAutocomplete,
  });
  const canShowAutocomplete = resolveAutocompleteIsVisible({
    mode,
    canLoadCommands,
    serverId,
    autocompleteCwd,
  });

  const commandsQuery = useAutocompleteCommands({
    serverId,
    agentId,
    enabled: mode === "command" && canLoadCommands && canListCommands,
    draftConfig: queryDraftConfig,
  });
  const commandsState = resolveCommandsState({
    canListCommands,
    isLoading: commandsQuery.isLoading,
    isError: commandsQuery.isError,
  });
  const isCommandMenuOpen = mode === "command" && canShowAutocomplete;
  const isLoadingRevealed = useLoadingRevealed(isCommandMenuOpen);
  const isVisibleBeforeChangeRequests =
    canShowAutocomplete &&
    !(isCommandMenuOpen && commandsState === "loading" && !isLoadingRevealed);
  const { providerLabel, pluginNames } = useCommandSourceNames({
    serverId,
    agentId,
    draftConfig: queryDraftConfig,
    cwd: autocompleteCwd,
    isCommandMenuOpen,
    commandsState,
    pluginCommandCount: pluginClientSlashCommands.length,
  });

  const fileSuggestionsQuery = useQuery({
    queryKey: [
      "directorySuggestions",
      serverId,
      autocompleteCwd,
      debouncedFileFilterQuery,
      true,
      true,
    ],
    queryFn: async (): Promise<DirectorySuggestionEntry[]> => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const response = await client.getDirectorySuggestions({
        cwd: autocompleteCwd,
        query: debouncedFileFilterQuery,
        limit: 50,
        includeFiles: true,
        includeDirectories: true,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return mapDirectorySuggestionsToEntries(response);
    },
    enabled:
      mode === "file" &&
      Boolean(serverId) &&
      autocompleteCwd.length > 0 &&
      Boolean(client) &&
      isConnected,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const changeRequestMenu = useChangeRequestMentionMenu({
    serverId,
    cwd: autocompleteCwd,
    mention: activeChangeRequestMention,
    isOpen: mode === "change_request",
    isConnected,
  });
  const isVisible = resolveMenuIsVisible({
    isVisibleBeforeChangeRequests,
    mode,
    changeRequestMenu,
  });

  const commandsEmptyText = resolveCommandsEmptyText({ draft, t });
  const retryCommandsQuery = commandsQuery.retry;
  const retryCommands = useCallback(() => {
    retryCommandsQuery();
    // Pressing Retry takes focus on web; hand it back so the user keeps typing the command.
    onAutocompleteApplied?.();
  }, [onAutocompleteApplied, retryCommandsQuery]);
  const { options, status } = useMemo<AutocompleteMenu>(() => {
    if (!isVisible) return { options: [], status: null };
    if (changeRequestMenu) return changeRequestMenu;
    const buildOptions = () =>
      buildAutocompleteOptions({
        activeFileMention,
        commandFilterQuery,
        commands: commandsQuery.commands,
        pluginCommands: pluginClientSlashCommands,
        pluginNames,
        activeSlashCommand,
        fileSuggestions: fileSuggestionsQuery.data ?? [],
        isDraftContext,
        mode,
        t,
      });
    if (mode === "file") {
      return resolveFileMenu({
        options: buildOptions,
        isPending: fileSuggestionsQuery.isPending,
        isLoading: fileSuggestionsQuery.isLoading,
        error: fileSuggestionsQuery.error,
        t,
      });
    }
    return resolveCommandMenu({
      commandsState,
      options: buildOptions,
      providerLabel,
      error: commandsQuery.error,
      onRetry: retryCommands,
      emptyText: commandsEmptyText,
      t,
    });
  }, [
    activeFileMention,
    activeSlashCommand,
    changeRequestMenu,
    commandFilterQuery,
    commandsEmptyText,
    commandsQuery.commands,
    commandsQuery.error,
    commandsState,
    fileSuggestionsQuery.data,
    fileSuggestionsQuery.error,
    fileSuggestionsQuery.isLoading,
    fileSuggestionsQuery.isPending,
    isDraftContext,
    isVisible,
    mode,
    pluginClientSlashCommands,
    pluginNames,
    providerLabel,
    retryCommands,
    t,
  ]);

  const onSelectOption = useCallback(
    (option: AutocompleteOption, snapshot?: AgentAutocompleteInputSnapshot) => {
      const selected = option as AgentAutocompleteOption;
      const current = resolveAgentAutocompleteSnapshot({
        input: snapshot,
        userInput,
        cursorIndex,
        activeSlashCommand,
        activeFileMention,
        activeChangeRequestMention,
      });
      if (selected.type === "change_request") {
        if (!current.changeRequestMention) return;
        setUserInput(
          applyChangeRequestMentionReplacement({
            text: current.text,
            mention: current.changeRequestMention,
            reference: selected.reference,
          }),
        );
        onAutocompleteApplied?.();
        return;
      }
      const selectedIsCommand =
        selected.type === "client_command" ||
        selected.type === "plugin_command" ||
        selected.type === "provider_command";
      if (snapshot && selectedIsCommand && !current.slashCommand) return;
      if (
        selected.type === "client_command" &&
        selected.command.execution === "immediate" &&
        canExecuteClientSlashCommand &&
        onClientSlashCommand
      ) {
        onClientSlashCommand(selected.command);
        return;
      }

      if (selectedIsCommand) {
        if (!current.slashCommand) {
          setUserInput(`/${selected.id} `);
          onAutocompleteApplied?.();
          return;
        }

        const nextInput = applySlashCommandReplacement({
          text: current.text,
          command: current.slashCommand,
          commandName: selected.id,
        });
        setUserInput(nextInput);
        onAutocompleteApplied?.();
        return;
      }

      if (!current.fileMention) return;
      const nextInput = applyFileMentionReplacement({
        text: current.text,
        mention: current.fileMention,
        relativePath: selected.entryPath,
      });
      setUserInput(nextInput);
      onAutocompleteApplied?.();
    },
    [
      canExecuteClientSlashCommand,
      onAutocompleteApplied,
      onClientSlashCommand,
      setUserInput,
      userInput,
      cursorIndex,
      activeFileMention,
      activeSlashCommand,
      activeChangeRequestMention,
    ],
  );

  const selectOptionFromKeyPress = useCallback(
    (option: AutocompleteOption, event?: AgentAutocompleteKeyPressEvent) =>
      onSelectOption(option, event?.input),
    [onSelectOption],
  );

  const { selectedIndex, onKeyPress } = useAutocomplete({
    isVisible,
    options,
    query: resolveAutocompleteQuery({
      mode,
      commandFilterQuery,
      fileFilterQuery,
      changeRequestFilterQuery: activeChangeRequestMention?.query,
    }),
    onSelectOption: selectOptionFromKeyPress,
    onEscape:
      mode === "command" && activeSlashCommand?.position === "start"
        ? () => setUserInput("")
        : undefined,
  });

  return {
    isVisible,
    options,
    selectedIndex,
    status,
    onSelectOption,
    onKeyPress,
  };
}
