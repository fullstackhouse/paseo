import type {
  PluginUpdatePreview,
  PluginUpdateProposal,
  PluginUpdateResult,
} from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import {
  checkPluginUpdates,
  describePluginUpdateCheck,
  type PluginUpdateClient,
} from "./check-plugin-updates";

function outdated(id: string): PluginUpdatePreview {
  return {
    id,
    outcome: "update",
    links: [],
    proposal: {
      id,
      expected: {
        identity: { kind: "git", remote: `https://github.com/acme/${id}`, pluginPath: "" },
        installationRoot: `/plugins/${id}`,
        revision: "a".repeat(40),
      },
      target: { kind: "git", commit: "b".repeat(40) },
    },
  };
}

function current(id: string): PluginUpdatePreview {
  return { id, outcome: "current", links: [] };
}

function client(
  previews: PluginUpdatePreview[] | Error,
  apply: (proposals: PluginUpdateProposal[]) => PluginUpdateResult[] = (proposals) =>
    proposals.map((proposal) => ({ id: proposal.id, outcome: "updated" })),
): PluginUpdateClient & { applied: PluginUpdateProposal[][] } {
  const applied: PluginUpdateProposal[][] = [];
  return {
    applied,
    previewPluginUpdates: async () => {
      if (previews instanceof Error) throw previews;
      return previews;
    },
    applyPluginUpdates: async (proposals) => {
      applied.push(proposals);
      return apply(proposals);
    },
  };
}

describe("checkPluginUpdates", () => {
  it("applies only outdated plugins", async () => {
    const host = client([current("asks"), outdated("prs")]);

    const result = await checkPluginUpdates([{ label: null, client: host }]);

    expect(result).toEqual({ updated: ["prs"], failures: [] });
    expect(host.applied).toHaveLength(1);
    expect(host.applied[0]?.map(({ id }) => id)).toEqual(["prs"]);
  });

  it("skips applying when everything is current", async () => {
    const host = client([current("asks")]);

    expect(await checkPluginUpdates([{ label: null, client: host }])).toEqual({
      updated: [],
      failures: [],
    });
    expect(host.applied).toEqual([]);
  });

  it("collects preview, apply and host errors, labelled per host", async () => {
    const broken = client(
      [outdated("prs"), { id: "inbox", outcome: "error", links: [], error: "remote gone" }],
      () => [{ id: "prs", outcome: "error", error: "dirty checkout" }],
    );
    const offline = client(new Error("permission denied"));

    const result = await checkPluginUpdates([
      { label: "MacBook", client: broken },
      { label: "Server", client: offline },
    ]);

    expect(result).toEqual({
      updated: [],
      failures: [
        "MacBook: inbox: remote gone",
        "MacBook: prs: dirty checkout",
        "Server: permission denied",
      ],
    });
  });
});

describe("describePluginUpdateCheck", () => {
  it("reports up to date", () => {
    expect(describePluginUpdateCheck({ updated: [], failures: [] })).toEqual({
      kind: "success",
      message: "All plugins are up to date",
    });
  });

  it("reports updates and failures together as an error", () => {
    expect(describePluginUpdateCheck({ updated: ["prs"], failures: ["inbox: boom"] })).toEqual({
      kind: "error",
      message: "Updated prs\nPlugin update failed:\ninbox: boom",
    });
  });
});
