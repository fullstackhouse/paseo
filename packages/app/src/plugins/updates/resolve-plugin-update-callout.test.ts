import type { PluginUpdatePreview } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import {
  resolvePluginUpdateCallout,
  type ResolvePluginUpdateCalloutInput,
} from "./resolve-plugin-update-callout";

function gitPreview(id: string, commit: string): PluginUpdatePreview {
  const identity = {
    kind: "git" as const,
    remote: `https://github.com/acme/${id}`,
    pluginPath: "",
  };
  return {
    id,
    outcome: "update",
    links: [],
    target: { kind: "git", commit },
    proposal: {
      id,
      expected: { identity, installationRoot: `/plugins/${id}`, revision: "a".repeat(40) },
      target: { kind: "git", commit },
    },
  };
}

function input(
  overrides: Partial<ResolvePluginUpdateCalloutInput> = {},
): ResolvePluginUpdateCalloutInput {
  return {
    serverId: "srv-1",
    hostLabel: null,
    previews: [
      gitPreview("paseo-asks", "b".repeat(40)),
      { id: "paseo-prs", outcome: "current", links: [] },
    ],
    isApplying: false,
    applyError: null,
    ...overrides,
  };
}

describe("resolvePluginUpdateCallout", () => {
  it("shows nothing until the preview loads or when every plugin is current", () => {
    expect(resolvePluginUpdateCallout(input({ previews: undefined }))).toBeNull();
    expect(
      resolvePluginUpdateCallout(
        input({ previews: [{ id: "paseo-prs", outcome: "current", links: [] }] }),
      ),
    ).toBeNull();
  });

  it("ignores local and failed previews", () => {
    expect(
      resolvePluginUpdateCallout(
        input({
          previews: [
            { id: "dev-plugin", outcome: "local", links: [] },
            { id: "broken", outcome: "error", links: [], error: "offline" },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("does not prompt before or during automatic updates", () => {
    expect(resolvePluginUpdateCallout(input())).toBeNull();
    expect(resolvePluginUpdateCallout(input({ isApplying: true }))).toBeNull();
  });

  it("identifies the host and retries only plugins with available updates", () => {
    const descriptor = resolvePluginUpdateCallout(
      input({ hostLabel: "MacBook", applyError: "build failed" }),
    );
    expect(descriptor?.description).toBe("MacBook: build failed");
    expect(descriptor?.proposals.map((proposal) => proposal.id)).toEqual(["paseo-asks"]);
  });

  it("keys dismissal on the target, so a newer commit shows the callout again", () => {
    const first = resolvePluginUpdateCallout(input({ applyError: "failed" }));
    const newer = resolvePluginUpdateCallout(
      input({ previews: [gitPreview("paseo-asks", "c".repeat(40))], applyError: "failed" }),
    );
    expect(first?.dismissalKey).not.toBe(newer?.dismissalKey);
  });

  it("disables the action while applying and offers retry after a failure", () => {
    expect(
      resolvePluginUpdateCallout(input({ isApplying: true, applyError: "failed" })),
    ).toMatchObject({
      actionLabel: "Updating...",
      actionDisabled: true,
    });
    expect(
      resolvePluginUpdateCallout(input({ applyError: "paseo-asks: build failed" })),
    ).toMatchObject({
      title: "Plugin update failed",
      description: "paseo-asks: build failed",
      variant: "error",
      actionLabel: "Retry",
    });
  });
});
