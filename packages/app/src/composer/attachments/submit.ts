import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment } from "@/composer/types";
import {
  isWorkspaceAttachment,
  workspaceAttachmentToSubmitAttachment,
} from "@/attachments/workspace-attachment-utils";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  buildForgeAttachmentFromSearchItem,
  buildLegacyGitHubAttachmentFromSearchItem,
} from "@/utils/review-attachments";
import { workspaceFileAttachmentToAgentAttachment } from "@/attachments/workspace-file";
import { pluginResourceAttachmentToAgentAttachment } from "@/plugins/attachments";

export type ComposerAttachmentSubmitFormat = "forge" | "legacy-github";

interface SplitComposerAttachmentsOptions {
  format?: ComposerAttachmentSubmitFormat;
}

export function resolveComposerAttachmentSubmitFormat(input: {
  supportsForgeAttachments?: boolean;
}): ComposerAttachmentSubmitFormat {
  // COMPAT(githubAttachmentKinds): emit legacy GitHub attachments for daemons
  // predating forge-neutral attachments. Remove after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  return input.supportsForgeAttachments === false ? "legacy-github" : "forge";
}

export function splitComposerAttachmentsForSubmit(
  attachments: ComposerAttachment[],
  options: SplitComposerAttachmentsOptions = {},
): {
  images: ImageAttachment[];
  attachments: AgentAttachment[];
} {
  const images: ImageAttachment[] = [];
  const agentAttachments: AgentAttachment[] = [];
  // COMPAT(githubAttachmentKinds): emit legacy GitHub attachments for daemons
  // predating forge-neutral attachments. Remove after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  const buildSearchAttachment =
    options.format === "legacy-github"
      ? buildLegacyGitHubAttachmentFromSearchItem
      : buildForgeAttachmentFromSearchItem;

  for (const attachment of attachments) {
    // Quotes travel in the message text; see `prependComposerQuotes`.
    if (attachment.kind === "quote") {
      continue;
    }

    if (attachment.kind === "image") {
      images.push(attachment.metadata);
      continue;
    }

    if (attachment.kind === "file") {
      agentAttachments.push(attachment.attachment);
      continue;
    }

    if (attachment.kind === "workspace_file") {
      agentAttachments.push(workspaceFileAttachmentToAgentAttachment(attachment));
      continue;
    }

    if (attachment.kind === "plugin_resource") {
      agentAttachments.push(pluginResourceAttachmentToAgentAttachment(attachment));
      continue;
    }

    if (isWorkspaceAttachment(attachment)) {
      if (attachment.kind === "browser_element" && attachment.attachment.screenshot) {
        images.push(attachment.attachment.screenshot);
      }
      const workspaceAttachment = workspaceAttachmentToSubmitAttachment(attachment);
      if (workspaceAttachment) {
        agentAttachments.push(workspaceAttachment);
      }
      continue;
    }

    const reviewAttachment = buildSearchAttachment(attachment.item);
    if (reviewAttachment) {
      agentAttachments.push(reviewAttachment);
    }
  }

  return {
    images,
    attachments: agentAttachments,
  };
}

/**
 * Puts each cited fragment above the message as a markdown blockquote, followed by the
 * user's comment on it, in the order they were cited. Quotes live in the text rather than
 * as attachments so the agent reads them first and the sent message keeps them after the
 * daemon echoes it back.
 */
export function prependComposerQuotes(text: string, attachments: ComposerAttachment[]): string {
  const blocks = attachments.flatMap((attachment) => {
    if (attachment.kind !== "quote") return [];
    const quote = attachment.text
      .trim()
      .split(/\r?\n/)
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
    const comment = attachment.comment?.trim();
    // A comment whose quote was cleared still goes out, as plain text.
    return [attachment.text.trim() ? quote : "", comment ?? ""].filter(Boolean);
  });
  if (blocks.length === 0) {
    return text;
  }
  return [...blocks, text.trim()].filter(Boolean).join("\n\n");
}
