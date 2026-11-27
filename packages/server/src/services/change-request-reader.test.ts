import { describe, expect, it, vi } from "vitest";
import { createChangeRequestReader } from "./change-request-reader.js";
import type { ChangeRequestRouter } from "./change-request-router.js";
import {
  ChangeRequestReadError,
  type ChangeRequestReadResult,
  type ChangeRequestSource,
} from "./change-request-source.js";

const PR = "https://github.com/acme/widgets/pull/41";

const result: ChangeRequestReadResult = {
  state: "open",
  headSha: "abc",
  checksState: "failed",
  checks: [
    { id: "1", name: "build", state: "failed", url: "https://ci.example/1" },
    { id: "2", name: "lint", state: "neutral" },
  ],
  reviewDecision: "REVIEW_REQUIRED",
  number: 41,
  title: "Fix the login redirect",
  isDraft: false,
  mergeable: "MERGEABLE",
};

function readAll(urls: string[], fail = false) {
  return new Map(
    urls.map((url) => [url, fail ? new Error(`Could not read ${url}.`) : result] as const),
  );
}

/** /41 is paused until 5000; anything else is not found. */
function readFailures(urls: string[]) {
  return new Map<string, ChangeRequestReadResult | Error>(
    urls.map((url) => [
      url,
      url.endsWith("/41")
        ? new ChangeRequestReadError("paused", { reason: "paused", retryAt: 5_000 })
        : new ChangeRequestReadError("gone", { reason: "not_found" }),
    ]),
  );
}

function sourceFor(forge: string, source: ChangeRequestSource): ChangeRequestSource | null {
  if (forge === "github") return source;
  if (forge === "gitlab") return { ...source, read: undefined };
  return null;
}

function setup(read: ChangeRequestSource["read"]) {
  const source: ChangeRequestSource = {
    resolve: (url) => url.toLowerCase(),
    describe: (url) => url,
    observe: () => () => {},
    ...(read ? { read } : {}),
  };
  const router: ChangeRequestRouter = {
    async resolve(url) {
      const host = new URL(url).hostname;
      if (host === "github.com") return { forge: "github", url: source.resolve(url) };
      if (host === "gitlab.com") return { forge: "gitlab", url };
      throw new Error(`Could not recognize a supported forge for host ${host}.`);
    },
    source: (forge) => sourceFor(forge, source),
  };
  let now = 0;
  const reader = createChangeRequestReader({ router, now: () => now });
  return { reader, advance: (ms: number) => (now += ms) };
}

describe("createChangeRequestReader", () => {
  it("maps forge results to the plugin shape, in request order", async () => {
    const read = vi.fn(async (urls: string[]) => readAll(urls));
    const { reader } = setup(read);

    await expect(reader.read(["https://GitHub.com/acme/widgets/pull/41"])).resolves.toEqual([
      {
        url: "https://GitHub.com/acme/widgets/pull/41",
        ok: true,
        number: 41,
        title: "Fix the login redirect",
        state: "open",
        isDraft: false,
        mergeable: "mergeable",
        reviewDecision: "review_required",
        checksState: "failing",
        checks: [
          { name: "build", state: "failing", url: "https://ci.example/1" },
          { name: "lint", state: "skipped" },
        ],
        headSha: "abc",
      },
    ]);
    expect(read).toHaveBeenCalledWith([PR]);
  });

  it("serves a read again within 30 seconds and asks the forge after", async () => {
    const read = vi.fn(async (urls: string[]) => readAll(urls));
    const { reader, advance } = setup(read);

    await reader.read([PR]);
    advance(29_999);
    await reader.read([PR, PR]);
    expect(read).toHaveBeenCalledTimes(1);
    advance(1);
    await reader.read([PR]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares a read already in flight instead of queueing another for the same PR", async () => {
    const other = "https://github.com/acme/widgets/pull/42";
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const read = vi.fn(async (urls: string[]) => {
      await gate;
      return readAll(urls);
    });
    const { reader } = setup(read);

    const first = reader.read([PR]);
    const second = reader.read([PR, other]);
    const third = reader.read([PR]);
    finish();
    const results = await Promise.all([first, second, third]);

    expect(results.flat().every((entry) => entry.ok)).toBe(true);
    expect(read.mock.calls).toEqual([[[PR]], [[other]]]);
  });

  it("returns errors per URL without caching them", async () => {
    let fail = true;
    const read = vi.fn(async (urls: string[]) => readAll(urls, fail));
    const { reader } = setup(read);

    const [unknown, unsupported, failed] = await reader.read([
      "https://example.com/acme/widgets/pull/1",
      "https://gitlab.com/acme/widgets/-/merge_requests/2",
      PR,
    ]);
    expect(unknown).toEqual({
      url: "https://example.com/acme/widgets/pull/1",
      ok: false,
      error: "Could not recognize a supported forge for host example.com.",
      reason: "unsupported",
    });
    expect(unsupported).toMatchObject({
      ok: false,
      error: "Reading change requests is not supported for gitlab yet.",
      reason: "unsupported",
    });
    expect(failed).toEqual({ url: PR, ok: false, error: `Could not read ${PR}.`, reason: "error" });

    fail = false;
    await expect(reader.read([PR])).resolves.toEqual([expect.objectContaining({ ok: true })]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("passes a forge's pause and not-found through with their reason", async () => {
    const other = "https://github.com/acme/widgets/pull/42";
    const read = vi.fn(async (urls: string[]) => readFailures(urls));
    const { reader } = setup(read);

    await expect(reader.read([PR, other])).resolves.toEqual([
      { url: PR, ok: false, error: "paused", reason: "paused", retryAt: 5_000 },
      { url: other, ok: false, error: "gone", reason: "not_found" },
    ]);
  });
});
