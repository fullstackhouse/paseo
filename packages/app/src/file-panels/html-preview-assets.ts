// The preview frame can load nothing but the document it is handed (see
// html-preview-csp.ts), so a page split into `index.html` + `styles.css` +
// `app.js` renders unstyled and inert. Before rendering, Paseo reads the
// stylesheets and scripts the page links from its own directory and inlines them.
// The policy stays as it is: inlined code is inline code, and it still cannot
// fetch anything.
//
// Inlined text becomes part of the page, and a page can still leak its own
// contents by navigating (see html-preview-csp.ts). So the page must not get to
// pick arbitrary files: only `.css` stylesheets and `.js`/`.mjs` scripts inside
// the HTML file's directory are read, never a hidden file or folder. A page
// linking `.env` or `../secrets.json` gets nothing. Anything else is left
// untouched and stays blocked by the policy.
//
// Tags are found with patterns rather than a parser: a miss leaves the tag to fail
// as it did before, and a false hit inlines an allowed file the page could have
// linked anyway. `url()` and `@import` inside the inlined CSS still do not load.

const MAX_ASSETS = 64;

const LINK_TAG = /<link\b[^>]*>/gi;
const SCRIPT_TAG = /<script\b([^>]*)>\s*<\/script\s*>/gi;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Reads a file by its path relative to the HTML file's directory; `null` when it cannot. */
export type ReadLocalAsset = (relativePath: string) => Promise<string | null>;

const STYLESHEET = /\.css$/i;
const SCRIPT = /\.m?js$/i;

/**
 * The normalized path of `reference` relative to the page's directory, or `null` when it is not a
 * plain relative path that stays inside that directory and avoids hidden files and folders.
 */
export function resolveLocalAssetPath(reference: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.includes("\\")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("/")) return null;
  const withoutSuffix = trimmed.replace(/[?#].*$/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments: string[] = [];
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    if (segment.startsWith(".")) return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

/** `html` with its same-directory stylesheets and scripts inlined. */
export async function inlineLocalAssets(html: string, read: ReadLocalAsset): Promise<string> {
  const replacements: Replacement[] = [];

  for (const match of html.matchAll(LINK_TAG)) {
    const attributes = parseAttributes(match[0].slice("<link".length, -1));
    const rel = attributes.get("rel")?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes("stylesheet")) continue;
    const path = resolveLocalAssetPath(attributes.get("href") ?? "");
    if (!path || !STYLESHEET.test(path)) continue;
    const media = attributes.get("media");
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      path,
      build: (css) =>
        `<style${media ? ` media="${escapeAttribute(media)}"` : ""}>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
    });
  }

  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attributes = parseAttributes(match[1]);
    const path = resolveLocalAssetPath(attributes.get("src") ?? "");
    if (!path || !SCRIPT.test(path)) continue;
    const type = attributes.get("type");
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      path,
      build: (js) =>
        `<script${type ? ` type="${escapeAttribute(type)}"` : ""}>${js.replace(/<\/script/gi, "<\\/script")}</script>`,
    });
  }

  const wanted = replacements.sort((a, b) => a.start - b.start).slice(0, MAX_ASSETS);
  const contents = new Map<string, Promise<string | null>>();
  for (const { path } of wanted) {
    if (!contents.has(path))
      contents.set(
        path,
        read(path).catch(() => null),
      );
  }

  let output = "";
  let cursor = 0;
  for (const replacement of wanted) {
    if (replacement.start < cursor) continue;
    const content = await contents.get(replacement.path);
    if (content === null || content === undefined) continue;
    output += html.slice(cursor, replacement.start) + replacement.build(content);
    cursor = replacement.end;
  }
  return output + html.slice(cursor);
}

interface Replacement {
  start: number;
  end: number;
  path: string;
  build: (content: string) => string;
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (attributes.has(name)) continue;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The folder holding the file `path`, which is relative to `cwd` unless absolute or home-relative. */
export function pageDirectory({ cwd, path }: { cwd: string; path: string }): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parent = separator < 0 ? "" : path.slice(0, separator) || path.slice(0, 1);
  if (isAbsolute(path)) return parent;
  if (!parent) return cwd;
  return `${cwd.replace(/[\\/]+$/, "")}/${parent}`;
}

function isAbsolute(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("~/") ||
    /^[a-z]:[\\/]/i.test(path) ||
    path.startsWith("\\\\")
  );
}
