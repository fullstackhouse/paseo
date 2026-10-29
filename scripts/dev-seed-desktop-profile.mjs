import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isMainModule } from "./is-main-module.mjs";
const rootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runFile = promisify(execFile);
export function defaultDesktopProfile(
  platform = process.platform,
  home = homedir(),
  env = process.env,
) {
  if (platform === "darwin") return join(home, "Library/Application Support/Paseo");
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData/Roaming"), "Paseo");
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "Paseo");
}
async function databaseSignature(directory) {
  return JSON.stringify(
    await Promise.all(
      (await readdir(directory))
        .filter((name) => name !== "LOCK" && !name.startsWith("LOG"))
        .sort()
        .map(async (name) => {
          const info = await stat(join(directory, name));
          return [name, info.size, info.mtimeMs];
        }),
    ),
  );
}
async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
export async function seedDesktopProfile({
  root = rootDefault,
  sourceProfile = process.env.PASEO_DEV_SOURCE_DESKTOP_PROFILE ?? defaultDesktopProfile(),
} = {}) {
  const source = resolve(sourceProfile);
  const database = join(source, "Local Storage/leveldb");
  const require = createRequire(join(root, "packages/desktop/package.json"));
  const electron = require("electron");
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporary = await mkdtemp(join(tmpdir(), "paseo-profile-seed-"));
    try {
      const profile = join(temporary, "profile");
      await mkdir(profile);
      const before = await databaseSignature(database);
      await cp(database, join(profile, "Local Storage/leveldb"), {
        recursive: true,
        filter: (path) => !path.endsWith("/LOCK"),
      });
      if (before !== (await databaseSignature(database)))
        throw new Error("Desktop preferences changed while taking the snapshot");
      const exported = join(temporary, "preferences.json");
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      await runFile(
        electron,
        [join(root, "scripts/dev-seed-desktop-profile-electron.cjs"), "export", profile, exported],
        { env, timeout: 40000, killSignal: "SIGKILL" },
      );
      const snapshot = JSON.parse(await readFile(exported, "utf8"));
      snapshot.windowState = await optionalJson(join(source, "window-state.json"));
      snapshot.playSound = (
        await optionalJson(join(source, "desktop-settings.json"))
      )?.settings?.notifications?.playSound;
      const output = join(root, ".dev/desktop-preferences.json");
      await mkdir(dirname(output), { recursive: true });
      await writeFile(`${output}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      await rename(`${output}.tmp`, output);
      console.log(
        `Seeded desktop preferences from ${source}. Restart the dev desktop to load them.`,
      );
      return output;
    } catch (error) {
      lastError = error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  throw new Error(`Could not snapshot desktop profile ${source}: ${lastError.message}`, {
    cause: lastError,
  });
}
if (isMainModule(import.meta.url))
  await seedDesktopProfile({
    sourceProfile:
      process.argv[2] ?? process.env.PASEO_DEV_SOURCE_DESKTOP_PROFILE ?? defaultDesktopProfile(),
  });
