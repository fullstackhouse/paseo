import { describe, expect, it, vi } from "vitest";
import { createChangeRequestReader } from "./change-request-reader.js";
import type { ChangeRequestRouter } from "./change-request-router.js";
import type { ChangeRequestReadResult, ChangeRequestSource } from "./change-request-source.js";

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
    });
    expect(unsupported).toMatchObject({
      ok: false,
      error: "Reading change requests is not supported for gitlab yet.",
    });
    expect(failed).toEqual({ url: PR, ok: false, error: `Could not read ${PR}.` });

    fail = false;
    await expect(reader.read([PR])).resolves.toEqual([expect.objectContaining({ ok: true })]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
