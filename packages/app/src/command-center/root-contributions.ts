import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { DesktopAppUpdateStatus } from "@/desktop/updates/desktop-app-updater";
import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface GroupingCommandCenterSource {
  groupMode: SidebarGroupMode;
  labels: {
    section: string;
    groupByProject: string;
    groupByStatus: string;
  };
  icons: {
    project?: CommandCenterIcon;
    status?: CommandCenterIcon;
  };
  setGroupMode(mode: SidebarGroupMode): void;
}

// One entry that always names the mode you are not in, so it can never read as a no-op.
export function buildGroupingContribution(
  source: GroupingCommandCenterSource,
): CommandCenterContribution {
  // Collapse into nextGroupMode() from sidebar-view-store once #2504 lands.
  const target: SidebarGroupMode = source.groupMode === "project" ? "status" : "project";
  return {
    id: "sidebar-grouping",
    group: "actions",
    groupRank: 0,
    rank: 8,
    keywords: ["group", "grouping", "sort", "sidebar", "project", "status"],
    visibility: "query",
    run: () => source.setGroupMode(target),
    presentation: {
      kind: "action",
      title: target === "status" ? source.labels.groupByStatus : source.labels.groupByProject,
      sectionTitle: source.labels.section,
      icon: target === "status" ? source.icons.status : source.icons.project,
    },
  };
}

export interface UpdateCommandCenterSource {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  isInstalling: boolean;
  versionLabel: string | null;
  labels: { section: string; title: string };
  icon?: CommandCenterIcon;
  install(): void;
}

// Listed only while an update is ready, so the entry never reads as a no-op.
export function buildUpdateContribution(
  source: UpdateCommandCenterSource,
): CommandCenterContribution | null {
  if (!source.isDesktopApp || source.status !== "available" || source.isInstalling) {
    return null;
  }
  return {
    id: "update-paseo",
    group: "actions",
    groupRank: 0,
    rank: 9,
    keywords: ["update", "upgrade", "install", "restart", "version", "paseo"],
    visibility: "query",
    run: source.install,
    presentation: {
      kind: "action",
      title: source.labels.title,
      subtitle: source.versionLabel ?? undefined,
      sectionTitle: source.labels.section,
      icon: source.icon,
    },
  };
}

export interface PluginUpdateCheckCommandCenterSource {
  /** True when a connected host can apply plugin updates. */
  available: boolean;
  labels: { section: string; title: string };
  icon?: CommandCenterIcon;
  check(): Promise<void>;
}

export function buildPluginUpdateCheckContribution(
  source: PluginUpdateCheckCommandCenterSource,
): CommandCenterContribution | null {
  if (!source.available) return null;
  return {
    id: "check-plugin-updates",
    group: "actions",
    groupRank: 0,
    rank: 10,
    keywords: ["plugin", "plugins", "update", "upgrade", "check"],
    visibility: "query",
    run: () => void source.check(),
    presentation: {
      kind: "action",
      title: source.labels.title,
      sectionTitle: source.labels.section,
      icon: source.icon,
    },
  };
}
