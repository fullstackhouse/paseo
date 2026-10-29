import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";

// Shells that parse paseo.json commands (POSIX sh syntax) themselves. Typing the command into
// them keeps the user's functions and aliases (nvm, pyenv) working, so their behavior is unchanged.
const POSIX_SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "mksh",
  "ash",
  "yash",
  "busybox",
]);

// Word characters every interactive shell (fish, nu, pwsh, xonsh, elvish) reads literally.
const SHELL_SAFE_PATH = /^[A-Za-z0-9_./-]+$/;

export function shellParsesPosixCommands(shell: string): boolean {
  return POSIX_SHELLS.has(basename(shell).replace(/^-/, ""));
}

export interface BuildWorkspaceScriptInputOptions {
  command: string;
  /** The interactive shell the script's terminal runs. */
  shell: string;
  platform?: NodeJS.Platform;
  /** Names the script file. One per workspace script, and a script can't run twice at once. */
  scriptKey: string;
  scriptDir?: string;
}

/**
 * The line typed into a workspace script's terminal. paseo.json commands are POSIX sh. A shell that
 * doesn't speak it (fish, nu, pwsh) gets `/bin/sh <file>` instead: plain words parse the same in every
 * shell, and the script inherits the terminal's environment and working directory.
 */
export function buildWorkspaceScriptInput(options: BuildWorkspaceScriptInputOptions): string {
  const platform = options.platform ?? process.platform;
  if (platform === "win32" || shellParsesPosixCommands(options.shell)) {
    return `${options.command}\r`;
  }

  const scriptDir = options.scriptDir ?? join(tmpdir(), `${userInfo().username}-paseo-scripts`);
  const scriptPath = join(scriptDir, `${options.scriptKey}.sh`);
  if (!SHELL_SAFE_PATH.test(scriptPath)) {
    throw new Error(
      `Can't run workspace scripts from ${options.shell}: the script path ${scriptPath} needs quoting. Set SHELL to a POSIX shell for the daemon.`,
    );
  }
  mkdirSync(scriptDir, { recursive: true, mode: 0o700 });
  writeFileSync(scriptPath, `${options.command}\n`, { mode: 0o600 });
  return `/bin/sh ${scriptPath}\r`;
}
