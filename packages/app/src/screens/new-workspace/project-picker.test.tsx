// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import { resolveRecentProjectOptionIds, useNewWorkspaceProjectPicker } from "./project-picker";

function project(input: {
  viewKey: string;
  projectKey: string | null;
  projectId: string;
  projectName: string;
}): HostProjectListItem {
  return {
    ...input,
    projectKind: "git",
    iconWorkingDir: `/work/${input.projectId}`,
    hosts: [
      {
        serverId: "host",
        projectId: input.projectId,
        iconWorkingDir: `/work/${input.projectId}`,
        worktreeSupport: "supported",
      },
    ],
    workspaceKeys: [],
  };
}

describe("useNewWorkspaceProjectPicker", () => {
  it("preserves a manual choice when the routed project hydrates", () => {
    const routePlacement = project({
      viewKey: '["host","route-local"]',
      projectKey: null,
      projectId: "route-local",
      projectName: "Route project",
    });
    const hydratedRouteProject = project({
      viewKey: "remote:github.com/acme/route",
      projectKey: "remote:github.com/acme/route",
      projectId: "route-local",
      projectName: "Route project",
    });
    const manualProject = project({
      viewKey: "remote:github.com/acme/manual",
      projectKey: "remote:github.com/acme/manual",
      projectId: "manual-local",
      projectName: "Manual project",
    });
    const { result, rerender } = renderHook(
      ({ routeProject, projects }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject,
          routeProjectContextViewKey: routePlacement.viewKey,
          lastActiveProject: null,
          allowAllProjects: true,
        }),
      {
        initialProps: {
          routeProject: routePlacement,
          projects: [routePlacement, manualProject],
        },
      },
    );

    const manualOption = result.current.projectPickerOptions.find(
      (option) => option.label === manualProject.projectName,
    );
    expect(manualOption).toBeDefined();
    act(() => result.current.handleSelectProjectOption(manualOption!.id));
    expect(result.current.selectedProject).toEqual(manualProject);

    rerender({
      routeProject: hydratedRouteProject,
      projects: [hydratedRouteProject, manualProject],
    });

    expect(result.current.selectedProject).toEqual(manualProject);
  });
});

describe("resolveRecentProjectOptionIds", () => {
  const alpha = project({
    viewKey: "alpha",
    projectKey: "alpha",
    projectId: "p-alpha",
    projectName: "Alpha",
  });
  const beta = project({
    viewKey: "beta",
    projectKey: "beta",
    projectId: "p-beta",
    projectName: "Beta",
  });
  const gamma = project({
    viewKey: "gamma",
    projectKey: "gamma",
    projectId: "p-gamma",
    projectName: "Gamma",
  });

  it("keeps recency order, skips projects the picker doesn't offer, and caps the list", () => {
    expect(
      resolveRecentProjectOptionIds({
        projects: [alpha, beta, gamma],
        recentProjectIds: ["p-gamma", "p-hidden", "p-alpha", "p-beta"],
        serverId: "host",
        limit: 2,
      }),
    ).toEqual(["project:gamma", "project:alpha"]);
  });

  it("offers nothing when only one project is recent", () => {
    expect(
      resolveRecentProjectOptionIds({
        projects: [alpha, beta],
        recentProjectIds: ["p-alpha"],
        serverId: "host",
      }),
    ).toEqual([]);
  });

  it("ignores projects that live on another host", () => {
    expect(
      resolveRecentProjectOptionIds({
        projects: [alpha, beta],
        recentProjectIds: ["p-alpha", "p-beta"],
        serverId: "other-host",
      }),
    ).toEqual([]);
  });
});
