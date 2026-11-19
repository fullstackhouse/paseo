import { describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import { SETTINGS_SEARCH_ENTRIES } from "./settings-search-index";
import { buildSettingsSearchDocs, searchSettings, type SettingsSearchDoc } from "./settings-search";

function translateEn(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => {
    return typeof node === "object" && node !== null
      ? (node as Record<string, unknown>)[part]
      : undefined;
  }, en);
  if (typeof value !== "string") throw new Error(`Missing en string for ${key}`);
  return value;
}

function buildDocs(
  overrides: { isDesktopApp?: boolean; isWeb?: boolean; withHost?: boolean } = {},
) {
  return buildSettingsSearchDocs({
    entries: SETTINGS_SEARCH_ENTRIES,
    appSections: [
      { id: "general", label: "General" },
      { id: "appearance", label: "Appearance" },
      { id: "chat", label: "Chat" },
      { id: "about", label: "About" },
    ],
    hostSections:
      overrides.withHost === false
        ? []
        : [
            { id: "host", label: "Host" },
            { id: "agents", label: "Agents" },
          ],
    appGroupLabel: "App",
    hostGroupLabel: "Host",
    isDesktopApp: overrides.isDesktopApp ?? false,
    isWeb: overrides.isWeb ?? false,
    translate: translateEn,
  });
}

const titles = (docs: SettingsSearchDoc[]) => docs.map((doc) => doc.title);

describe("settings search index", () => {
  it("only references i18n keys that exist", () => {
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      for (const label of [entry.title, entry.hint]) {
        if (typeof label === "string") expect(() => translateEn(label)).not.toThrow();
      }
    }
  });
});

describe("searchSettings", () => {
  it("returns nothing for an empty query", () => {
    expect(searchSettings(buildDocs(), "   ")).toEqual([]);
  });

  it("finds individual settings and names the section they live in", () => {
    const [first] = searchSettings(buildDocs(), "code font");
    expect(first).toMatchObject({
      title: "Code font",
      location: "Appearance",
      target: { kind: "section", section: "appearance" },
    });
  });

  it("marks setting rows as revealable and whole sections as not", () => {
    const docs = buildDocs();
    expect(searchSettings(docs, "code font")[0]?.revealsRow).toBe(true);
    expect(searchSettings(docs, "appear")[0]?.revealsRow).toBe(false);
  });

  it("finds section names", () => {
    expect(searchSettings(buildDocs(), "appear")[0]).toMatchObject({
      title: "Appearance",
      target: { kind: "section", section: "appearance" },
    });
  });

  it("ranks title prefix matches before hint-only matches", () => {
    const results = titles(searchSettings(buildDocs(), "theme"));
    expect(results[0]).toBe("Theme");
    expect(results).toContain("Highlight theme");
  });

  it("matches words in any order, across title, hint and location, ignoring case and accents", () => {
    expect(titles(searchSettings(buildDocs(), "REASONING always"))).toContain(
      "Always expand reasoning",
    );
    expect(titles(searchSettings(buildDocs(), "chain-of-thought"))).toContain(
      "Always expand reasoning",
    );
    expect(titles(searchSettings(buildDocs(), "lánguage"))).toContain("Language");
  });

  it("scopes host settings to the host group", () => {
    expect(searchSettings(buildDocs(), "restart daemon")[0]).toMatchObject({
      location: "Host · Host",
      target: { kind: "host", section: "host" },
    });
    expect(searchSettings(buildDocs({ withHost: false }), "restart daemon")).toEqual([]);
  });

  it("drops settings for sections or platforms that are not available", () => {
    // Terminal section is not in the available app sections above.
    expect(searchSettings(buildDocs(), "scrollback")).toEqual([]);
    expect(titles(searchSettings(buildDocs(), "updates when idle"))).toEqual([]);
    expect(titles(searchSettings(buildDocs({ isDesktopApp: true }), "updates when idle"))).toEqual([
      "Install updates when idle",
    ]);
  });
});
