import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPlatform } from "../test-utils/platform.js";
import { buildWorkspaceScriptInput, shellParsesPosixCommands } from "./workspace-script-input.js";

const COMMAND = 'PORT="${PASEO_PORT:-6768}" ./scripts/dev.sh';

describe("shellParsesPosixCommands", () => {
  it("recognizes POSIX shells by name, including login shells", () => {
    for (const shell of ["/bin/sh", "/bin/bash", "/bin/zsh", "-zsh", "/usr/bin/dash"]) {
      expect(shellParsesPosixCommands(shell)).toBe(true);
    }
  });

  it("treats every other shell as not speaking POSIX", () => {
    for (const shell of ["/opt/homebrew/bin/fish", "/usr/local/bin/nu", "/usr/bin/pwsh"]) {
      expect(shellParsesPosixCommands(shell)).toBe(false);
    }
  });
});

describe("buildWorkspaceScriptInput", () => {
  let scriptDir: string;

  beforeEach(() => {
    scriptDir = join(realpathSync(mkdtempSync(join(tmpdir(), "paseo-script-input-"))), "scripts");
  });

  afterEach(() => {
    rmSync(join(scriptDir, ".."), { recursive: true, force: true });
  });

  it("types the command into a POSIX shell unchanged", () => {
    expect(
      buildWorkspaceScriptInput({ command: COMMAND, shell: "/bin/zsh", scriptKey: "k", scriptDir }),
    ).toBe(`${COMMAND}\r`);
  });

  it("types the command unchanged on Windows", () => {
    expect(
      buildWorkspaceScriptInput({
        command: COMMAND,
        shell: "C:\\Windows\\System32\\cmd.exe",
        platform: "win32",
        scriptKey: "k",
        scriptDir,
      }),
    ).toBe(`${COMMAND}\r`);
  });

  // The /bin/sh path only exists off Windows, where scripts are typed into the shell unchanged.
  it.skipIf(isPlatform("win32"))(
    "runs the command through /bin/sh from a script file for other shells",
    () => {
      const input = buildWorkspaceScriptInput({
        command: COMMAND,
        shell: "/opt/homebrew/bin/fish",
        scriptKey: "abc123",
        scriptDir,
      });
      const scriptPath = join(scriptDir, "abc123.sh");
      expect(input).toBe(`/bin/sh ${scriptPath}\r`);
      expect(readFileSync(scriptPath, "utf8")).toBe(`${COMMAND}\n`);
    },
  );

  it.skipIf(isPlatform("win32"))("refuses a script path the shell would have to unquote", () => {
    expect(() =>
      buildWorkspaceScriptInput({
        command: COMMAND,
        shell: "/opt/homebrew/bin/fish",
        scriptKey: "k",
        scriptDir: join(scriptDir, "with space"),
      }),
    ).toThrow(/needs quoting/);
  });
});
