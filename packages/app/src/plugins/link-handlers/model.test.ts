import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, PluginLinkHandlerContribution } from "../types";
import { matchPluginLinkHandler } from "./model";

const PR = "https://github.com/o/r/pull/12";

function handler(
  id: string,
  match: PluginLinkHandlerContribution["match"],
): PluginLinkHandlerContribution {
  return { id, title: id, match, open() {} };
}

function plugin(
  id: string,
  serverId: string,
  linkHandlers: PluginLinkHandlerContribution[],
): InstalledPlugin {
  return { id, serverId, linkHandlers } as unknown as InstalledPlugin;
}

function matched(plugins: InstalledPlugin[], serverId: string | null, url: string) {
  const match = matchPluginLinkHandler(plugins, serverId, url);
  return match ? `${match.plugin.serverId}/${match.plugin.id}/${match.handler.id}` : null;
}

describe("matchPluginLinkHandler", () => {
  const isPr = (url: string) => url.includes("/pull/");

  it("returns the first handler that claims the url", () => {
    const plugins = [
      plugin("other", "host", [handler("issues", (url) => url.includes("/issues/"))]),
      plugin("inbox", "host", [handler("pr", isPr)]),
    ];
    expect(matched(plugins, "host", PR)).toBe("host/inbox/pr");
    expect(matched(plugins, "host", "https://example.com")).toBeNull();
  });

  it("prefers plugins on the host that shows the link", () => {
    const plugins = [
      plugin("inbox", "laptop", [handler("pr", isPr)]),
      plugin("inbox", "desktop", [handler("pr", isPr)]),
    ];
    expect(matched(plugins, "desktop", PR)).toBe("desktop/inbox/pr");
    expect(matched(plugins, null, PR)).toBe("laptop/inbox/pr");
  });

  it("only offers http links and skips handlers that throw", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugins = [
      plugin("broken", "host", [
        handler("throws", () => {
          throw new Error("boom");
        }),
      ]),
      plugin("all", "host", [handler("any", () => true)]),
    ];
    expect(matched(plugins, "host", PR)).toBe("host/all/any");
    expect(matched(plugins, "host", "paseo://workspace/1")).toBeNull();
    expect(matched(plugins, "host", "src/index.ts")).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
