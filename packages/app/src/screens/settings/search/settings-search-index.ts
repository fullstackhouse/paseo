import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import type { SettingsSearchTarget } from "./settings-search";

/** An i18n key, or literal text for rows the page itself has not translated yet. */
export type SettingsSearchLabel = string | { text: string };

export interface SettingsSearchEntry {
  target: SettingsSearchTarget;
  title: SettingsSearchLabel;
  hint?: SettingsSearchLabel;
  desktopOnly?: boolean;
  webOnly?: boolean;
}

type EntrySpec = [title: SettingsSearchLabel, hint?: SettingsSearchLabel];
type EntryOptions = Pick<SettingsSearchEntry, "desktopOnly" | "webOnly">;

function app(
  section: SettingsSectionSlug,
  specs: EntrySpec[],
  options: EntryOptions = {},
): SettingsSearchEntry[] {
  return specs.map(([title, hint]) => ({
    target: { kind: "section", section },
    title,
    hint,
    ...options,
  }));
}

function host(section: HostSectionSlug, specs: EntrySpec[]): SettingsSearchEntry[] {
  return specs.map(([title, hint]) => ({ target: { kind: "host", section }, title, hint }));
}

/**
 * The individual settings search can find, beyond the section names. Reuse the
 * keys the row renders so results read exactly like the row. When you add a
 * setting row, add it here too.
 */
export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  ...app("general", [["settings.general.language.label", "settings.general.language.description"]]),
  ...app("general", [["settings.general.setup.label", "settings.general.setup.description"]], {
    webOnly: true,
  }),
  ...app("general", [
    ["settings.general.sending"],
    ["settings.general.defaultSend.label"],
    ["settings.general.sendShortcut.label"],
  ]),
  ...app(
    "general",
    [
      ["settings.layout.openInSidePane.title"],
      ["settings.layout.openInSidePane.sources.explorerOnWorkspaceEnter.label"],
      ["settings.layout.openInSidePane.sources.serviceUrls.label"],
    ],
    { desktopOnly: true },
  ),
  ...app("appearance", [
    ["settings.appearance.theme.title"],
    ["settings.appearance.fonts.title"],
    ["settings.appearance.fonts.interfaceFont", "settings.appearance.fonts.interfaceFontHint"],
    ["settings.appearance.fonts.interfaceSize", "settings.appearance.fonts.interfaceSizeHint"],
    ["settings.appearance.fonts.contentSize", "settings.appearance.fonts.contentSizeHint"],
    ["settings.appearance.fonts.codeFont", "settings.appearance.fonts.codeFontHint"],
    ["settings.appearance.fonts.codeSize", "settings.appearance.fonts.codeSizeHint"],
    ["settings.appearance.layout.contentWidth", "settings.appearance.layout.contentWidthHint"],
    ["settings.appearance.syntax.highlightTheme", "settings.appearance.syntax.highlightThemeHint"],
  ]),
  ...app("sidebar", [
    ["settings.appearance.sidebar.header.title", "settings.appearance.sidebar.header.description"],
    ["settings.appearance.sidebar.footer.title", "settings.appearance.sidebar.footer.description"],
  ]),
  ...app("chat", [
    ["settings.general.chatDisplay.label", "settings.general.chatDisplay.description"],
    ["settings.appearance.detailLevel.title"],
    [
      "settings.general.autoExpandReasoning.label",
      "settings.general.autoExpandReasoning.description",
    ],
    ["settings.appearance.chatOutline.title", "settings.appearance.chatOutline.description"],
  ]),
  ...app("terminal", [
    [
      "settings.general.terminalScrollback.label",
      "settings.general.terminalScrollback.description",
    ],
  ]),
  ...app("browser", [
    ["settings.general.browserData.siteData", "settings.general.browserData.description"],
  ]),
  ...app("editor", [["settings.editor.vimKeybindings", "settings.editor.vimHint"]]),
  ...app("integrations", [["settings.integrations.commandLine.title"]]),
  ...app("notifications", [
    ["settings.notifications.permission"],
    ["settings.notifications.playSound", "settings.notifications.playSoundHint"],
    ["settings.notifications.test", "settings.notifications.testHint"],
  ]),
  ...app("permissions", [["settings.permissions.microphone"]]),
  ...app("diagnostics", [
    ["settings.diagnostics.app.rowTitle", "settings.diagnostics.app.rowHint"],
    ["settings.diagnostics.testAudio"],
  ]),
  ...app("about", [
    ["settings.about.appVersion"],
    ["changelog.title", "settings.about.whatsNewHint"],
    ["settings.about.connectedHosts"],
  ]),
  ...app(
    "about",
    [
      ["settings.about.updates.label"],
      ["settings.about.updates.autoInstallLabel", "settings.about.updates.autoInstallDescription"],
    ],
    { desktopOnly: true },
  ),
  ...host("host", [
    ["settings.host.appearance.name.label"],
    ["settings.host.appearance.color.label"],
    ["settings.host.appearance.badge.label"],
    ["settings.host.daemon.restart.title"],
    ["settings.host.daemon.update.title"],
    ["settings.host.daemon.remove.title"],
  ]),
  ...host("connections", [["settings.host.connections.title"]]),
  ...host("pair-device", [["settings.host.pairDevices.rowTitle"]]),
  ...host("agents", [
    ["settings.host.orchestration.enableTools.title"],
    [{ text: "Browser tools" }],
    ["settings.host.orchestration.systemPrompt.title"],
    ["settings.host.agents.chatTitles.title"],
    ["settings.host.agents.resumeOnStartup.title", "settings.host.agents.resumeOnStartup.info"],
    [
      "settings.host.agents.idleRuntimeCleanup.title",
      "settings.host.agents.idleRuntimeCleanup.info",
    ],
    ["settings.host.planApprovalMode.title"],
    ["settings.host.skills.sectionTitle"],
    ["settings.host.agentProfiles.sectionTitle"],
  ]),
  ...host("metadata", [
    ["settings.metadataGeneration.title"],
    ["settings.metadataGeneration.selection"],
    ["settings.metadataGeneration.model"],
  ]),
  ...host("voice", [
    ["settings.voice.dictation.title"],
    ["settings.voice.voiceMode.title", "settings.voice.voiceMode.info"],
  ]),
  ...host("workspaces", [
    [
      { text: "Archive merged PR workspaces" },
      { text: "Automatically archive clean Paseo workspaces after their pull request is merged" },
    ],
    ["settings.host.workspaces.snoozedPermission.title"],
  ]),
  ...host("providers", [["settings.providers.addProvider"]]),
  ...host("terminals", [
    ["settings.host.terminalProfiles.sectionTitle"],
    [{ text: "Enable terminal agent hooks" }],
  ]),
  ...host("plugins", [["settings.plugins.globalTitle"], ["settings.plugins.sourceLabel"]]),
];
