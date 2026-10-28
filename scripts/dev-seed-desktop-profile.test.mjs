import assert from "node:assert/strict";
import test from "node:test";
import { defaultDesktopProfile } from "./dev-seed-desktop-profile.mjs";
import policy from "./dev-seed-desktop-profile-policy.cjs";

test("desktop profile defaults respect platform app data", () => {
  assert.equal(
    defaultDesktopProfile("darwin", "/home/test", {}),
    "/home/test/Library/Application Support/Paseo",
  );
  assert.equal(
    defaultDesktopProfile("linux", "/home/test", { XDG_CONFIG_HOME: "/config" }),
    "/config/Paseo",
  );
  assert.equal(
    defaultDesktopProfile("win32", "/home/test", { APPDATA: "/roaming" }),
    "/roaming/Paseo",
  );
});

test("preference export excludes host connections, sessions, filters and workspace state", () => {
  const selected = policy.selectPreferences({
    "@paseo:app-settings": '{"theme":"dark"}',
    "@paseo:host-connections": "secret",
    "@paseo:client-id": "production-client",
    "paseo-drafts": "private drafts",
    "sidebar-view": JSON.stringify({
      version: 2,
      state: {
        groupMode: "status",
        workspaceSort: "recent",
        hostFilters: ["production"],
        projectFilters: ["project"],
      },
    }),
    "panel-state": JSON.stringify({
      version: 1,
      state: { sidebarWidth: 320, expandedPathsByWorkspace: { production: ["private"] } },
    }),
  });
  assert.equal(selected["@paseo:app-settings"], '{"theme":"dark"}');
  assert.deepEqual(Object.keys(selected), ["@paseo:app-settings", "sidebar-view", "panel-state"]);
  assert.deepEqual(JSON.parse(selected["sidebar-view"]), {
    version: 2,
    state: { groupMode: "status", workspaceSort: "recent" },
  });
  assert.deepEqual(JSON.parse(selected["panel-state"]), {
    version: 1,
    state: { sidebarWidth: 320 },
  });
});

test(
  "Electron import preserves dev edits, seeds new origins and refreshes changed snapshots",
  { skip: process.env.PASEO_TEST_DESKTOP_PROFILE !== "1" },
  async () => {
    const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const { createRequire } = await import("node:module");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
    const electron = require("electron");
    const temporary = await mkdtemp(join(tmpdir(), "paseo-profile-test-"));
    const snapshot = join(temporary, "snapshot.json");
    const probe = join(temporary, "probe.cjs");
    const helper = resolve(import.meta.dirname, "dev-seed-desktop-profile-electron.cjs");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = (script, args) =>
      promisify(execFile)(electron, [script, ...args], {
        env,
        timeout: 30000,
        killSignal: "SIGKILL",
      });
    const original = {
      version: 1,
      settings: {
        daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
        notifications: { playSound: true },
      },
      migrations: { legacyRendererSettingsImported: true },
    };
    const source = {
      version: 1,
      localStorage: { "@paseo:app-settings": '{"theme":"dark"}' },
      playSound: false,
      windowState: { version: 1, state: { width: 1234, height: 876, isMaximized: false } },
    };
    const first = "http://localhost:45671";
    const second = "http://localhost:45672";
    try {
      await writeFile(join(temporary, "desktop-settings.json"), JSON.stringify(original));
      await writeFile(snapshot, JSON.stringify(source));
      await writeFile(
        probe,
        `
      const {app, BrowserWindow, protocol} = require("electron");
      const {writeFileSync} = require('node:fs');
      const [profile,url,output,replacement] = process.argv.slice(2);
      app.disableHardwareAcceleration(); app.setPath('userData',profile); app.setPath('sessionData',profile);
      app.whenReady().then(async () => {
        app.dock?.hide();
        protocol.handle('http', () => new Response('<!doctype html>'));
        const win = new BrowserWindow({show:false, webPreferences:{backgroundThrottling:false}});
        await win.loadURL(url);
        const value = await win.webContents.executeJavaScript('localStorage.getItem("@paseo:app-settings")');
        writeFileSync(output, value);
        if(replacement) await win.webContents.executeJavaScript('localStorage.setItem("@paseo:app-settings", '+JSON.stringify(replacement)+')');
        win.webContents.session.flushStorageData(); win.destroy(); setTimeout(() => app.exit(0), 2000); app.quit();
      }).catch(error => { console.error(error); app.exit(1); });
    `,
      );
      async function inspect(url, replacement) {
        const output = join(temporary, "result.json");
        await run(probe, [temporary, url, output, ...(replacement ? [replacement] : [])]);
        return JSON.parse(await readFile(output, "utf8"));
      }
      await run(helper, ["import", temporary, snapshot, first]);
      assert.deepEqual(await inspect(first, '{"theme":"light"}'), { theme: "dark" });
      const settings = JSON.parse(await readFile(join(temporary, "desktop-settings.json"), "utf8"));
      assert.deepEqual(settings, {
        ...original,
        settings: { ...original.settings, notifications: { playSound: false } },
      });
      assert.deepEqual(
        JSON.parse(await readFile(join(temporary, "window-state.json"), "utf8")),
        source.windowState,
      );
      await run(helper, ["import", temporary, snapshot, first]);
      assert.deepEqual(await inspect(first), { theme: "light" });
      await run(helper, ["import", temporary, snapshot, second]);
      assert.deepEqual(await inspect(second), { theme: "dark" });
      source.localStorage["@paseo:app-settings"] = '{"theme":"system"}';
      await writeFile(snapshot, JSON.stringify(source));
      await run(helper, ["import", temporary, snapshot, first]);
      assert.deepEqual(await inspect(first), { theme: "system" });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

test("legacy renderer settings cannot change dev daemon or release controls", () => {
  for (const key of ["@paseo:app-settings", "@paseo:settings"]) {
    const result = policy.selectPreferences({
      [key]: JSON.stringify({ theme: "dark", manageBuiltInDaemon: true, releaseChannel: "beta" }),
    });
    assert.deepEqual(JSON.parse(result[key]), { theme: "dark" });
  }
});

test("one malformed preference does not prevent other settings from being seeded", () => {
  const result = policy.selectPreferences({
    "panel-state": "broken",
    "sidebar-view": "null",
    "@paseo:app-settings": "[]",
    "@paseo:preferred-editor": "vscode",
  });
  assert.deepEqual(result, { "@paseo:preferred-editor": "vscode" });
});
