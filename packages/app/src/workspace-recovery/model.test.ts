import { describe, expect, it } from "vitest";
import { resolveWorkspaceRecoveryModel } from "./model";

type ModelInput = Parameters<typeof resolveWorkspaceRecoveryModel>[0];

function resolve(overrides: Partial<ModelInput>) {
  return resolveWorkspaceRecoveryModel({
    enabled: true,
    connected: true,
    hasClient: true,
    hasServerInfo: true,
    supportsRecovery: true,
    inspection: { pending: false, error: null, data: undefined },
    restore: { pending: false, error: null },
    recreate: { pending: false, error: null },
    ...overrides,
  });
}

const unavailable = {
  kind: "unavailable" as const,
  workspaceId: "workspace-1",
  reason: "workspace_directory_missing",
  message: "The archived workspace folder no longer exists, and git can't restore it.",
};

describe("resolveWorkspaceRecoveryModel", () => {
  it("keeps newer recovery actions visible but non-actionable", () => {
    expect(
      resolve({
        inspection: {
          pending: false,
          error: null,
          data: {
            kind: "recoverable",
            workspaceId: "workspace-1",
            workspaceName: "Feature branch",
            action: "repair_from_snapshot",
            branch: "feature",
          },
        },
      }),
    ).toEqual({
      kind: "unsupportedAction",
      action: "repair_from_snapshot",
    });
  });

  it("offers an empty folder only when the host says it can make one", () => {
    expect(
      resolve({ inspection: { pending: false, error: null, data: unavailable } }),
    ).toMatchObject({ kind: "unavailable", recreate: null });
    expect(
      resolve({
        inspection: { pending: false, error: null, data: { ...unavailable, canRecreate: false } },
      }),
    ).toMatchObject({ kind: "unavailable", recreate: null });
    expect(
      resolve({
        inspection: { pending: false, error: null, data: { ...unavailable, canRecreate: true } },
      }),
    ).toMatchObject({ kind: "unavailable", recreate: { phase: "ready", error: null } });
  });

  it("tracks the recreate request on the unavailable state", () => {
    const data = { ...unavailable, canRecreate: true };
    expect(
      resolve({
        inspection: { pending: false, error: null, data },
        recreate: { pending: true, error: null },
      }),
    ).toMatchObject({ recreate: { phase: "restoring", error: null } });
    expect(
      resolve({
        inspection: { pending: false, error: null, data },
        recreate: { pending: false, error: "Permission denied" },
      }),
    ).toMatchObject({ recreate: { phase: "failed", error: "Permission denied" } });
  });
});
