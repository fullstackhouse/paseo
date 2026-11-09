import { describe, expect, it } from "vitest";
import type { CommandCenterWorkspaceResult } from "./results";
import { filterAndRankWorkspaces } from "./workspace-search";

function workspace(input: {
  id: string;
  title?: string;
  subtitle?: string;
  changeRequestNumber?: number | null;
  activityAt?: Date | null;
  archived?: boolean;
}): CommandCenterWorkspaceResult {
  return {
    kind: "workspace",
    serverId: "server",
    workspaceId: "workspace",
    id: input.id,
    title: input.title ?? input.id,
    subtitle: input.subtitle ?? "",
    project: { viewKey: "project", name: "project", iconDataUri: null },
    changeRequestNumber: input.changeRequestNumber ?? null,
    activityAt: input.activityAt ?? null,
    archived: input.archived ?? false,
    run: () => undefined,
  };
}

function ids(rows: readonly CommandCenterWorkspaceResult[], query: string): string[] {
  return filterAndRankWorkspaces(rows, query).map((row) => row.id);
}

describe("filterAndRankWorkspaces", () => {
  const subject = workspace({
    id: "payments",
    title: "Payments refactor",
    subtitle: "Primary host · feature/checkout",
    changeRequestNumber: 42,
  });

  it("matches everything when the query is empty", () => {
    expect(ids([subject], "  ")).toEqual(["payments"]);
  });

  it("matches its own change-request number in every spelling", () => {
    const spellings = ["42", " 42 ", "#42", "!42", "pr 42", "mr 42", "PR #42", "mr!42", "pr42"];
    for (const query of spellings) {
      expect(ids([subject], query)).toEqual(["payments"]);
    }
  });

  it("does not take the number path for text that merely contains digits", () => {
    const numbered = workspace({ id: "unrelated workspace", changeRequestNumber: 42 });
    for (const query of ["fix-42-retries", "42x", "v4.2", "pr"]) {
      expect(ids([numbered], query)).toEqual([]);
    }
  });

  it("does not match a different change-request number that shares digits", () => {
    const other = workspace({ id: "unrelated", changeRequestNumber: 142 });
    expect(ids([other], "42")).toEqual([]);
  });

  it("still matches on title and branch text", () => {
    expect(ids([subject], "checkout")).toEqual(["payments"]);
    expect(ids([subject], "payments")).toEqual(["payments"]);
  });

  it("leaves a workspace without a change request unaffected", () => {
    const noPr = workspace({ id: "docs workspace" });
    expect(ids([noPr], "42")).toEqual([]);
    expect(ids([noPr], "docs")).toEqual(["docs workspace"]);
  });

  it("falls back to text matching when the number does not match", () => {
    const textual = workspace({
      id: "text",
      subtitle: "branch fix-42-retries",
      changeRequestNumber: 7,
    });
    expect(ids([textual], "42")).toEqual(["text"]);
  });

  it("ranks an exact change request above an ordinary text match", () => {
    const text = workspace({ id: "a-text", title: "Migration 42" });
    expect(ids([text, subject], "42")).toEqual(["payments", "a-text"]);
  });

  it("orders workspaces in the same match tier by recency", () => {
    const older = workspace({
      id: "older",
      title: "Usage hover card",
      activityAt: new Date("2026-10-01T00:00:00Z"),
    });
    const newer = workspace({
      id: "newer",
      title: "Deliver sidebar usage",
      activityAt: new Date("2026-10-17T00:00:00Z"),
    });
    expect(ids([older, newer], "usage")).toEqual(["newer", "older"]);
  });

  describe("an archived workspace recalled by its title", () => {
    const archived = workspace({
      id: "grant-max",
      title: "Grant Max access to production",
      subtitle: "groomershop-mercato · docs/offboarding-maks",
      activityAt: new Date("2026-11-09T10:00:00Z"),
      archived: true,
    });
    // "grant" only lands as letters scattered through the branch name.
    const scattered = workspace({
      id: "sfera",
      title: "Review PR 974 GSM-755 sfera contract",
      subtitle: "groomershop-mercato · maxidragon/gsm-755-sfera-contract-ecp-hours-set",
      activityAt: new Date("2026-11-09T10:50:00Z"),
    });

    it("ranks above an active workspace that only matched scattered letters", () => {
      expect(ids([scattered, archived], "grant max")).toEqual(["grant-max", "sfera"]);
      expect(ids([scattered, archived], "max")[0]).toBe("grant-max");
    });

    it("ranks below an active workspace that matches as well", () => {
      const active = workspace({
        id: "active",
        title: "Grant Max access to staging",
        activityAt: new Date("2026-11-01T00:00:00Z"),
      });
      expect(ids([archived, active], "grant max")).toEqual(["active", "grant-max"]);
    });

    it("forgives a typo, as History search does", () => {
      expect(ids([archived], "grnat")).toEqual(["grant-max"]);
    });
  });
});
