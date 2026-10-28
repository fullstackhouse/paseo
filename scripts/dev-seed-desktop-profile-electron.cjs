// Open only a temporary source snapshot or an idle, isolated dev profile.
const { app, BrowserWindow, protocol } = require("electron");
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { selectPreferences } = require("./dev-seed-desktop-profile-policy.cjs");
const [mode, userData, snapshotPath, url] = process.argv.slice(2);
app.disableHardwareAcceleration();
app.setPath("userData", userData);
app.setPath("sessionData", userData);
protocol.registerSchemesAsPrivileged([
  { scheme: "paseo", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (!app.requestSingleInstanceLock()) app.exit(1);
const timeout = setTimeout(() => app.exit(1), 30000);
app
  .whenReady()
  .then(async () => {
    app.dock?.hide();
    const originUrl = mode === "export" ? "paseo://app/" : url;
    if (
      mode !== "export" &&
      (mode !== "import" || !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(originUrl))
    ) {
      throw new Error("Expected export or import with a local Metro origin");
    }
    protocol.handle(
      mode === "export" ? "paseo" : "http",
      () =>
        new Response("<!doctype html><title>Preferences</title>", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await window.loadURL(originUrl);
    if (mode === "export") {
      const entries = await window.webContents.executeJavaScript(
        "Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))",
      );
      const localStorage = selectPreferences(entries);
      if (!Object.keys(localStorage).length)
        throw new Error("Desktop profile contains no Paseo preferences");
      writeFileSync(snapshotPath, JSON.stringify({ version: 1, localStorage }), { mode: 0o600 });
    } else {
      const serialized = readFileSync(snapshotPath, "utf8");
      const snapshot = JSON.parse(serialized);
      if (snapshot.version !== 1 || !snapshot.localStorage)
        throw new Error("Unsupported desktop preferences snapshot");
      const fingerprint = createHash("sha256").update(serialized).digest("hex");
      await window.webContents.executeJavaScript(`(() => {
      const marker = '@paseo:dev-profile-seed';
      if (localStorage.getItem(marker) === ${JSON.stringify(fingerprint)}) return false;
      for (const [key, value] of Object.entries(${JSON.stringify(selectPreferences(snapshot.localStorage))})) localStorage.setItem(key, value);
      localStorage.setItem(marker, ${JSON.stringify(fingerprint)});
      return true;
    })()`);
      // Native settings are shared across origins: reapply only for a new snapshot.
      const nativeMarker = join(userData, "dev-profile-seed.json");
      if (!existsSync(nativeMarker) || readFileSync(nativeMarker, "utf8") !== fingerprint) {
        if (snapshot.windowState)
          writeFileSync(join(userData, "window-state.json"), JSON.stringify(snapshot.windowState));
        if (typeof snapshot.playSound === "boolean") {
          const settingsPath = join(userData, "desktop-settings.json");
          const settings = existsSync(settingsPath)
            ? JSON.parse(readFileSync(settingsPath, "utf8"))
            : { version: 1 };
          settings.settings ??= {};
          settings.settings.notifications = {
            ...settings.settings.notifications,
            playSound: snapshot.playSound,
          };
          writeFileSync(settingsPath, JSON.stringify(settings));
        }
        writeFileSync(nativeMarker, fingerprint);
      }
      window.webContents.session.flushStorageData();
    }
    window.destroy();
    clearTimeout(timeout);
    // Chromium may keep a helper alive after window teardown; bound shutdown too.
    setTimeout(() => app.exit(0), 2000);
    app.quit();
    return undefined;
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
