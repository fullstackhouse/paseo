import type { ChangeRequestList } from "@getpaseo/client";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { resolveChangeRequestMenu } from "./use-agent-autocomplete";

const t = ((key: string) => key) as unknown as TFunction;

function openList(items: { number: number; title: string }[]): ChangeRequestList {
  return {
    repo: "https://github.com/acme/widgets",
    ok: true,
    items: items.map((item) => ({
      url: `https://github.com/acme/widgets/pull/${item.number}`,
      number: item.number,
      title: item.title,
      isDraft: false,
      headRef: `branch-${item.number}`,
      author: "octocat",
      updatedAt: "2026-01-01T00:00:00Z",
    })),
  };
}

function failedList(reason: NonNullable<ChangeRequestList["reason"]>): ChangeRequestList {
  return {
    repo: "https://github.com/acme/widgets",
    ok: false,
    items: [],
    error: `list failed: ${reason}`,
    reason,
  };
}

function resolve(overrides: Partial<Parameters<typeof resolveChangeRequestMenu>[0]>) {
  return resolveChangeRequestMenu({
    list: undefined,
    lookedUpItems: [],
    query: "",
    numberPrefix: "#",
    isPending: false,
    error: null,
    t,
    ...overrides,
  });
}

describe("resolveChangeRequestMenu", () => {
  it("shows a loading row while the list is pending", () => {
    expect(resolve({ isPending: true })).toEqual({
      options: [],
      status: { kind: "loading", message: "agentAutocomplete.loadingChangeRequests" },
    });
  });

  it.each(["unsupported", "not_found"] as const)(
    "hides the menu when the host can't list the repository (%s)",
    (reason) => {
      expect(resolve({ list: failedList(reason) })).toBeNull();
    },
  );

  it.each(["paused", "error"] as const)("shows an error row for a %s list", (reason) => {
    expect(resolve({ list: failedList(reason) })).toEqual({
      options: [],
      status: {
        kind: "error",
        title: "agentAutocomplete.changeRequestsFailed",
        reason: `list failed: ${reason}`,
      },
    });
  });

  it("shows an error row when the request throws, e.g. a host without the list", () => {
    const error = new Error("Update the host to list pull requests through Paseo.");
    expect(resolve({ error })).toEqual({
      options: [],
      status: {
        kind: "error",
        title: "agentAutocomplete.changeRequestsFailed",
        reason: error.message,
      },
    });
  });

  it("shows an empty row when nothing matches", () => {
    expect(resolve({ list: openList([{ number: 7, title: "Fix login" }]), query: "zzz" })).toEqual({
      options: [],
      status: { kind: "empty", message: "agentAutocomplete.noChangeRequests" },
    });
  });

  it("merges a looked-up merged pull request into the open list, labelled", () => {
    const menu = resolve({
      list: openList([{ number: 42, title: "Add search" }]),
      lookedUpItems: [{ number: 4, title: "Old fix", headRefName: null, state: "merged" }],
      query: "4",
    });
    expect(menu?.status).toBeNull();
    expect(menu?.options.map((option) => [option.label, option.description])).toEqual(
      expect.arrayContaining([
        ["#42 Add search", "branch-42"],
        ["#4 Old fix", "workspace.git.pr.states.merged"],
      ]),
    );
  });

  it("uses the forge's number prefix in the reference", () => {
    const menu = resolve({ list: openList([{ number: 12, title: "Tidy" }]), numberPrefix: "!" });
    expect(menu?.options).toEqual([
      expect.objectContaining({ label: "!12 Tidy", reference: "!12" }),
    ]);
  });
});
