import { useEffect, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { FileTarget } from "./file";
import { decodeUtf8 } from "@/utils/decode-utf8";
import { inlineLocalAssets, pageDirectory } from "./html-preview-assets";

/** Larger assets are left out rather than stalling the preview. */
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/**
 * The page with its same-directory stylesheets and scripts inlined, or `null` until the first
 * version is ready. Later versions replace it once their assets are read, so an edit does not
 * flash the unstyled page.
 */
export function useHtmlPreviewDocument(input: {
  html: string;
  target: FileTarget | null;
  client: DaemonClient | null;
}): string | null {
  const { html, target, client } = input;
  const cwd = target?.cwd ?? null;
  const path = target?.path ?? null;
  const [document, setDocument] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !cwd || !path) {
      setDocument(html);
      return;
    }
    let active = true;
    // The page's own folder is the read root: the daemon resolves symlinks and refuses any read
    // that lands outside it, so a linked `theme.css` that points at a credentials file reads
    // nothing.
    const directory = pageDirectory({ cwd, path });
    const read = async (relativePath: string) => {
      const file = await client.readFile(directory, relativePath, undefined, MAX_ASSET_BYTES);
      return file.kind === "text" ? decodeUtf8(file.bytes) : null;
    };
    const load = async () => {
      const next = await inlineLocalAssets(html, read);
      if (active) setDocument(next);
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, cwd, html, path]);

  return document;
}
