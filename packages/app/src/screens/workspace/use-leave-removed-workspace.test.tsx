/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceRouteState } from "./workspace-route-state";
import { useLeaveRemovedWorkspace } from "./use-leave-removed-workspace";

const replace = vi.fn();
vi.mock("expo-router", () => ({ useRouter: () => ({ replace }) }));

const READY: WorkspaceRouteState = { kind: "ready" };
const MISSING: WorkspaceRouteState = { kind: "missing", hostName: "Laptop" };
const NEW_WORKSPACE_ROUTE =
  "/new?serverId=server-1&dir=%2Frepo%2Fproject&name=Project&projectId=project-1";

function worktree(id: string): WorkspaceDescriptor {
  return {
    createdAt: null,
    lastUserMessageAt: null,
    id,
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo/project",
    workspaceDirectory: `/repo/project/.paseo/worktrees/${id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
    status: "done",
    diffStat: null,
    scripts: [],
    archivingAt: null,
    statusEnteredAt: null,
  };
}

interface Props {
  workspaceId: string;
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
  state: WorkspaceRouteState;
  isRouteFocused: boolean;
}

function render(initialProps: Props) {
  return renderHook(
    (props: Props) => useLeaveRemovedWorkspace({ serverId: "server-1", ...props }),
    {
      initialProps,
    },
  );
}

describe("useLeaveRemovedWorkspace", () => {
  beforeEach(() => replace.mockReset());

  it("opens New workspace once when the workspace it showed from the live list is removed", () => {
    const shown = worktree("feature");
    const hook = render({
      workspaceId: "feature",
      workspace: shown,
      hasHydratedWorkspaces: true,
      state: READY,
      isRouteFocused: true,
    });

    hook.rerender({
      workspaceId: "feature",
      workspace: null,
      hasHydratedWorkspaces: true,
      state: MISSING,
      isRouteFocused: true,
    });
    hook.rerender({
      workspaceId: "feature",
      workspace: null,
      hasHydratedWorkspaces: true,
      state: { ...MISSING },
      isRouteFocused: true,
    });

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(NEW_WORKSPACE_ROUTE);
  });

  it("keeps a workspace seen only in the startup cache on the unavailable screen", () => {
    const hook = render({
      workspaceId: "feature",
      workspace: worktree("feature"),
      hasHydratedWorkspaces: false,
      state: READY,
      isRouteFocused: true,
    });

    hook.rerender({
      workspaceId: "feature",
      workspace: null,
      hasHydratedWorkspaces: true,
      state: MISSING,
      isRouteFocused: true,
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it("does not carry one workspace's descriptor over to the next", () => {
    const hook = render({
      workspaceId: "feature",
      workspace: worktree("feature"),
      hasHydratedWorkspaces: true,
      state: READY,
      isRouteFocused: true,
    });

    hook.rerender({
      workspaceId: "other",
      workspace: null,
      hasHydratedWorkspaces: true,
      state: MISSING,
      isRouteFocused: true,
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it("waits until the route is focused", () => {
    const hook = render({
      workspaceId: "feature",
      workspace: worktree("feature"),
      hasHydratedWorkspaces: true,
      state: READY,
      isRouteFocused: false,
    });

    hook.rerender({
      workspaceId: "feature",
      workspace: null,
      hasHydratedWorkspaces: true,
      state: MISSING,
      isRouteFocused: false,
    });
    expect(replace).not.toHaveBeenCalled();

    hook.rerender({
      workspaceId: "feature",
      workspace: null,
      hasHydratedWorkspaces: true,
      state: MISSING,
      isRouteFocused: true,
    });
    expect(replace).toHaveBeenCalledWith(NEW_WORKSPACE_ROUTE);
  });
});
