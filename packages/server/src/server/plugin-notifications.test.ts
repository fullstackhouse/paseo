import { describe, expect, it } from "vitest";
import {
  buildPluginNotificationPayload,
  PLUGIN_NOTIFICATION_LIMITS,
  PluginNotificationThrottle,
  validatePluginNotificationInput,
} from "./plugin-notifications.js";

describe("validatePluginNotificationInput", () => {
  it("accepts a screen target with params", () => {
    expect(() =>
      validatePluginNotificationInput({
        title: "Review ready",
        body: "PR #12",
        open: { screen: "review", params: { runId: "run-1" } },
        key: "run-1",
      }),
    ).not.toThrow();
  });

  it.each([
    [{ title: "  ", body: "" }, "title is empty"],
    [{ title: "x".repeat(121), body: "" }, "title is longer than 120"],
    [{ title: "t", body: "x".repeat(501) }, "body is longer than 500"],
    [{ title: "t", body: "", key: "" }, "key is empty"],
    [{ title: "t", body: "", open: { screen: "" } }, "screen is empty"],
    [{ title: "t", body: "", open: { agentId: " " } }, "agentId is empty"],
    [
      { title: "t", body: "", open: { screen: "review", agentId: "a" } },
      "either a screen or an agent",
    ],
    [
      {
        title: "t",
        body: "",
        open: {
          screen: "review",
          params: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])),
        },
      },
      "more than 20 screen params",
    ],
  ])("rejects %j", (input, message) => {
    expect(() =>
      validatePluginNotificationInput(
        input as Parameters<typeof validatePluginNotificationInput>[0],
      ),
    ).toThrow(message);
  });
});

describe("buildPluginNotificationPayload", () => {
  it("names the host, the plugin and the screen to open", () => {
    expect(
      buildPluginNotificationPayload({
        serverId: "host-1",
        pluginId: "paseo-inbox",
        notification: {
          title: " Review ready ",
          body: "PR #12 ",
          open: { screen: "review", params: { runId: "run-1" } },
          key: "run-1",
        },
      }),
    ).toEqual({
      title: "Review ready",
      body: "PR #12",
      data: {
        serverId: "host-1",
        pluginId: "paseo-inbox",
        screenId: "review",
        params: { runId: "run-1" },
        key: "run-1",
      },
    });
  });

  it("opens an agent, or the host when no target is given", () => {
    expect(
      buildPluginNotificationPayload({
        serverId: "host-1",
        pluginId: "p",
        notification: { title: "t", body: "b", open: { agentId: "agent-1" } },
      }).data,
    ).toEqual({ serverId: "host-1", pluginId: "p", agentId: "agent-1" });
    expect(
      buildPluginNotificationPayload({
        serverId: "host-1",
        pluginId: "p",
        notification: { title: "t", body: "b", open: { screen: "s", params: {} } },
      }).data,
    ).toEqual({ serverId: "host-1", pluginId: "p", screenId: "s" });
    expect(
      buildPluginNotificationPayload({
        serverId: "host-1",
        pluginId: "p",
        notification: { title: "t", body: "b" },
      }).data,
    ).toEqual({ serverId: "host-1", pluginId: "p" });
  });
});

describe("PluginNotificationThrottle", () => {
  it("drops a repeated key inside the dedupe window and allows it after", () => {
    const throttle = new PluginNotificationThrottle();
    expect(throttle.admit({ pluginId: "p", key: "run-1", nowMs: 0 })).toEqual({ delivered: true });
    expect(throttle.admit({ pluginId: "p", key: "run-1", nowMs: 59_999 })).toEqual({
      delivered: false,
      dropped: "duplicate",
    });
    expect(throttle.admit({ pluginId: "other", key: "run-1", nowMs: 1 })).toEqual({
      delivered: true,
    });
    expect(
      throttle.admit({
        pluginId: "p",
        key: "run-1",
        nowMs: PLUGIN_NOTIFICATION_LIMITS.dedupeWindowMs,
      }),
    ).toEqual({ delivered: true });
  });

  it("caps each plugin per window without spending budget on duplicates", () => {
    const throttle = new PluginNotificationThrottle();
    for (let i = 0; i < PLUGIN_NOTIFICATION_LIMITS.perPluginPerWindow; i++) {
      expect(throttle.admit({ pluginId: "p", key: `k${i}`, nowMs: i })).toEqual({
        delivered: true,
      });
      expect(throttle.admit({ pluginId: "p", key: `k${i}`, nowMs: i })).toMatchObject({
        dropped: "duplicate",
      });
    }
    expect(throttle.admit({ pluginId: "p", nowMs: 100 })).toEqual({
      delivered: false,
      dropped: "rate_limited",
    });
    expect(throttle.admit({ pluginId: "q", nowMs: 100 })).toEqual({ delivered: true });
    expect(
      throttle.admit({ pluginId: "p", nowMs: PLUGIN_NOTIFICATION_LIMITS.rateWindowMs }),
    ).toEqual({ delivered: true });
  });
});
