import { describe, expect, test } from "vitest";

import { BROWSER_AUTOMATION_COMMAND_NAMES } from "./browser-automation/rpc-schemas.js";
import { CLIENT_CAPS } from "./client-capabilities.js";
import {
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "./messages.js";

describe("browser automation protocol integration", () => {
  const browserId = "11111111-1111-4111-8111-111111111111";

  test("browser host capability parses supported commands in hello", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
            hostKind: "desktop app",
          },
        },
      }).capabilities,
    ).toMatchObject({
      [CLIENT_CAPS.browserHost]: {
        supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
        hostKind: "desktop app",
      },
    });
  });

  test("browser host capability requires at least one supported command", () => {
    expect(() =>
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: [],
            hostKind: "desktop app",
          },
        },
      }),
    ).toThrow();

    expect(() =>
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-2",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {},
        },
      }),
    ).toThrow();

    expect(() =>
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-3",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: ["future_command"],
          },
        },
      }),
    ).toThrow();
  });

  test("browser host capability ignores unknown future commands when known commands remain", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: ["list_tabs", "future_command", "list_tabs"],
            hostKind: "desktop app",
          },
        },
      }).capabilities,
    ).toMatchObject({
      [CLIENT_CAPS.browserHost]: {
        supportedCommands: ["list_tabs"],
        hostKind: "desktop app",
      },
    });
  });

  test("browser host capability accepts new tool commands as supported commands", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: ["evaluate", "scroll", "resize", "close_tab"],
            hostKind: "desktop app",
          },
        },
      }).capabilities,
    ).toMatchObject({
      [CLIENT_CAPS.browserHost]: {
        supportedCommands: ["evaluate", "scroll", "resize", "close_tab"],
        hostKind: "desktop app",
      },
    });
  });

  test("hello remains valid when no browser host capability is advertised", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "old-client",
        clientType: "mobile",
        protocolVersion: 1,
      }).capabilities,
    ).toBeUndefined();
  });

  test("daemon to browser host execute request is an outbound session message", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "browser.automation.execute.request",
      requestId: "req-1",
      command: { command: "snapshot", args: { browserId } },
    });

    expect(parsed.type).toBe("browser.automation.execute.request");
  });

  test("browser host to daemon execute response is an inbound session message", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "browser.automation.execute.response",
      payload: {
        requestId: "req-1",
        ok: true,
        result: { command: "list_tabs", tabs: [] },
      },
    });

    expect(parsed.type).toBe("browser.automation.execute.response");
  });

  test("browser live view requests from the app are inbound session messages", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "browser.live.start.request",
        requestId: "req-1",
        browserId,
        maxFps: 5,
        jpegQuality: 60,
        maxWidth: 1080,
      }),
    ).toMatchObject({ type: "browser.live.start.request", browserId, maxWidth: 1080 });
    expect(
      SessionInboundMessageSchema.parse({
        type: "browser.live.stop.request",
        requestId: "req-2",
        streamId: "stream-1",
      }).type,
    ).toBe("browser.live.stop.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "browser.live.frame_ack",
        streamId: "stream-1",
        frameSeq: 4,
      }).type,
    ).toBe("browser.live.frame_ack");
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "browser.live.start.request",
        requestId: "req-3",
        browserId,
        jpegQuality: 101,
      }),
    ).toThrow();
  });

  test("browser live view responses and end notices are outbound session messages", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "browser.live.start.response",
        payload: {
          requestId: "req-1",
          streamId: "stream-1",
          viewport: { width: 1280, height: 720 },
          error: null,
        },
      }).type,
    ).toBe("browser.live.start.response");
    expect(
      SessionOutboundMessageSchema.parse({
        type: "browser.live.start.response",
        payload: {
          requestId: "req-1",
          streamId: null,
          viewport: null,
          error: { code: "browser_unsupported", message: "Update Paseo desktop." },
        },
      }),
    ).toMatchObject({ payload: { error: { retryable: false } } });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "browser.live.ended",
        payload: {
          streamId: "stream-1",
          subscriptionId: "sub-1",
          error: { code: "browser_no_host", message: "Host disconnected.", retryable: true },
        },
      }).type,
    ).toBe("browser.live.ended");
  });

  test("daemon and desktop host exchange browser.host.live messages", () => {
    for (const message of [
      {
        type: "browser.host.live.start.request",
        subscriptionId: "sub-1",
        requestId: "req-1",
        streamId: "stream-1",
        browserId,
        maxFps: 5,
      },
      { type: "browser.host.live.stop.request", requestId: "req-2", streamId: "stream-1" },
      { type: "browser.host.live.frame_ack", streamId: "stream-1", frameSeq: 0 },
    ]) {
      expect(SessionOutboundMessageSchema.parse(message).type).toBe(message.type);
    }
    expect(
      SessionInboundMessageSchema.parse({
        type: "browser.host.live.start.response",
        payload: { requestId: "req-1", viewport: { width: 800, height: 600 }, error: null },
      }).type,
    ).toBe("browser.host.live.start.response");
    expect(
      SessionInboundMessageSchema.parse({
        type: "browser.host.live.stop.response",
        payload: { requestId: "req-2", error: null },
      }).type,
    ).toBe("browser.host.live.stop.response");
  });

  test("browser host registration accepts an optional liveView flag", () => {
    const registration = {
      type: "browser.host.register.request",
      requestId: "req-1",
      hostKind: "desktop app",
      supportedCommands: ["list_tabs"],
    };
    expect(SessionInboundMessageSchema.parse(registration)).not.toHaveProperty("liveView");
    expect(SessionInboundMessageSchema.parse({ ...registration, liveView: true })).toMatchObject({
      liveView: true,
    });
  });

  test("mutable daemon config defaults browser tools off and accepts opt-in patches", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: false },
      }).browserTools,
    ).toEqual({ enabled: false });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        browserTools: { enabled: true },
      }).browserTools,
    ).toEqual({ enabled: true });
  });
});
