import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentAttachment } from "@getpaseo/protocol/messages";

import type { AgentTimelineItem } from "../agent-sdk-types.js";

export interface ProviderImageOutput {
  path?: string | null;
  url?: string | null;
  data?: string | null;
  mimeType?: string | null;
  altText?: string | null;
}

export interface MaterializedProviderImage {
  path: string;
}

const PROVIDER_IMAGE_ATTACHMENT_DIR = "paseo-attachments";
const PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX = `${PROVIDER_IMAGE_ATTACHMENT_DIR}-`;
const PRIVATE_ATTACHMENT_DIR_MODE = 0o700;
const MATERIALIZED_IMAGE_FILE_MODE = 0o600;

let materializedImageAttachmentDir: string | null = null;
// Serialize materializations: one decoder and one file operation at a time, including
// concurrent history replay and live turns. A rejected operation must not poison the queue.
let pendingMaterialization: Promise<unknown> = Promise.resolve();

async function getMaterializedImageAttachmentDir(): Promise<string> {
  if (materializedImageAttachmentDir) {
    try {
      const stats = await fs.lstat(materializedImageAttachmentDir);
      if (stats.isDirectory()) {
        await fs.chmod(materializedImageAttachmentDir, PRIVATE_ATTACHMENT_DIR_MODE);
        return materializedImageAttachmentDir;
      }
    } catch {
      /* Temp storage may have been removed between turns. */
    }
  }
  materializedImageAttachmentDir = await fs.mkdtemp(
    path.join(os.tmpdir(), PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX),
  );
  await fs.chmod(materializedImageAttachmentDir, PRIVATE_ATTACHMENT_DIR_MODE);
  return materializedImageAttachmentDir;
}

function getImageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

// 128 MiB admits the measured 64 MiB fixture with headroom while bounding disk
// and decoding per image. This is materialization admission, not a wire schema limit.
export const MAX_PROVIDER_IMAGE_BYTES = 128 * 1024 * 1024;
const BASE64_CHUNK_CHARACTERS = 256 * 1024; // Multiple of four; decode units stay aligned.

export function materializeProviderImage(image: {
  data: string;
  mimeType: string | null;
}): Promise<MaterializedProviderImage> {
  const result = pendingMaterialization.then(() => materializeImage(image));
  pendingMaterialization = result.catch(() => {});
  return result;
}

async function materializeImage(image: {
  data: string;
  mimeType: string | null;
}): Promise<MaterializedProviderImage> {
  const maxEncodedCharacters = Math.ceil(MAX_PROVIDER_IMAGE_BYTES / 3) * 4;
  // Check length before inspecting/copying the payload, including a bounded data URI header.
  if (image.data.length > maxEncodedCharacters + 256) {
    throw new Error(`Image attachment exceeds ${MAX_PROVIDER_IMAGE_BYTES} bytes`);
  }
  let data = image.data;
  let mimeType = image.mimeType ?? "image/png";
  if (data.startsWith("data:")) {
    const separator = data.indexOf(";base64,");
    if (separator >= 0 && separator < 256) {
      mimeType = data.slice(5, separator);
      data = data.slice(separator + 8);
    }
  }
  if (data.length > maxEncodedCharacters) {
    throw new Error(`Image attachment exceeds ${MAX_PROVIDER_IMAGE_BYTES} bytes`);
  }
  const hash = createHash("sha256");
  for await (const bytes of decodeImage(data)) hash.update(bytes);
  const dir = await getMaterializedImageAttachmentDir();
  const filePath = path.join(dir, `${hash.digest("hex")}.${getImageExtension(mimeType)}`);
  try {
    await fs.stat(filePath);
    return { path: filePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const staging = await fs.mkdtemp(path.join(dir, ".pending-"));
  const stagingPath = path.join(staging, "image");
  try {
    await fs.chmod(staging, PRIVATE_ATTACHMENT_DIR_MODE);
    const file = await fs.open(stagingPath, "wx", MATERIALIZED_IMAGE_FILE_MODE);
    try {
      await file.chmod(MATERIALIZED_IMAGE_FILE_MODE);
      // Decode again only for a new hash. This bounds retained memory to one chunk
      // and performs no writes at all for repeated content, including history replay.
      for await (const bytes of decodeImage(data)) await file.writeFile(bytes);
    } finally {
      await file.close();
    }
    await fs.rename(stagingPath, filePath);
    return { path: filePath };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function* decodeImage(data: string): AsyncGenerator<Buffer> {
  let carry = "";
  let decodedBytes = 0;
  for (let offset = 0; offset < data.length; offset += BASE64_CHUNK_CHARACTERS) {
    // Buffer.from ignores non-base64 characters. Carry incomplete quartets so
    // line-wrapped payloads decode identically across chunk boundaries.
    const chunk =
      carry +
      data.slice(offset, offset + BASE64_CHUNK_CHARACTERS).replace(/[^A-Za-z0-9+/_=-]/g, "");
    const finalChunk = offset + BASE64_CHUNK_CHARACTERS >= data.length || chunk.includes("=");
    const end = finalChunk ? chunk.length : chunk.length - (chunk.length % 4);
    const bytes = Buffer.from(chunk.slice(0, end), "base64");
    carry = chunk.slice(end);
    decodedBytes += bytes.length;
    if (decodedBytes > MAX_PROVIDER_IMAGE_BYTES)
      throw new Error("Image attachment exceeds size limit");
    yield bytes;
    await setImmediate();
    if (finalChunk) break;
  }
}

// Recognizes markdown rendered for a materialized provider image: its source is a content-hashed
// file in the attachments dir. Matching the full <hash>.<ext> shape (not just a leading "![")
// keeps user-authored text from being mistaken for a provider image during history replay. The
// separator still accepts old doubled-backslash Windows history; new Windows output uses file URIs.
const PROVIDER_IMAGE_MARKDOWN = new RegExp(
  `^!\\[[^\\]]*\\]\\([^)]*${PROVIDER_IMAGE_ATTACHMENT_DIR}(?:-[^/\\\\)]+)?[/\\\\]+(?:[^/\\\\)]+[/\\\\]+)?[0-9a-f]{64}\\.[a-z0-9]+\\)`,
);

export function isProviderImageMarkdown(text: string): boolean {
  return PROVIDER_IMAGE_MARKDOWN.test(text.trimStart());
}

interface RenderProviderImageOutputOptions {
  materialize?: (image: {
    data: string;
    mimeType: string | null;
  }) => Promise<MaterializedProviderImage>;
}

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isDataImageSource(source: string): boolean {
  return source.trim().toLowerCase().startsWith("data:image/");
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function encodeFilePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function windowsFileUri(value: string): string | null {
  const isWindowsNetworkPath = value.startsWith("\\\\");
  let normalizedPath = value.replace(/\\/g, "/");
  if (/^\/\/\?\/UNC\//i.test(normalizedPath)) {
    normalizedPath = `//${normalizedPath.slice(8)}`;
  } else if (/^\/\/\?\/[A-Za-z]:\//.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice(4);
  }

  if (/^[A-Za-z]:\//.test(normalizedPath)) {
    const drive = normalizedPath.slice(0, 2);
    return `file:///${drive}${encodeFilePath(normalizedPath.slice(2))}`;
  }
  if (isWindowsNetworkPath && normalizedPath.startsWith("//")) {
    return `file:${encodeFilePath(normalizedPath)}`;
  }
  return null;
}

function markdownImageSource(value: string): string {
  const windowsUri = windowsFileUri(value);
  if (windowsUri) {
    return windowsUri;
  }
  if (value.startsWith("/")) {
    return `file://${encodeFilePath(value)}`;
  }
  return value;
}

function escapeMarkdownImageSource(value: string): string {
  return markdownImageSource(value).replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}

export async function renderProviderImageOutputAsAssistantMarkdown(
  image: ProviderImageOutput,
  options: RenderProviderImageOutputOptions = {},
): Promise<AgentTimelineItem | null> {
  const source = nonEmptyString(image.path) ?? nonEmptyString(image.url);
  if (source && !isDataImageSource(source)) {
    const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
    return {
      type: "assistant_message",
      // Image outputs remain standalone paragraphs when adjacent assistant chunks merge.
      text: `\n\n![${altText}](${escapeMarkdownImageSource(source)})\n\n`,
    };
  }

  const data = nonEmptyString(image.data) ?? (source && isDataImageSource(source) ? source : null);
  if (!data) {
    return null;
  }

  let materialized: MaterializedProviderImage | null = null;
  try {
    materialized = options.materialize
      ? await options.materialize({
          data,
          mimeType: nonEmptyString(image.mimeType),
        })
      : null;
  } catch {
    materialized = null;
  }
  if (!materialized?.path || isDataImageSource(materialized.path)) {
    return {
      type: "assistant_message",
      text: "Image output was omitted because it was not available as a file path or URL.",
    };
  }

  const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
  return {
    type: "assistant_message",
    text: `\n\n![${altText}](${escapeMarkdownImageSource(materialized.path)})\n\n`,
  };
}

// Images the agent saw in a forked chat. Kept under provider per-image limits (Claude rejects
// images over 5 MB) and capped in count so a long history doesn't flood the first prompt.
const MAX_HISTORY_IMAGES = 10;
const MAX_HISTORY_IMAGE_BYTES = 5 * 1024 * 1024;
const MARKDOWN_IMAGE = /!\[(?:[^\]\\]|\\.)*\]\(((?:[^)\\]|\\.)+)\)/g;
const MATERIALIZED_IMAGE_NAME = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;
const HISTORY_IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function markdownSourceToPath(source: string): string | null {
  const unescaped = source.replace(/\\([\\)])/g, "$1");
  if (!unescaped.toLowerCase().startsWith("file:")) return unescaped;
  try {
    return fileURLToPath(unescaped);
  } catch {
    return null;
  }
}

/** Paths of materialized provider images referenced in text, oldest first, without repeats. */
export function findProviderImagePaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE)) {
    if (!isProviderImageMarkdown(match[0])) continue;
    const filePath = markdownSourceToPath(match[1]!);
    if (!filePath) continue;
    const existing = paths.indexOf(filePath);
    if (existing >= 0) paths.splice(existing, 1);
    paths.push(filePath);
  }
  return paths;
}

async function readHistoryImage(
  filePath: string,
  tmpDir: string,
): Promise<{ data: string; mimeType: string } | null> {
  const name = MATERIALIZED_IMAGE_NAME.exec(path.basename(filePath));
  if (!name) return null;
  try {
    // Only read files Paseo materialized itself: <tmpdir>/paseo-attachments-*/<sha256>.<ext>.
    const realPath = await fs.realpath(filePath);
    const dir = path.dirname(realPath);
    if (
      path.dirname(dir) !== tmpDir ||
      !path.basename(dir).startsWith(PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX)
    ) {
      return null;
    }
    const stats = await fs.lstat(realPath);
    if (!stats.isFile() || stats.size > MAX_HISTORY_IMAGE_BYTES) return null;
    const bytes = await fs.readFile(realPath);
    return { data: bytes.toString("base64"), mimeType: HISTORY_IMAGE_MIME_TYPES[name[1]!]! };
  } catch {
    // Temp storage is cleared by the OS; a missing image stays a link in the history text.
    return null;
  }
}

/**
 * Loads the images a chat history attachment refers to, so a forked agent sees them instead of
 * a file link. Keeps the most recent ones when the history holds more than the cap.
 */
export async function loadChatHistoryImages(
  attachments: readonly AgentAttachment[] | undefined,
): Promise<Array<{ data: string; mimeType: string }>> {
  const paths = (attachments ?? []).flatMap((attachment) =>
    attachment.type === "text" && attachment.contextKind === "chat_history"
      ? findProviderImagePaths(attachment.text)
      : [],
  );
  if (paths.length === 0) return [];
  let tmpDir: string;
  try {
    tmpDir = await fs.realpath(os.tmpdir());
  } catch {
    return [];
  }
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const filePath of paths.toReversed()) {
    if (images.length >= MAX_HISTORY_IMAGES) break;
    const image = await readHistoryImage(filePath, tmpDir);
    if (image) images.push(image);
  }
  return images.toReversed();
}
