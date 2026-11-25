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

export interface AppUpdateCheckCommandCenterSource {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  isInstalling: boolean;
  labels: { section: string; title: string };
  icon?: CommandCenterIcon;
  check(): Promise<void>;
}

const HIDES_APP_UPDATE_CHECK: ReadonlySet<DesktopAppUpdateStatus> = new Set([
  "available",
  "checking",
  "installing",
  // An FSH install reports "installed" while its script still downloads; a check then finds
  // the same release and offers a second install. If that script fails, the entry stays hidden
  // until the next background check; Settings → App updates still works.
  "installed",
]);

// Takes Update Paseo's slot: hidden while that entry is listed or a check or install is running.
export function buildAppUpdateCheckContribution(
  source: AppUpdateCheckCommandCenterSource,
): CommandCenterContribution | null {
  if (!source.isDesktopApp || source.isInstalling) return null;
  if (HIDES_APP_UPDATE_CHECK.has(source.status)) return null;
  return {
    id: "check-paseo-updates",
    group: "actions",
    groupRank: 0,
    rank: 9,
    keywords: ["update", "upgrade", "check", "version", "paseo", "app"],
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

export interface TestBuildCommandCenterSource {
  isDesktopApp: boolean;
  isInstalling: boolean;
  installedTag: string | null;
  onTestBuild: boolean;
  builds: readonly { tag: string; label: string }[];
  labels: { section: string; installTestBuild: string; backToStable: string };
  icon?: CommandCenterIcon;
  install(tag: string): void;
  backToStable(): void;
}

// FSH fork: "Install test build › <build>" rows, a picker that opens as you type, and Back to
// stable build while a test build runs. The installed build is listed as selected.
export function buildTestBuildContributions(
  source: TestBuildCommandCenterSource,
): CommandCenterContribution[] {
  if (!source.isDesktopApp || source.isInstalling) return [];
  const contributions: CommandCenterContribution[] = source.builds.map((build, rank) => {
    const selected = build.tag === source.installedTag;
    return {
      id: `install-test-build:${build.tag}`,
      group: "install-test-build",
      groupRank: 1,
      rank,
      keywords: ["test", "build", "install", "prerelease", "paseo", build.tag],
      visibility: "query",
      run: () => {
        if (!selected) source.install(build.tag);
      },
      presentation: {
        kind: "choice",
        path: [source.labels.installTestBuild, build.label],
        icon: source.icon,
        selected,
      },
    };
  });
  if (source.onTestBuild) {
    contributions.push({
      id: "back-to-stable-build",
      group: "actions",
      groupRank: 0,
      rank: 9,
      keywords: ["stable", "test", "build", "update", "release", "paseo"],
      visibility: "query",
      run: source.backToStable,
      presentation: {
        kind: "action",
        title: source.labels.backToStable,
        sectionTitle: source.labels.section,
        icon: source.icon,
      },
    });
  }
  return contributions;
}
