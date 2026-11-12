// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import { resolveRecentProjectChoices, useNewWorkspaceProjectPicker } from "./project-picker";

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

describe("resolveRecentProjectChoices", () => {
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
  const setup = {
    provider: "claude",
    modelId: "opus",
    modeId: "auto",
    thinkingOptionId: "high",
    featureValues: {},
  };
  const recent = (projectId: string, lastUsedAt = 1, agentSetup: typeof setup | null = null) => ({
    projectId,
    lastUsedAt,
    agentSetup,
  });

  it("keeps recency order and each project's setup, skips projects the picker doesn't offer, and caps the list", () => {
    expect(
      resolveRecentProjectChoices({
        projects: [alpha, beta, gamma],
        recentProjects: [
          recent("p-gamma", 3, setup),
          recent("p-hidden"),
          recent("p-alpha", 2),
          recent("p-beta"),
        ],
        serverId: "host",
        limit: 2,
      }),
    ).toEqual([
      { optionId: "project:gamma", project: gamma, lastUsedAt: 3, agentSetup: setup },
      { optionId: "project:alpha", project: alpha, lastUsedAt: 2, agentSetup: null },
    ]);
  });

  it("offers nothing when only one project is recent", () => {
    expect(
      resolveRecentProjectChoices({
        projects: [alpha, beta],
        recentProjects: [recent("p-alpha")],
        serverId: "host",
      }),
    ).toEqual([]);
  });

  it("ignores projects that live on another host", () => {
    expect(
      resolveRecentProjectChoices({
        projects: [alpha, beta],
        recentProjects: [recent("p-alpha"), recent("p-beta")],
        serverId: "other-host",
      }),
    ).toEqual([]);
  });
});
