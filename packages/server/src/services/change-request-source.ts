import { z } from "zod";

const changeRequestCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.url({ protocol: /^https?$/ }).optional(),
  state: z.enum(["pending", "failed", "passed", "neutral"]),
});
export const changeRequestStatusSchema = z.object({
  state: z.enum(["open", "closed", "merged"]),
  headSha: z.string(),
  checksState: z.enum(["pending", "failed", "passed", "neutral"]),
  checks: z.array(changeRequestCheckSchema),
  reviewDecision: z.string().nullable(),
});
const changeRequestSnapshotSchema = changeRequestStatusSchema.extend({
  activity: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["comment", "inline comment", "review", "approval"]),
      url: z.string(),
      message: z.string().optional(),
    }),
  ),
});

export type ChangeRequestSnapshot = z.infer<typeof changeRequestSnapshotSchema>;
export type ChangeRequestStatus = z.infer<typeof changeRequestStatusSchema>;

/** One deployment of a change request's head commit, newest first. */
export interface ChangeRequestDeployment {
  environment: string | null;
  /** The forge's own state of the latest status, such as GitHub's SUCCESS or IN_PROGRESS. */
  state: string | null;
  createdAt: string;
  url?: string;
  logUrl?: string;
}

/** Facts a one-shot read adds to the status a watch tracks. */
export interface ChangeRequestDetails {
  number: number;
  title: string;
  isDraft: boolean;
  /** The forge's own value, such as GitHub's MERGEABLE, CONFLICTING or UNKNOWN. */
  mergeable: string | null;
  /** The author's login, when the forge says. */
  author?: string | null;
  reviewRequestCount?: number;
  viewerCanMergeAsAdmin?: boolean;
  /** Only when the read asked for deployments. */
  deployments?: ChangeRequestDeployment[];
}

export type ChangeRequestReadResult = ChangeRequestStatus & ChangeRequestDetails;

export interface ChangeRequestReadOptions {
  /** Canonical addresses to also read deployments for. They cost extra points. */
  deployments?: ReadonlySet<string>;
}

/** A change request whose head is a branch, from a branch lookup. */
export interface ChangeRequestBranchEntry {
  url: string;
  number: number;
  state: ChangeRequestStatus["state"];
}

/** A repository plus head branch, resolved to the forge's canonical repository address. */
export interface ChangeRequestBranchQuery {
  /** Canonical repository address, such as https://github.com/acme/widgets. */
  repo: string;
  headRef: string;
  includeClosed?: boolean;
}

/** An open change request from a repository list. */
export interface ChangeRequestListEntry {
  url: string;
  number: number;
  title: string;
  isDraft: boolean;
  headRef: string;
  author: string | null;
  /** ISO 8601. */
  updatedAt: string;
}

export interface ChangeRequestListQuery {
  /** Canonical repository address, such as https://github.com/acme/widgets. */
  repo: string;
  limit: number;
}

/**
 * A status the forge read on its own (a workspace poll, a watch), for the pull request service's
 * cache. Details are present when that read had them.
 */
export interface ChangeRequestObservedRead {
  url: string;
  status: ChangeRequestStatus & Partial<ChangeRequestDetails>;
  purpose: ChangeRequestReadPurpose;
}

/** Who a forge query was for, for per-caller budget accounting. */
export type ChangeRequestReadPurpose = "workspace" | "watch" | "read" | "branch" | "list";

/** What one forge query cost, split across the change requests it read. */
export interface ChangeRequestQueryCost {
  host: string;
  /** The forge's points for the whole query. */
  cost: number;
  parts: { purpose: ChangeRequestReadPurpose; urls: string[]; count: number }[];
}

/**
 * Why a read failed, so plugins can keep their last state through a pause instead of showing the
 * PR as unknown. `error` covers everything else.
 */
export type ChangeRequestReadFailure = "paused" | "not_found" | "unsupported" | "error";

export class ChangeRequestReadError extends Error {
  readonly reason: ChangeRequestReadFailure;
  /** For `paused`: when reads resume, epoch ms. */
  readonly retryAt?: number;

  constructor(
    message: string,
    options: { reason: ChangeRequestReadFailure; retryAt?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "ChangeRequestReadError";
    this.reason = options.reason;
    if (options.retryAt !== undefined) this.retryAt = options.retryAt;
  }
}

export interface ChangeRequestSource {
  /** Resolve the URL to the forge's canonical change request address. */
  resolve(url: string): string;
  /** Human-readable identity for a canonical change request address. */
  describe(url: string): string;
  observe(
    url: string,
    callbacks: {
      snapshot(snapshot: ChangeRequestSnapshot): Promise<void>;
      error(error: unknown): void;
      /** Activity the daemon has committed to its baseline. */
      knownActivity?(): ReadonlySet<string>;
    },
  ): () => void;
  /**
   * Read canonical addresses once, without watching them: status plus details, no activity.
   * Forges without it can only be watched.
   */
  read?(
    urls: string[],
    options?: ChangeRequestReadOptions,
  ): Promise<Map<string, ChangeRequestReadResult | Error>>;
  /** Canonical repository address for a repository URL; throws when it isn't one. */
  resolveRepository?(url: string): string;
  /** Change requests whose head is the branch, newest first. Throws `ChangeRequestReadError`. */
  listForBranch?(query: ChangeRequestBranchQuery): Promise<ChangeRequestBranchEntry[]>;
  /**
   * A repository's open change requests, most recently updated first, at most `limit`. Its query
   * cost reports `purpose: "list"` with the repository address. Throws `ChangeRequestReadError`.
   */
  listOpen?(query: ChangeRequestListQuery): Promise<ChangeRequestListEntry[]>;
  /**
   * Hears every change request status the forge reads for its own callers (workspace polls,
   * watches) and what each query cost. Returns the unsubscribe.
   */
  observeReads?(listener: ChangeRequestReadObserver): () => void;
}

export interface ChangeRequestReadObserver {
  read?(read: ChangeRequestObservedRead): void;
  cost?(cost: ChangeRequestQueryCost): void;
}
