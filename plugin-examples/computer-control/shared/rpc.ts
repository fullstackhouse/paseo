import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const taskSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["queued", "active", "holding", "human", "recovery", "completed", "cancelled"]),
  revision: z.number(),
  createdAt: z.string(),
  session: z.string(),
  targetId: z.string().optional(),
  humanReason: z.string().optional(),
  cancelRequested: z.boolean(),
});
export const configSchema = z.object({
  enabled: z.boolean(),
  binaryPath: z.string().min(1),
  cdpEndpoint: z.string().min(1),
});
export const statusRpc = defineRpc({
  name: "control.status",
  input: z.object({}),
  output: z.object({
    tasks: z.array(taskSchema),
    config: configSchema,
    error: z.string().nullable(),
  }),
});
export const configureRpc = defineRpc({
  name: "control.configure",
  input: configSchema,
  output: z.object({ ok: z.boolean() }),
});
export const actionRpc = defineRpc({
  name: "control.action",
  input: z.object({
    taskId: z.string(),
    revision: z.number().int(),
    action: z.enum(["takeover", "continue", "cancel", "recover"]),
  }),
  output: taskSchema,
});
