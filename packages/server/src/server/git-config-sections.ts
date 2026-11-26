import { readFile } from "node:fs/promises";

/** A config section: `name` lowercased, `subsection` as written (`[branch "x"]` → branch, x). */
export interface GitConfigSection {
  name: string;
  subsection: string | null;
}

/** Each section's body, keyed by section. Repeated headers append to one body. */
export type GitConfigSections = Map<string, string>;

const SECTION_HEADER = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/;

function sectionKey(section: GitConfigSection): string {
  return `${section.name}\u0000${section.subsection ?? ""}`;
}

export function parseGitConfigSectionKey(key: string): GitConfigSection {
  const [name = "", subsection = ""] = key.split("\u0000");
  return { name, subsection: subsection.length > 0 ? subsection : null };
}

/**
 * Splits a git config file into section bodies so a write can be attributed to the sections it
 * touched. Whitespace and comment-only lines are dropped; anything else is kept verbatim, so an
 * edit this parser misreads still shows up as a change to some section.
 */
export function parseGitConfigSections(text: string): GitConfigSections {
  const sections: GitConfigSections = new Map();
  let current = sectionKey({ name: "", subsection: null });
  const append = (line: string) => {
    const previous = sections.get(current);
    sections.set(current, previous ? `${previous}\n${line}` : line);
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    const header = SECTION_HEADER.exec(line);
    if (!header) {
      append(line);
      continue;
    }
    const rawName = header[1] ?? "";
    let name = rawName.toLowerCase();
    let subsection = header[2] ?? null;
    // Deprecated `[branch.foo]` form: the subsection follows the first dot, lowercased by git.
    if (subsection === null && name.includes(".")) {
      const dot = name.indexOf(".");
      subsection = name.slice(dot + 1);
      name = name.slice(0, dot);
    }
    current = sectionKey({ name, subsection });
    if (!sections.has(current)) sections.set(current, "");
    const trailing = header[3]?.trim();
    if (trailing) append(trailing);
  }
  return sections;
}

export async function readGitConfigSections(path: string): Promise<GitConfigSections | null> {
  try {
    return parseGitConfigSections(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export function changedGitConfigSections(
  previous: GitConfigSections,
  next: GitConfigSections,
): GitConfigSection[] {
  const keys = new Set([...previous.keys(), ...next.keys()]);
  return [...keys]
    .filter((key) => previous.get(key) !== next.get(key))
    .map(parseGitConfigSectionKey);
}
