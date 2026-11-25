// FSH fork: test builds are prereleases the desktop lists and installs through install-fsh.sh
// (packages/desktop/src/features/fsh-updater.ts). Installing one, or going back to stable, runs
// through the regular app update install with an `fshRelease` argument.
import { invokeDesktopCommand } from "@/desktop/electron/invoke";

export interface FshTestBuild {
  tag: string;
  pr: number | null;
  branch: string | null;
  sha: string;
  publishedAt: string | null;
}

export interface FshTestBuildsInfo {
  installedTag: string;
  installedTestBuild: FshTestBuild | null;
  testBuilds: FshTestBuild[];
  errorMessage: string | null;
}

/** What install_app_update installs: a test build tag, or `stable` for the latest release. */
export type FshRelease = "stable" | (string & {});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function parseTestBuild(raw: unknown): FshTestBuild | null {
  if (!isRecord(raw) || typeof raw.tag !== "string" || typeof raw.sha !== "string") return null;
  return {
    tag: raw.tag,
    pr: typeof raw.pr === "number" ? raw.pr : null,
    branch: stringOrNull(raw.branch),
    sha: raw.sha,
    publishedAt: stringOrNull(raw.publishedAt),
  };
}

/** Null when the desktop isn't a packaged FSH build (or predates test builds). */
export function parseFshTestBuildsInfo(raw: unknown): FshTestBuildsInfo | null {
  if (!isRecord(raw) || typeof raw.installedTag !== "string") return null;
  const testBuilds = Array.isArray(raw.testBuilds) ? raw.testBuilds : [];
  return {
    installedTag: raw.installedTag,
    installedTestBuild: parseTestBuild(raw.installedTestBuild),
    testBuilds: testBuilds
      .map(parseTestBuild)
      .filter((build): build is FshTestBuild => build !== null),
    errorMessage: stringOrNull(raw.errorMessage),
  };
}

export async function getFshTestBuilds(): Promise<FshTestBuildsInfo | null> {
  try {
    return parseFshTestBuildsInfo(await invokeDesktopCommand<unknown>("fsh_test_builds"));
  } catch {
    // A desktop without the command: not an FSH build with test builds.
    return null;
  }
}

/** `PR #12 · feat/thing · def5678`, `fsh-rebase-v0.17.1 · 4d2a5d0`. */
export function formatTestBuildLabel(build: FshTestBuild): string {
  return [build.pr === null ? null : `PR #${build.pr}`, build.branch, build.sha]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
