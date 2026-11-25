import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { openExternalUrl } from "@/utils/open-external-url";
import { requestWorkspaceRecoveryFromLink } from "@/workspace-recovery/link-requests";
import { openUrlOrPaseoAppLink } from "./open-paseo-app-link";

vi.mock("@/stores/navigation-active-workspace-store", () => ({ navigateToWorkspace: vi.fn() }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@/workspace-recovery/link-requests", () => ({
  requestWorkspaceRecoveryFromLink: vi.fn(),
}));

describe("openUrlOrPaseoAppLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens a paseo agent link in the app", async () => {
    await openUrlOrPaseoAppLink("paseo://h/srv_1/agent/agent-1");
    expect(navigateToAgent).toHaveBeenCalledWith({ serverId: "srv_1", agentId: "agent-1" });
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("opens a paseo workspace link in the app", async () => {
    await openUrlOrPaseoAppLink("paseo://h/srv_1/workspace/wks_1");
    const link = { kind: "workspace", serverId: "srv_1", workspaceId: "wks_1" };
    expect(requestWorkspaceRecoveryFromLink).toHaveBeenCalledWith(link);
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "srv_1", workspaceId: "wks_1" });
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("hands other links to the OS", async () => {
    await openUrlOrPaseoAppLink("https://github.com/org/repo/pull/1");
    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/org/repo/pull/1");
    expect(navigateToAgent).not.toHaveBeenCalled();
  });
});
