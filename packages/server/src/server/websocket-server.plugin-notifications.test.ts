import { createWorkspaceRuntimeStore } from "./workspace-runtime-store/index.js";
import { SessionDelivery } from "./session/owned-subscriptions/index.js";
import { describe, expect, it, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore, MutableDaemonConfig } from "./daemon-config-store.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import type { PushNotificationSender, PushPayload } from "./push/index.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    on() {
      return this;
    }
    close() {}
  }
  return { MockWebSocketServer };
});

vi.mock("ws", () => ({ WebSocketServer: wsModuleMock.MockWebSocketServer }));
vi.mock("./session.js", () => ({
  Session: function Session() {
    return {};
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

class RecordingPushNotificationSender implements PushNotificationSender {
  readonly sent: PushPayload[] = [];
  async send(payload: PushPayload): Promise<void> {
    this.sent.push(payload);
  }
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createServer(config: Partial<MutableDaemonConfig> = {}) {
  const pushNotifications = new RecordingPushNotificationSender();
  const agentManager = {
    setAgentAttentionCallback: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getMetricsSnapshot: vi.fn(() => ({
      total: 0,
      byLifecycle: {},
      withActiveForegroundTurn: 0,
      timelineStats: { totalItems: 0, maxItemsPerAgent: 0 },
    })),
  };
  const daemonConfigStore = {
    get: vi.fn(() => config),
    onApply: vi.fn(() => () => {}),
    onChange: vi.fn(() => () => {}),
  };
  const server = new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({ on: () => undefined }),
    createStub<pino.Logger>(createLogger()),
    "srv-test",
    createStub<AgentManager>(agentManager),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/paseo-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set() },
    createStub<WorkspaceAutoName>({
      scheduleForWorktree: () => {},
      scheduleForDirectory: () => {},
    }),
    createWorkspaceRuntimeStore(),
    undefined,
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    undefined,
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pushNotifications,
    createProviderSnapshotManagerStub().manager,
  );
  return { server, pushNotifications };
}

function connectClient(
  server: VoiceAssistantWebSocketServer,
  options: { subscribed?: boolean; present?: boolean } = {},
) {
  const ws = { readyState: 1, send: vi.fn(), close: vi.fn(), on: vi.fn(), once: vi.fn() };
  const delivery = new SessionDelivery(() => {});
  delivery.attach(ws, false);
  asInternals<{ sessions: Map<unknown, unknown> }>(server).sessions.set(ws, {
    kind: "trusted",
    session: {
      delivery,
      wantsSourceEvent: () => options.subscribed ?? true,
      wantsSourceNotification: () => true,
      getClientActivity: vi.fn(() =>
        options.present
          ? {
              appVisible: true,
              focusedAgentId: null,
              focusedTerminalId: null,
              lastActivityAt: new Date(),
            }
          : null,
      ),
    },
    clientId: "client-test",
    appVersion: null,
    connectionLogger: createLogger(),
    sockets: new Set([ws]),
    externalDisconnectCleanupTimeout: null,
  });
  return ws;
}

function pluginMessages(ws: ReturnType<typeof connectClient>) {
  return ws.send.mock.calls
    .map(([raw]) => JSON.parse(String(raw)))
    .filter((frame) => frame.type === "session" && frame.message.type === "plugin.notification")
    .map((frame) => frame.message.payload);
}

const review = {
  title: "Review ready",
  body: "PR #12",
  open: { screen: "review", params: { runId: "run-1" } },
  key: "run-1",
};

describe("VoiceAssistantWebSocketServer plugin notifications", () => {
  it("pushes with the plugin screen as the tap target when no client is present", () => {
    const { server, pushNotifications } = createServer();
    const ws = connectClient(server);

    expect(server.sendPluginNotification("paseo-inbox", review)).toEqual({ delivered: true });

    const notification = {
      title: "Review ready",
      body: "PR #12",
      data: {
        serverId: "srv-test",
        pluginId: "paseo-inbox",
        screenId: "review",
        params: { runId: "run-1" },
        key: "run-1",
      },
    };
    expect(pushNotifications.sent).toEqual([notification]);
    expect(pluginMessages(ws)).toEqual([
      expect.objectContaining({ pluginId: "paseo-inbox", shouldNotify: false, notification }),
    ]);
  });

  it("shows it in the present client instead of pushing", () => {
    const { server, pushNotifications } = createServer();
    const ws = connectClient(server, { present: true });
    const unsubscribed = connectClient(server, { present: true, subscribed: false });

    server.sendPluginNotification("paseo-inbox", review);

    expect(pushNotifications.sent).toEqual([]);
    expect(pluginMessages(ws)).toEqual([expect.objectContaining({ shouldNotify: true })]);
    expect(pluginMessages(unsubscribed)).toEqual([]);
  });

  it("drops a plugin's notifications when the host muted it", () => {
    const { server, pushNotifications } = createServer({
      pluginNotifications: { "paseo-inbox": false, other: true },
    });
    const ws = connectClient(server);

    expect(server.sendPluginNotification("paseo-inbox", review)).toEqual({
      delivered: false,
      dropped: "muted",
    });
    expect(server.sendPluginNotification("other", review)).toEqual({ delivered: true });
    expect(pushNotifications.sent.map((sent) => sent.data?.["pluginId"])).toEqual(["other"]);
    expect(pluginMessages(ws).map((payload) => payload.pluginId)).toEqual(["other"]);
  });

  it("drops a duplicate key and rejects invalid input", () => {
    const { server, pushNotifications } = createServer();

    server.sendPluginNotification("paseo-inbox", review);
    expect(server.sendPluginNotification("paseo-inbox", review)).toEqual({
      delivered: false,
      dropped: "duplicate",
    });
    expect(() => server.sendPluginNotification("paseo-inbox", { title: "", body: "" })).toThrow(
      "title is empty",
    );
    expect(pushNotifications.sent).toHaveLength(1);
  });
});
