import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  MutableDaemonConfigSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  StatusMessageSchema,
} from "./messages.js";

describe("plugin protocol compatibility", () => {
  it("round-trips change request reads", () => {
    const request = {
      type: "forge.change_requests.read.request",
      requestId: "read",
      urls: ["https://github.com/acme/widgets/pull/41", "https://example.com/x"],
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "forge.change_requests.read.response",
      payload: {
        requestId: "read",
        error: null,
        results: [
          {
            url: "https://github.com/acme/widgets/pull/41",
            ok: true,
            number: 41,
            title: "Fix the login redirect",
            state: "open",
            isDraft: false,
            mergeable: "conflicting",
            reviewDecision: null,
            checksState: "pending",
            checks: [{ name: "build", state: "pending" }],
            headSha: "abc",
          },
          { url: "https://example.com/x", ok: false, error: "Unsupported host" },
        ],
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("round-trips pull request subscriptions, updates and usage", () => {
    const subscribe = {
      type: "forge.change_requests.subscribe.request",
      requestId: "sub",
      urls: ["https://github.com/acme/widgets/pull/41"],
      branches: [{ repo: "https://github.com/acme/widgets", headRef: "feat/login" }],
      priority: "visible",
      include: ["deployments"],
    };
    expect(SessionInboundMessageSchema.parse(subscribe)).toEqual(subscribe);
    const result = {
      url: "https://github.com/acme/widgets/pull/41",
      ok: true,
      number: 41,
      title: "Fix the login redirect",
      state: "open",
      isDraft: false,
      reviewDecision: "review_required",
      checksState: "passing",
      checks: [],
      headSha: "abc",
      author: null,
      reviewRequestCount: 1,
      viewerCanMergeAsAdmin: true,
      deployments: [
        {
          environment: "preview",
          state: "SUCCESS",
          createdAt: "2026-11-27T11:00:00Z",
          url: "https://pr-41.example",
        },
      ],
    };
    const branch = {
      repo: "https://github.com/acme/widgets",
      headRef: "feat/login",
      ok: false,
      urls: [],
      error: "Paused",
      reason: "paused",
      retryAt: 1_700_000_000_000,
    };
    for (const message of [
      {
        type: "forge.change_requests.subscribe.response",
        payload: {
          requestId: "sub",
          subscriptionId: "s1",
          results: [result],
          branches: [branch],
          error: null,
        },
      },
      {
        type: "forge.change_requests.update",
        payload: { subscriptionId: "s1", results: [result], branches: [] },
      },
      {
        type: "forge.change_requests.usage.response",
        payload: {
          requestId: "usage",
          error: null,
          usage: {
            since: 1,
            followed: 2,
            callers: [
              {
                caller: "plugin:paseo-prs",
                points: 2.5,
                reads: 3,
                pointsLastHour: 2.5,
                readsLastHour: 3,
                subscriptions: 1,
              },
            ],
          },
        },
      },
    ]) {
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
    const usage = { type: "forge.change_requests.usage.request", requestId: "usage" };
    expect(SessionInboundMessageSchema.parse(usage)).toEqual(usage);
  });

  it("round-trips open pull request lists", () => {
    const request = {
      type: "forge.change_requests.list.request",
      requestId: "list",
      repo: "https://github.com/acme/widgets",
      limit: 20,
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    for (const payload of [
      {
        requestId: "list",
        repo: "https://github.com/acme/widgets",
        ok: true,
        items: [
          {
            url: "https://github.com/acme/widgets/pull/12",
            number: 12,
            title: "Add the login page",
            isDraft: false,
            headRef: "feat/login",
            author: null,
            updatedAt: "2026-11-27T10:00:00Z",
          },
        ],
      },
      {
        requestId: "list",
        repo: "https://github.com/acme/widgets",
        ok: false,
        items: [],
        error: "Paused",
        reason: "paused",
        retryAt: 1_700_000_000_000,
      },
    ]) {
      const response = { type: "forge.change_requests.list.response", payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });

  it.each([undefined, { paseo: ">=0.8.0" }])(
    "parses plugin catalogs with requirements %j",
    (requirements) => {
      const message = {
        type: "plugin.catalog.get.response",
        payload: {
          requestId: "catalog",
          plugins: [
            { id: "example", clientBundle: "bundle", ...(requirements ? { requirements } : {}) },
          ],
        },
      };
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    },
  );
  it.each([
    { type: "plugin.catalog.get.request", requestId: "catalog" },
    {
      type: "plugin.catalog.get.request",
      requestId: "catalog",
      cachedClientBundles: [{ id: "example", clientBundleHash: "a".repeat(64) }],
    },
  ])("parses plugin catalog requests %j", (request) => {
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });
  it("parses plugin catalogs that leave out a client bundle the client already holds", () => {
    const message = {
      type: "plugin.catalog.get.response",
      payload: {
        requestId: "catalog",
        plugins: [
          { id: "cached", clientBundleHash: "a".repeat(64) },
          { id: "changed", clientBundle: "bundle", clientBundleHash: "b".repeat(64) },
        ],
      },
    };
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });
  it("preserves manifest metadata in plugin list responses", () => {
    const message = {
      type: "plugin.list.response",
      payload: {
        requestId: "metadata",
        plugins: [
          {
            id: "review",
            name: "Review tools",
            icon: "assets/icon.png",
            media: ["screenshot.png", "https://example.com/demo.mp4"],
            path: "/plugins/review",
            enabled: false,
            status: "disabled",
          },
        ],
      },
    };
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });

  it("parses plugin timeline append messages and advertises the capability", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.timeline.append.request",
        requestId: "request-append",
        agentId: "agent-1",
        item: {
          type: "plugin",
          id: "review-1",
          kind: "review",
          version: 1,
          data: { status: "running" },
        },
      }),
    ).toMatchObject({ type: "agent.timeline.append.request" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.timeline.append.response",
        payload: { requestId: "request-append", seq: 7, epoch: "epoch-1" },
      }),
    ).toMatchObject({ type: "agent.timeline.append.response" });
    expect(
      StatusMessageSchema.parse({
        type: "status",
        payload: {
          status: "server_info",
          serverId: "server-1",
          features: { pluginTimelineItems: true },
        },
      }).payload,
    ).toMatchObject({ features: { pluginTimelineItems: true } });
  });

  it.each([0, -1, 1.5])("rejects plugin timeline version %s", (version) => {
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "agent.timeline.append.request",
        requestId: "append-1",
        agentId: "agent-1",
        item: { type: "plugin", id: "row-1", kind: "review", version, data: {} },
      }),
    ).toThrow();
  });

  it("keeps old directory plugin config valid when enabled is absent", () => {
    const config = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: true },
      plugins: { example: { source: "directory", path: "/plugins/example" } },
    });

    expect(config.plugins?.example?.enabled).toBeUndefined();
  });

  it("uses namespaced management request and response pairs", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.directory.install.request",
        requestId: "request-1",
        path: "/plugins/example",
        id: "example-work",
      }).type,
    ).toBe("plugin.directory.install.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.directory.inspect.request",
        requestId: "request-0",
        path: "/plugins/example",
      }).type,
    ).toBe("plugin.directory.inspect.request");
    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.directory.install.response",
        payload: {
          requestId: "request-1",
          plugin: {
            id: "example-work",
            description: "Reviews changes before merge",
            path: "/plugins/example",
            enabled: true,
            status: "running",
          },
        },
      }).type,
    ).toBe("plugin.directory.install.response");

    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.directory.install.response",
        payload: {
          requestId: "request-old-shape",
          plugin: {
            id: "example-work",
            path: "/plugins/example",
            enabled: true,
            status: "running",
          },
        },
      }).type,
    ).toBe("plugin.directory.install.response");
  });

  it("uses capability-gated source management RPCs", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.source.install.request",
        requestId: "request-install",
        source: "owner/repository:plugins/review",
        ref: "main",
      }).type,
    ).toBe("plugin.source.install.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.source.install.request",
        requestId: "request-install-old-client",
        source: "owner/repository",
        pluginPath: "plugins/review",
      }).type,
    ).toBe("plugin.source.install.request");
    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.source.status.response",
        payload: {
          requestId: "request-status",
          plugins: [
            {
              id: "review",
              source: "git",
              path: "/plugins/review",
              currentCommit: "a".repeat(40),
              latestCommit: "b".repeat(40),
              commitsBehind: 2,
              updateAvailable: true,
            },
          ],
        },
      }).type,
    ).toBe("plugin.source.status.response");

    const older = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "older-host",
        features: { pluginManagement: true },
      },
    });
    expect(older.payload.features?.pluginGitManagement).toBeUndefined();
  });

  it("uses a namespaced snapshot RPC for structured plugin logs", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "plugin.logs.get.request",
        requestId: "request-logs",
        pluginId: "example",
      }),
    ).toEqual({
      type: "plugin.logs.get.request",
      requestId: "request-logs",
      pluginId: "example",
    });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.logs.get.response",
        payload: {
          requestId: "request-logs",
          pluginId: "example",
          entries: [
            {
              sequence: 7,
              timestamp: "2026-08-16T12:00:00.000Z",
              stream: "stderr",
              message: "failed to connect",
            },
          ],
        },
      }),
    ).toEqual({
      type: "plugin.logs.get.response",
      payload: {
        requestId: "request-logs",
        pluginId: "example",
        entries: [
          {
            sequence: 7,
            timestamp: "2026-08-16T12:00:00.000Z",
            stream: "stderr",
            message: "failed to connect",
          },
        ],
      },
    });
  });

  it("keeps the plugin logs capability optional for older server info", () => {
    const older = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "older-host",
        features: { pluginManagement: true },
      },
    });
    const current = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "current-host",
        features: { pluginManagement: true, pluginLogs: true },
      },
    });

    expect(older.payload.features?.pluginLogs).toBeUndefined();
    expect(current.payload.features?.pluginLogs).toBe(true);
  });

  it("keeps the plugin themes capability optional for older server info", () => {
    const older = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "older-host",
        features: { plugins: true },
      },
    });
    const current = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "current-host",
        features: { plugins: true, pluginThemes: true },
      },
    });

    expect(older.payload.features?.pluginThemes).toBeUndefined();
    expect(current.payload.features?.pluginThemes).toBe(true);
  });

  it("keeps the catalog change notification safe for older clients", () => {
    expect(
      StatusMessageSchema.parse({
        type: "status",
        payload: { status: "plugin_catalog_changed", pluginId: "example" },
      }),
    ).toEqual({
      type: "status",
      payload: { status: "plugin_catalog_changed", pluginId: "example" },
    });
  });

  it("requires plugin action payloads and keeps remove empty", () => {
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "plugin.reload.response",
        payload: { requestId: "request-1" },
      }),
    ).toThrow();
    expect(
      SessionOutboundMessageSchema.parse({
        type: "plugin.remove.response",
        payload: { requestId: "request-2" },
      }),
    ).toEqual({ type: "plugin.remove.response", payload: { requestId: "request-2" } });
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "plugin.remove.response",
        payload: { requestId: "request-2", plugin: { id: "extra" } },
      }),
    ).toThrow();
  });
});

it("npm metadata leaves legacy plugin rows parseable without extending their closed source enum", () => {
  const legacyPlugin = z.object({
    id: z.string(),
    path: z.string(),
    enabled: z.boolean(),
    status: z.enum(["running", "disabled", "failed"]),
    source: z.enum(["directory", "git"]).optional(),
  });
  const plugin = {
    id: "review",
    path: "/plugins/review",
    enabled: true,
    status: "running",
    installation: {
      identity: { kind: "npm", packageName: "@acme/review", pluginPath: "." },
      currentRevision: "1.2.0",
    },
  };
  const message = SessionOutboundMessageSchema.parse({
    type: "plugin.list.response",
    payload: { requestId: "npm", plugins: [plugin] },
  });
  expect(legacyPlugin.parse(plugin)).toEqual({
    id: "review",
    path: "/plugins/review",
    enabled: true,
    status: "running",
  });
  expect(message).toEqual({
    type: "plugin.list.response",
    payload: { requestId: "npm", plugins: [plugin] },
  });
});

describe("plugin subscription protocol", () => {
  it("parses a subscribe request and its response", () => {
    const request = {
      type: "plugin.rpc.subscribe.request",
      requestId: "r1",
      pluginId: "diff-watch",
      method: "diff.watch",
      input: { a: "main", b: "HEAD" },
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "plugin.rpc.subscribe.response",
      payload: { requestId: "r1", subscriptionId: "s1" },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses JSON events and closes with and without an error", () => {
    for (const message of [
      { type: "plugin.rpc.event", payload: { subscriptionId: "s1", event: { path: "a.ts" } } },
      { type: "plugin.rpc.closed", payload: { subscriptionId: "s1" } },
      { type: "plugin.rpc.closed", payload: { subscriptionId: "s1", error: "boom" } },
    ]) {
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  it("advertises the feature as an optional flag", () => {
    const status = {
      type: "status",
      payload: {
        status: "server_info",
        serverId: "srv",
        features: { pluginSubscriptions: true },
      },
    };
    expect(StatusMessageSchema.parse(status)).toMatchObject(status);
  });
});
