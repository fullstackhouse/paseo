import { describe, expect, it } from "vitest";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterIconProps } from "./contributions";
import {
  buildAppUpdateCheckContribution,
  buildGroupingContribution,
  buildPluginUpdateCheckContribution,
  buildTestBuildContributions,
  buildUpdateContribution,
  type AppUpdateCheckCommandCenterSource,
  type TestBuildCommandCenterSource,
  type GroupingCommandCenterSource,
  type PluginUpdateCheckCommandCenterSource,
  type UpdateCommandCenterSource,
} from "./root-contributions";

function ProjectIcon(_props: CommandCenterIconProps) {
  return null;
}

function StatusIcon(_props: CommandCenterIconProps) {
  return null;
}

function source(groupMode: SidebarGroupMode): {
  value: GroupingCommandCenterSource;
  applied: SidebarGroupMode[];
} {
  const applied: SidebarGroupMode[] = [];
  return {
    value: {
      groupMode,
      labels: {
        section: "Actions",
        groupByProject: "Group by project",
        groupByStatus: "Group by status",
      },
      icons: { project: ProjectIcon, status: StatusIcon },
      setGroupMode: (mode) => applied.push(mode),
    },
    applied,
  };
}

describe("grouping command center contribution", () => {
  it("offers status while grouped by project", () => {
    const fixture = source("project");
    const contribution = buildGroupingContribution(fixture.value);

    expect(contribution.presentation).toMatchObject({
      title: "Group by status",
      icon: StatusIcon,
    });

    contribution.run();
    expect(fixture.applied).toEqual(["status"]);
  });

  it("offers project while grouped by status", () => {
    const fixture = source("status");
    const contribution = buildGroupingContribution(fixture.value);

    expect(contribution.presentation).toMatchObject({
      title: "Group by project",
      icon: ProjectIcon,
    });

    contribution.run();
    expect(fixture.applied).toEqual(["project"]);
  });

  it("keeps a stable id across both modes so the registry tiebreak never moves", () => {
    expect(buildGroupingContribution(source("project").value).id).toBe(
      buildGroupingContribution(source("status").value).id,
    );
  });

  it("stays out of the default empty-query list", () => {
    for (const mode of ["project", "status"] as const) {
      const contribution = buildGroupingContribution(source(mode).value);
      expect(contribution.visibility).toBe("query");
      expect(contribution.group).toBe("actions");
      // 6 is keyboard-shortcuts and 7 belongs to the workspace actions in #3013.
      expect(contribution.rank).toBe(8);
    }
  });
});

describe("update command center contribution", () => {
  function update(overrides: Partial<UpdateCommandCenterSource> = {}) {
    let installs = 0;
    const value: UpdateCommandCenterSource = {
      isDesktopApp: true,
      status: "available",
      isInstalling: false,
      versionLabel: "v1.2.3",
      labels: { section: "Actions", title: "Update Paseo" },
      install: () => {
        installs += 1;
      },
      ...overrides,
    };
    return { value, installs: () => installs };
  }

  it("installs the ready update", () => {
    const fixture = update();
    const contribution = buildUpdateContribution(fixture.value);

    expect(contribution?.presentation).toMatchObject({
      title: "Update Paseo",
      subtitle: "v1.2.3",
    });
    contribution?.run();
    expect(fixture.installs()).toBe(1);
  });

  it("is absent when no update is ready to install", () => {
    expect(buildUpdateContribution(update({ status: "up-to-date" }).value)).toBeNull();
    expect(buildUpdateContribution(update({ isInstalling: true }).value)).toBeNull();
    expect(buildUpdateContribution(update({ isDesktopApp: false }).value)).toBeNull();
  });
});

describe("app update check command center contribution", () => {
  function check(overrides: Partial<AppUpdateCheckCommandCenterSource> = {}) {
    let checks = 0;
    const value: AppUpdateCheckCommandCenterSource = {
      isDesktopApp: true,
      status: "up-to-date",
      isInstalling: false,
      labels: { section: "Actions", title: "Check for Paseo updates" },
      check: async () => {
        checks += 1;
      },
      ...overrides,
    };
    return { value, checks: () => checks };
  }

  it("runs the check from the query results", () => {
    const fixture = check();
    const contribution = buildAppUpdateCheckContribution(fixture.value);

    expect(contribution).toMatchObject({
      visibility: "query",
      presentation: { title: "Check for Paseo updates" },
    });
    contribution?.run();
    expect(fixture.checks()).toBe(1);
  });

  it("is listed before any check and after a finished, failed or pending one", () => {
    for (const status of ["idle", "up-to-date", "pending", "error"] as const) {
      expect(buildAppUpdateCheckContribution(check({ status }).value)).not.toBeNull();
    }
  });

  it("gives way to Update Paseo and to a running check or install", () => {
    for (const status of ["available", "checking", "installing", "installed"] as const) {
      expect(buildAppUpdateCheckContribution(check({ status }).value)).toBeNull();
    }
    expect(buildAppUpdateCheckContribution(check({ isInstalling: true }).value)).toBeNull();
  });

  it("is absent outside the desktop app", () => {
    expect(buildAppUpdateCheckContribution(check({ isDesktopApp: false }).value)).toBeNull();
  });
});

describe("plugin update check command center contribution", () => {
  function check(available: boolean) {
    let checks = 0;
    const value: PluginUpdateCheckCommandCenterSource = {
      available,
      labels: { section: "Actions", title: "Check for plugin updates" },
      check: async () => {
        checks += 1;
      },
    };
    return { value, checks: () => checks };
  }

  it("runs the check from the query results", () => {
    const fixture = check(true);
    const contribution = buildPluginUpdateCheckContribution(fixture.value);

    expect(contribution).toMatchObject({
      visibility: "query",
      presentation: { title: "Check for plugin updates" },
    });
    expect(contribution?.keywords).toContain("plugin");
    contribution?.run();
    expect(fixture.checks()).toBe(1);
  });

  it("is absent when no connected host can update plugins", () => {
    expect(buildPluginUpdateCheckContribution(check(false).value)).toBeNull();
  });
});

describe("test build command center contributions", () => {
  function testBuildSource(overrides: Partial<TestBuildCommandCenterSource> = {}) {
    const installed: string[] = [];
    let wentBack = 0;
    const value: TestBuildCommandCenterSource = {
      isDesktopApp: true,
      isInstalling: false,
      installedTag: "fsh-0.17.1-abc1234",
      onTestBuild: false,
      builds: [
        { tag: "fsh-pr12-def5678", label: "PR #12 · feat/thing · def5678" },
        { tag: "fsh-test-4d2a5d0", label: "fsh-rebase-v0.17.1 · 4d2a5d0" },
      ],
      labels: {
        section: "Actions",
        installTestBuild: "Install test build",
        backToStable: "Back to stable build",
      },
      install: (tag) => installed.push(tag),
      backToStable: () => {
        wentBack += 1;
      },
      ...overrides,
    };
    return { value, installed, wentBack: () => wentBack };
  }

  it("lists each test build under Install test build, without Back to stable", () => {
    const fixture = testBuildSource();
    const contributions = buildTestBuildContributions(fixture.value);

    expect(contributions.map((entry) => entry.presentation)).toMatchObject([
      { kind: "choice", path: ["Install test build", "PR #12 · feat/thing · def5678"] },
      { kind: "choice", path: ["Install test build", "fsh-rebase-v0.17.1 · 4d2a5d0"] },
    ]);
    void contributions[1]?.run();
    expect(fixture.installed).toEqual(["fsh-test-4d2a5d0"]);
  });

  it("marks the installed test build and offers Back to stable build", () => {
    const fixture = testBuildSource({ installedTag: "fsh-pr12-def5678", onTestBuild: true });
    const contributions = buildTestBuildContributions(fixture.value);

    expect(contributions[0]?.presentation).toMatchObject({ selected: true });
    void contributions[0]?.run();
    expect(fixture.installed).toEqual([]);

    const back = contributions.find((entry) => entry.id === "back-to-stable-build");
    expect(back?.presentation).toMatchObject({ kind: "action", title: "Back to stable build" });
    void back?.run();
    expect(fixture.wentBack()).toBe(1);
  });

  it("lists nothing outside the desktop app or while installing", () => {
    expect(buildTestBuildContributions(testBuildSource({ isDesktopApp: false }).value)).toEqual([]);
    expect(buildTestBuildContributions(testBuildSource({ isInstalling: true }).value)).toEqual([]);
  });
});
