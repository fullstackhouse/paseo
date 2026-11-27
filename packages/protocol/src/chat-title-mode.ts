import { z } from "zod";

/**
 * FSH: how a new chat gets its title. first-prompt: the first line of the first message.
 * generated: a short title generated once from the first message. agent: follows the title the
 * agent gives its own session, for providers that keep one; others fall back to generated.
 *
 * Its own module so the persisted config can share it without loading the wire schemas in
 * `messages.ts`.
 */
export const ChatTitleModeSchema = z.enum(["first-prompt", "generated", "agent"]);
export type ChatTitleMode = z.infer<typeof ChatTitleModeSchema>;
