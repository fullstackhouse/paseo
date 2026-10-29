import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { GitSyncCard } from "./sync-card";

const queries = vi.hoisted(() => ({
  commits: { status: "idle" } as unknown,
  diff: {
    files: [] as { additions: number; deletions: number }[],
    isLoading: true,
    isError: false,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}(${Object.values(options).join(",")})` : key,
  }),
}));

vi.mock("@/hooks/use-time-ago", () => ({ useTimeAgo: () => "2h ago" }));
vi.mock("@/git/use-commits-query", () => ({ useCheckoutCommitsQuery: () => queries.commits }));
vi.mock("@/git/use-diff-query", () => ({ useCheckoutDiffQuery: () => queries.diff }));

function commit(shortSha: string, isOnRemote: boolean): ClassifiedCheckoutCommit {
  return {
    sha: `${shortSha}000`,
    shortSha,
    subject: `subject ${shortSha}`,
    authorName: "Jacek",
    authorDate: "2026-10-28T08:00:00Z",
    isOnRemote,
    isOnBase: false,
    files: [],
  };
}

let root: Root | null = null;
let container: HTMLElement;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function render(facts: Parameters<typeof GitSyncCard>[0]["facts"]): string {
  act(() => root?.render(<GitSyncCard serverId="srv" cwd="/repo" facts={facts} />));
  return container.textContent ?? "";
}

describe("GitSyncCard", () => {
  it("shows the branch pair, unpushed commits, the pull count and the next step", () => {
    queries.commits = {
      status: "loaded",
      data: {
        baseRef: "origin/main",
        commits: [commit("aaa1111", false), commit("bbb2222", false), commit("ccc3333", true)],
      },
    };
    const text = render({
      currentBranch: "main",
      upstreamRef: "origin/main",
      isDirty: false,
      aheadOfOrigin: 2,
      behindOfOrigin: 327,
    });

    expect(text).toContain("main→origin/main");
    expect(text).toContain("workspace.git.sync.toPush(2)");
    expect(text).toContain("aaa1111subject aaa1111Jacek · 2h ago");
    expect(text).toContain("bbb2222");
    expect(text).not.toContain("ccc3333");
    expect(text).toContain("workspace.git.sync.toPull(327)");
    expect(text).toContain("workspace.git.sync.next.pullThenPush");
    expect(text).not.toContain("workspace.git.sync.uncommitted");
  });

  it("caps the commit list and counts the rest", () => {
    queries.commits = {
      status: "loaded",
      data: {
        baseRef: null,
        commits: ["a1", "b2", "c3", "d4", "e5"].map((sha) => commit(sha, false)),
      },
    };
    const text = render({ currentBranch: "main", aheadOfOrigin: 5, behindOfOrigin: 0 });

    expect(text).toContain("c3");
    expect(text).not.toContain("d4");
    expect(text).toContain("workspace.git.sync.moreCommits(2)");
    expect(text).toContain("workspace.git.sync.next.push");
  });

  it("omits the list when the host can't list commits", () => {
    queries.commits = { status: "unsupported" };
    const text = render({ currentBranch: "main", aheadOfOrigin: 1, behindOfOrigin: 0 });

    expect(text).toContain("workspace.git.sync.toPush(1)");
    expect(text).not.toContain("·");
  });

  it("counts uncommitted files and lines once the diff loads", () => {
    queries.commits = { status: "idle" };
    queries.diff = {
      files: [
        { additions: 3, deletions: 1 },
        { additions: 2, deletions: 0 },
      ],
      isLoading: false,
      isError: false,
    };
    const text = render({ currentBranch: "feature", isDirty: true, aheadOfOrigin: null });

    expect(text).toContain("workspace.git.sync.filesUncommitted(2)");
    expect(text).toContain("+5-1");
    expect(text).toContain("workspace.git.sync.next.commit");
    expect(text).not.toContain("→");
  });
});
