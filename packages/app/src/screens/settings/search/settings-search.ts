import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import type { SettingsSearchEntry, SettingsSearchLabel } from "./settings-search-index";

export type SettingsSearchTarget =
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "host"; section: HostSectionSlug };

/** A searchable setting, already translated for the current locale. */
export interface SettingsSearchDoc {
  id: string;
  target: SettingsSearchTarget;
  title: string;
  hint?: string;
  /** Where the setting lives, shown under the title ("Appearance", "Host · Agents"). */
  location: string;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function rank(doc: SettingsSearchDoc, query: string, tokens: string[]): number | null {
  const title = normalize(doc.title);
  const haystack = `${title} ${normalize(doc.location)} ${normalize(doc.hint ?? "")}`;
  if (!tokens.every((token) => haystack.includes(token))) return null;
  if (title.startsWith(query)) return 0;
  if (title.includes(query)) return 1;
  if (tokens.every((token) => title.includes(token))) return 2;
  return 3;
}

/** Docs matching every query word, best title matches first, index order within a rank. */
export function searchSettings(docs: SettingsSearchDoc[], query: string): SettingsSearchDoc[] {
  const normalized = normalize(query).trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const tokens = normalized.split(" ");
  return docs
    .map((doc, index) => ({ doc, index, rank: rank(doc, normalized, tokens) }))
    .filter((entry): entry is typeof entry & { rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.doc);
}

export interface SettingsSearchSection<T extends SettingsSearchTarget["section"]> {
  id: T;
  label: string;
}

export interface BuildSettingsSearchDocsInput {
  entries: SettingsSearchEntry[];
  /** App sections available on this platform, in sidebar order. */
  appSections: SettingsSearchSection<SettingsSectionSlug>[];
  /** Host sections, or empty when there is no host to scope them to. */
  hostSections: SettingsSearchSection<HostSectionSlug>[];
  appGroupLabel: string;
  hostGroupLabel: string;
  isDesktopApp: boolean;
  isWeb: boolean;
  translate: (key: string) => string;
}

export function buildSettingsSearchDocs(input: BuildSettingsSearchDocsInput): SettingsSearchDoc[] {
  const resolve = (label: SettingsSearchLabel) =>
    typeof label === "string" ? input.translate(label) : label.text;
  const appLabels = new Map(input.appSections.map((section) => [section.id, section.label]));
  const hostLabels = new Map(input.hostSections.map((section) => [section.id, section.label]));
  const locationOf = (target: SettingsSearchTarget): string | undefined => {
    if (target.kind === "section") return appLabels.get(target.section);
    const label = hostLabels.get(target.section);
    return label === undefined ? undefined : `${input.hostGroupLabel} · ${label}`;
  };

  const sectionDocs: SettingsSearchDoc[] = [
    ...input.appSections.map((section) => ({
      id: `section:${section.id}`,
      target: { kind: "section", section: section.id } as const,
      title: section.label,
      location: input.appGroupLabel,
    })),
    ...input.hostSections.map((section) => ({
      id: `host:${section.id}`,
      target: { kind: "host", section: section.id } as const,
      title: section.label,
      location: input.hostGroupLabel,
    })),
  ];

  const entryDocs = input.entries.flatMap((entry, index): SettingsSearchDoc[] => {
    if (entry.desktopOnly && !input.isDesktopApp) return [];
    if (entry.webOnly && !input.isWeb) return [];
    const location = locationOf(entry.target);
    if (location === undefined) return [];
    return [
      {
        id: `entry:${index}`,
        target: entry.target,
        title: resolve(entry.title),
        hint: entry.hint === undefined ? undefined : resolve(entry.hint),
        location,
      },
    ];
  });

  return [...sectionDocs, ...entryDocs];
}
