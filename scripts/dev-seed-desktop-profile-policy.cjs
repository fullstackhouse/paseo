const preferenceKeys = new Set([
  "@paseo:app-settings",
  "@paseo:settings",
  "@paseo:settings-migrations",
  "@paseo:changes-preferences",
  "@paseo:preferred-editor",
  "@paseo:keyboard-shortcut-overrides",
  "@paseo:create-agent-preferences",
  "@paseo:sidebar-callout-dismissals",
]);
const layoutFields = {
  "panel-state": [
    "desktop",
    "sidebarWidth",
    "explorerSortOption",
    "explorerShowHiddenFiles",
    "treeRailWidth",
    "fileTreeVisible",
  ],
  "sidebar-view": ["showBackground", "groupMode", "workspaceSort"],
  "sidebar-group-mode": ["groupMode"],
};
function parseObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function selectPreferences(entries) {
  const selected = {};
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== "string") continue;
    if (key === "@paseo:app-settings" || key === "@paseo:settings") {
      const settings = parseObject(value);
      if (!settings) continue;
      delete settings.manageBuiltInDaemon;
      delete settings.releaseChannel;
      selected[key] = JSON.stringify(settings);
    } else if (preferenceKeys.has(key)) selected[key] = value;
    else if (Object.hasOwn(layoutFields, key)) {
      const document = parseObject(value);
      if (!document?.state || typeof document.state !== "object") continue;
      selected[key] = JSON.stringify({
        ...("version" in document ? { version: document.version } : {}),
        state: Object.fromEntries(
          layoutFields[key]
            .filter((field) => Object.hasOwn(document.state, field))
            .map((field) => [field, document.state[field]]),
        ),
      });
    }
  }
  return selected;
}
module.exports = { selectPreferences };
