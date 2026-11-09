import { describe, expect, it } from "vitest";
import { createPluginHostNavigation } from "./host-navigation-model";
import type { InstalledPlugin } from "./types";

describe("plugin host navigation", () => {
  function setup(electron = true) {
    const destinations: unknown[] = [];
    const browsers: string[] = [];
    const workspaces = new Set(["selected:one", "remote:two"]);
    const screens: unknown[] = [];
    const plugins = [
      { serverId: "selected", id: "inbox", surfaces: [{ id: "review" }] },
      { serverId: "remote", id: "inbox", surfaces: [{ id: "review" }] },
    ] as unknown as InstalledPlugin[];
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: electron,
      resolveWorkspace: ({ serverId, workspaceId }) =>
        workspaces.has(`${serverId}:${workspaceId}`) ? workspaceId : null,
      openAgent: (input) => destinations.push(input),
      openWorkspace: (input) => destinations.push(input),
      findPlugin: ({ serverId, pluginId }) =>
        plugins.find((plugin) => plugin.serverId === serverId && plugin.id === pluginId) ?? null,
      openScreen: (input) => screens.push(input),
      createBrowser: ({ initialUrl }) => {
        browsers.push(initialUrl);
        return { browserId: `browser-${browsers.length}` };
      },
    });
    return { navigation, destinations, browsers, workspaces, screens };
  }

  it("opens another plugin's screen on the selected or explicit host", () => {
    const { navigation, screens } = setup();
    navigation.openPluginScreen!({
      pluginId: "inbox",
      screenId: "review",
      params: { repo: "acme/shop", number: "12" },
    });
    navigation.openPluginScreen!({ pluginId: "inbox", screenId: "review", serverId: "remote" });
    expect(screens).toEqual([
      {
        serverId: "selected",
        pluginId: "inbox",
        screenId: "review",
        params: { repo: "acme/shop", number: "12" },
      },
      { serverId: "remote", pluginId: "inbox", screenId: "review", params: {} },
    ]);
  });

  it("reports and refuses screens that are not on the host", () => {
    const { navigation, screens } = setup();
    expect(navigation.hasPluginScreen!({ pluginId: "inbox", screenId: "review" })).toBe(true);
    for (const target of [
      { pluginId: "missing", screenId: "review" },
      { pluginId: "inbox", screenId: "missing" },
      { pluginId: "inbox", screenId: "review", serverId: "unknown" },
    ]) {
      expect(navigation.hasPluginScreen!(target)).toBe(false);
      expect(() => navigation.openPluginScreen!(target)).toThrow("Plugin screen is unavailable");
    }
    expect(() =>
      navigation.openPluginScreen!({
        pluginId: "inbox",
        screenId: "review",
        params: { number: 12 } as unknown as Record<string, string>,
      }),
    ).toThrow("must be a string");
    expect(screens).toEqual([]);
  });

  it("creates and focuses a local browser in the selected or explicit host workspace", () => {
    const { navigation, destinations, browsers } = setup();
    navigation.openBrowser!({ url: "https://example.com/one", workspaceId: "one" });
    navigation.openBrowser!({
      url: "https://example.com/two",
      workspaceId: "two",
      serverId: "remote",
    });
    expect(browsers).toEqual(["https://example.com/one", "https://example.com/two"]);
    expect(destinations).toEqual([
      {
        serverId: "selected",
        workspaceId: "one",
        target: { kind: "browser", browserId: "browser-1" },
      },
      {
        serverId: "remote",
        workspaceId: "two",
        target: { kind: "browser", browserId: "browser-2" },
      },
    ]);
  });

  it("refuses unknown or removed workspaces before creating browser records", () => {
    const { navigation, destinations, browsers, workspaces } = setup();
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "missing" }),
    ).toThrow("Workspace is unavailable");
    expect(() =>
      navigation.openBrowser!({
        url: "https://example.com",
        workspaceId: "one",
        serverId: "unknown",
      }),
    ).toThrow("Workspace is unavailable");
    workspaces.delete("selected:one");
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "one" }),
    ).toThrow("Workspace is unavailable");
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  it("exposes no browser capability outside Electron and creates no tabs", () => {
    const { navigation, destinations, browsers } = setup(false);
    expect(navigation.openBrowser).toBeUndefined();
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  it.each(["javascript:alert(1)", "file:///tmp/file", "/relative", "invalid"])(
    "rejects %s before creating a browser",
    (url) => {
      const { navigation, browsers, destinations } = setup();
      expect(() => navigation.openBrowser!({ url, workspaceId: "one" })).toThrow("HTTP(S)");
      expect(browsers).toEqual([]);
      expect(destinations).toEqual([]);
    },
  );

  it("rejects an empty workspace before creating a browser", () => {
    const { navigation, browsers } = setup();
    expect(() => navigation.openBrowser!({ url: "https://example.com", workspaceId: "" })).toThrow(
      "workspaceId",
    );
    expect(browsers).toEqual([]);
  });
});
