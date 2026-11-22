import { describe, expect, it } from "vitest";
import type { CreateInitialBranchResult } from "@getpaseo/client/internal/daemon-client";
import { resolveEmptyRepository, type EmptyRepositoryPrompt } from "./initial-branch";

const CWD = "/projects/empty-repo";

interface FakeInitialBranchClient {
  calls: Array<{ dryRun: boolean }>;
  createInitialBranch: (
    cwd: string,
    options?: { dryRun?: boolean },
  ) => Promise<CreateInitialBranchResult>;
}

function fakeClient(created: Partial<CreateInitialBranchResult> = {}): FakeInitialBranchClient {
  const calls: Array<{ dryRun: boolean }> = [];
  return {
    calls,
    createInitialBranch: async (cwd, options) => {
      calls.push({ dryRun: options?.dryRun === true });
      return {
        requestId: "req",
        cwd,
        success: true,
        branch: "main",
        pushedTo: "origin",
        error: null,
        ...(options?.dryRun ? {} : created),
      };
    },
  };
}

describe("resolveEmptyRepository", () => {
  it("asks about the branch the daemon would create, and creates it when chosen", async () => {
    const client = fakeClient();
    const prompts: Array<Pick<EmptyRepositoryPrompt, "branch" | "pushTo">> = [];

    const choice = await resolveEmptyRepository({
      client,
      cwd: CWD,
      ask: async ({ branch, pushTo, createBranch }) => {
        prompts.push({ branch, pushTo });
        await createBranch();
        return "created";
      },
    });

    expect(choice).toBe("created");
    expect(prompts).toEqual([{ branch: "main", pushTo: "origin" }]);
    expect(client.calls).toEqual([{ dryRun: true }, { dryRun: false }]);
  });

  it("creates nothing when the user picks the local checkout or cancels", async () => {
    for (const picked of ["local", "cancelled"] as const) {
      const client = fakeClient();

      const choice = await resolveEmptyRepository({ client, cwd: CWD, ask: async () => picked });

      expect(choice).toBe(picked);
      expect(client.calls).toEqual([{ dryRun: true }]);
    }
  });

  it("lets the prompt show why the branch could not be created", async () => {
    const client = fakeClient({
      success: false,
      branch: null,
      pushedTo: null,
      error: { code: "UNKNOWN", message: "Author identity unknown" },
    });
    let failure: unknown = null;

    await resolveEmptyRepository({
      client,
      cwd: CWD,
      ask: async ({ createBranch }) => {
        failure = await createBranch().catch((error: unknown) => error);
        return "cancelled";
      },
    });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Author identity unknown");
  });
});
