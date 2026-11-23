import { describe, expect, it } from "vitest";
import { parsePaseoAppLink } from "./paseo-app-link";

describe("parsePaseoAppLink", () => {
  it("reads a workspace link", () => {
    expect(parsePaseoAppLink("paseo://h/srv_1/workspace/wks_abc")).toEqual({
      kind: "workspace",
      serverId: "srv_1",
      workspaceId: "wks_abc",
    });
  });

  it("reads a workspace link with a query", () => {
    expect(parsePaseoAppLink("paseo://h/srv_1/workspace/wks_abc?ask=A3")).toEqual({
      kind: "workspace",
      serverId: "srv_1",
      workspaceId: "wks_abc",
    });
  });

  it("reads an agent link", () => {
    expect(parsePaseoAppLink("paseo://h/srv_1/agent/agent-1")).toEqual({
      kind: "agent",
      serverId: "srv_1",
      agentId: "agent-1",
    });
  });

  it("ignores other links", () => {
    expect(parsePaseoAppLink("https://paseo.sh/h/srv_1/workspace/wks_abc")).toBeNull();
    expect(parsePaseoAppLink("paseo://app")).toBeNull();
    expect(parsePaseoAppLink("paseo://h/srv_1/settings")).toBeNull();
  });
});
