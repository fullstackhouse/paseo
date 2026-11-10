import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { markdownReferences } from "./references";

export interface MarkdownBlockRange {
  startLine: number;
  endLine: number;
}

/** Split only at annotated top-level blocks; preserve untouched Markdown and document references. */
export function annotateMarkdown<T>(
  source: string,
  afterBlock: (block: MarkdownBlockRange) => T,
): { source: string; startOffset: number; after?: T }[] {
  const tree = fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  const renderedBlocks = tree.children.filter((node) => node.type !== "definition");
  const blocks = renderedBlocks.length ? renderedBlocks : [tree];
  const parts: { source: string; startOffset: number; after?: T }[] = [];
  let cursor = 0;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const next = blocks[index + 1];
    const after = afterBlock({
      startLine: index === 0 ? 1 : block.position!.start.line,
      endLine: next ? next.position!.start.line - 1 : tree.position!.end.line,
    });
    if (after == null || after === false) continue;
    // Include indentation with the next block, since offsets can start after it.
    const end = next
      ? source.lastIndexOf("\n", next.position!.start.offset! - 1) + 1
      : source.length;
    parts.push({ source: source.slice(cursor, end), startOffset: cursor, after });
    cursor = end;
  }
  if (!parts.length) return [{ source, startOffset: 0 }];
  if (cursor < source.length) parts.push({ source: source.slice(cursor), startOffset: cursor });
  const references = markdownReferences(tree);
  if (references) for (const part of parts) part.source = `${references}\n\n${part.source}`;
  return parts;
}
