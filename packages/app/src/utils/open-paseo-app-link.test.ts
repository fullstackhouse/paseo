import { describe, expect, it } from "vitest";
import type { PaseoAppLink } from "@/utils/paseo-app-link";
import { openLinkWith, type LinkOpeners } from "./open-paseo-app-link";

function recordingOpeners(): LinkOpeners & { appLinks: PaseoAppLink[]; externalUrls: string[] } {
  const appLinks: PaseoAppLink[] = [];
  const externalUrls: string[] = [];
  return {
    appLinks,
    externalUrls,
    openAppLink: (link) => {
      appLinks.push(link);
    },
    openExternal: async (url) => {
      externalUrls.push(url);
    },
  };
}

describe("openLinkWith", () => {
  it("opens a paseo agent link in the app", async () => {
    const openers = recordingOpeners();
    await openLinkWith("paseo://h/srv_1/agent/agent-1", openers);
    expect(openers.appLinks).toEqual([{ kind: "agent", serverId: "srv_1", agentId: "agent-1" }]);
    expect(openers.externalUrls).toEqual([]);
  });

  it("opens a paseo workspace link in the app", async () => {
    const openers = recordingOpeners();
    await openLinkWith("paseo://h/srv_1/workspace/wks_1", openers);
    expect(openers.appLinks).toEqual([
      { kind: "workspace", serverId: "srv_1", workspaceId: "wks_1" },
    ]);
    expect(openers.externalUrls).toEqual([]);
  });

  it("hands other links to the external opener", async () => {
    const openers = recordingOpeners();
    await openLinkWith("https://github.com/org/repo/pull/1", openers);
    expect(openers.externalUrls).toEqual(["https://github.com/org/repo/pull/1"]);
    expect(openers.appLinks).toEqual([]);
  });

  it("does not open a paseo:// link to anything but a workspace or agent in the app", async () => {
    const openers = recordingOpeners();
    await openLinkWith("paseo://h/srv_1/settings/general", openers);
    expect(openers.appLinks).toEqual([]);
    expect(openers.externalUrls).toEqual(["paseo://h/srv_1/settings/general"]);
  });
});
