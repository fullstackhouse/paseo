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

  it("offers only the plugins with updates", () => {
    const descriptor = resolvePluginUpdateCallout(input());
    expect(descriptor).toMatchObject({
      id: "plugin-updates:srv-1",
      title: "Plugin updates available",
      description: "paseo-asks can be updated.",
      variant: "default",
      actionLabel: "Update",
      actionDisabled: false,
    });
    expect(descriptor?.proposals.map((proposal) => proposal.id)).toEqual(["paseo-asks"]);
  });

  it("names the host when several are configured", () => {
    expect(resolvePluginUpdateCallout(input({ hostLabel: "MacBook" }))?.description).toBe(
      "paseo-asks on MacBook can be updated.",
    );
  });

  it("keys dismissal on the target, so a newer commit shows the callout again", () => {
    const first = resolvePluginUpdateCallout(input());
    const newer = resolvePluginUpdateCallout(
      input({ previews: [gitPreview("paseo-asks", "c".repeat(40))] }),
    );
    expect(first?.dismissalKey).not.toBe(newer?.dismissalKey);
  });

  it("disables the action while applying and offers retry after a failure", () => {
    expect(resolvePluginUpdateCallout(input({ isApplying: true }))).toMatchObject({
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
