export interface Owner {
  agentId: string;
  workspaceId: string | null;
}

export type TaskState =
  | "queued"
  | "active"
  | "holding"
  | "human"
  | "recovery"
  | "completed"
  | "cancelled";

export interface Task extends Owner {
  id: string;
  title: string;
  url: string;
  state: TaskState;
  revision: number;
  createdAt: string;
  session: string;
  targetId?: string;
  humanReason?: string;
  cancelRequested: boolean;
}

export type Operation =
  | { kind: "snapshot" }
  | { kind: "navigate"; url: string }
  | { kind: "click"; ref: string }
  | { kind: "fill"; ref: string; text: string }
  | { kind: "press"; key: string }
  | { kind: "scroll"; direction: "up" | "down"; pixels: number };

export interface BrowserBackend {
  open(task: Task): Promise<{ targetId: string }>;
  execute(task: Task, operation: Operation): Promise<{ text: string }>;
  close(task: Task): Promise<void>;
  /** Must establish that prior execution stopped; a CLI timeout is not sufficient. */
  recover(task: Task): Promise<void>;
}
