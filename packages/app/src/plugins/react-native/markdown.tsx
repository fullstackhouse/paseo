import { Fragment, useMemo } from "react";
import type { MarkdownProps } from "@getpaseo/plugin/client/ui";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { MarkdownBlockStack } from "@/components/markdown/block-stack";
import { annotateMarkdown } from "@/components/markdown/annotations";

export function Markdown({ children, compact, afterBlock }: MarkdownProps) {
  const parts = useMemo(
    () =>
      afterBlock ? annotateMarkdown(children, afterBlock) : [{ source: children, startOffset: 0 }],
    [children, afterBlock],
  );
  if (!children) return null;
  return (
    <MarkdownBlockStack>
      {parts.map((part) => (
        <Fragment key={part.startOffset}>
          <MarkdownRenderer text={part.source} compact={compact} />
          {part.after}
        </Fragment>
      ))}
    </MarkdownBlockStack>
  );
}
