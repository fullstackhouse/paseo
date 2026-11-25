import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { useDraftStore } from "@/stores/draft-store";
import type { DraftRecord } from "@/stores/draft-store/state";
import {
  type PendingWorkspaceDraftSetup,
  useWorkspaceDraftSubmissionStore,
} from "@/stores/workspace-draft-submission-store";
import { getHostProjectId, type HostProjectListItem } from "@/projects/host-project-model";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

/**
 * Where a New workspace draft lives, so the sidebar can list it and reopen it. The text itself
 * stays in the draft store; this only remembers the route and, for a fork, the agent setup.
 */
export interface NewWorkspaceDraftEntry {
  draftKey: string;
  draftId?: string;
  serverId: string;
  sourceDirectory?: string;
  projectId?: string;
  projectName?: string;
  setup?: WorkspaceDraftTabSetup;
}

const WorkspaceDraftTabSetupSchema = z.object({
  provider: z.string(),
  cwd: z.string(),
  modeId: z.string().nullable(),
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  providerOptions: z.record(z.string(), z.unknown()),
}) as z.ZodType<WorkspaceDraftTabSetup>;

const NewWorkspaceDraftEntrySchema = z.object({
  draftKey: z.string(),
  draftId: z.string().optional(),
  serverId: z.string(),
  sourceDirectory: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  setup: WorkspaceDraftTabSetupSchema.optional(),
});

const PersistedStateSchema = z.object({
  entries: z.record(z.string(), NewWorkspaceDraftEntrySchema),
});

interface NewWorkspaceDraftsState {
  entries: Record<string, NewWorkspaceDraftEntry>;
  /**
   * Drafts the sidebar has listed this session, numbered in the order they appeared. Once
   * listed, a draft stays listed and keeps its place, so typing in it does not move it.
   */
  revealedDraftKeys: Record<string, number>;
  recordDraft: (entry: NewWorkspaceDraftEntry) => void;
  revealDrafts: (draftKeys: string[]) => void;
  discardDraft: (draftKey: string) => void;
}

function isSameEntry(left: NewWorkspaceDraftEntry | undefined, right: NewWorkspaceDraftEntry) {
  return (
    left !== undefined &&
    left.draftId === right.draftId &&
    left.serverId === right.serverId &&
    left.sourceDirectory === right.sourceDirectory &&
    left.projectId === right.projectId &&
    left.projectName === right.projectName &&
    left.setup === right.setup
  );
}

export function isListedDraftRecord(record: DraftRecord | undefined): record is DraftRecord {
  return (
    record?.lifecycle === "active" &&
    (record.input.text.trim().length > 0 || record.input.attachments.length > 0)
  );
}

export const useNewWorkspaceDraftsStore = create<NewWorkspaceDraftsState>()(
  persist(
    (set) => ({
      entries: {},
      revealedDraftKeys: {},
      revealDrafts: (draftKeys) =>
        set((state) => {
          const missing = draftKeys.filter((key) => state.revealedDraftKeys[key] === undefined);
          if (missing.length === 0) return state;
          const revealedDraftKeys = { ...state.revealedDraftKeys };
          let next = Math.max(0, ...Object.values(revealedDraftKeys));
          // `draftKeys` is newest first; number the oldest first so newer drafts sort above.
          for (const key of missing.toReversed()) revealedDraftKeys[key] = ++next;
          return { revealedDraftKeys };
        }),
      recordDraft: (entry) =>
        set((state) => {
          if (isSameEntry(state.entries[entry.draftKey], entry)) return state;
          // Entries whose draft was sent or emptied are dead; drop them while writing anyway.
          const drafts = useDraftStore.getState().drafts;
          const entries: Record<string, NewWorkspaceDraftEntry> = {};
          for (const [key, existing] of Object.entries(state.entries)) {
            if (isListedDraftRecord(drafts[key])) entries[key] = existing;
          }
          entries[entry.draftKey] = entry;
          return { entries };
        }),
      discardDraft: (draftKey) => {
        const entry = useNewWorkspaceDraftsStore.getState().entries[draftKey];
        useDraftStore.getState().clearDraftInput({ draftKey, lifecycle: "abandoned" });
        if (entry?.draftId) {
          useWorkspaceDraftSubmissionStore.getState().clearDraftSetup({ draftId: entry.draftId });
          useWorkspaceAttachmentsStore.getState().clearWorkspaceAttachments({
            scopeKey: buildDraftWorkspaceAttachmentScopeKey(entry.draftId),
          });
        }
        set((state) => {
          if (!state.entries[draftKey]) return state;
          const entries = { ...state.entries };
          delete entries[draftKey];
          const revealedDraftKeys = { ...state.revealedDraftKeys };
          delete revealedDraftKeys[draftKey];
          return { entries, revealedDraftKeys };
        });
      },
    }),
    {
      name: "new-workspace-drafts",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ entries: state.entries }),
      version: 1,
    },
  ),
);

export interface ListedNewWorkspaceDraft extends NewWorkspaceDraftEntry {
  preview: string;
  updatedAt: number;
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** Drafts that still hold something, newest first. */
export function selectListedNewWorkspaceDrafts(
  entries: Record<string, NewWorkspaceDraftEntry>,
  drafts: Record<string, DraftRecord>,
): ListedNewWorkspaceDraft[] {
  const listed: ListedNewWorkspaceDraft[] = [];
  for (const entry of Object.values(entries)) {
    const record = drafts[entry.draftKey];
    if (!isListedDraftRecord(record)) continue;
    listed.push({ ...entry, preview: firstLine(record.input.text), updatedAt: record.updatedAt });
  }
  return listed.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function useListedNewWorkspaceDrafts(): ListedNewWorkspaceDraft[] {
  const entries = useNewWorkspaceDraftsStore((state) => state.entries);
  // Only the records this list reads, so typing in an agent composer does not re-render it.
  const records = useDraftStore(
    useShallow((state) => Object.keys(entries).map((key) => state.drafts[key])),
  );
  return useMemo(() => {
    const drafts: Record<string, DraftRecord> = {};
    Object.keys(entries).forEach((key, index) => {
      const record = records[index];
      if (record) drafts[key] = record;
    });
    return selectListedNewWorkspaceDrafts(entries, drafts);
  }, [entries, records]);
}

/**
 * A fork's setup lives in memory; after an app restart only this store still has it.
 * Put it back before the draft's screen mounts so the composer starts with the fork's agent.
 */
export function restoreNewWorkspaceDraftSetup(entry: NewWorkspaceDraftEntry): void {
  if (!entry.draftId || !entry.setup) return;
  const submission = useWorkspaceDraftSubmissionStore.getState();
  if (submission.setupByDraftId[entry.draftId]) return;
  submission.setDraftSetup({
    draftId: entry.draftId,
    setup: entry.setup,
    sourceDirectory: entry.sourceDirectory ?? null,
  });
}

/** Keeps the open New workspace draft's entry in step with the screen's host and project. */
export function useRecordNewWorkspaceDraft(input: {
  draftKey: string;
  draftId?: string;
  serverId: string;
  sourceDirectory: string | null;
  project: HostProjectListItem | null;
  routeProjectName?: string;
  forkSetup: PendingWorkspaceDraftSetup | null | undefined;
}): void {
  const { draftKey, draftId, serverId, sourceDirectory, project, routeProjectName } = input;
  const projectId = project ? getHostProjectId(project, serverId) : null;
  const projectName = project?.projectName ?? routeProjectName;
  const setup = input.forkSetup?.setup;
  // Discarding the open draft deletes its entry; text typed after that must list it again.
  const hasContent = useDraftStore((state) => isListedDraftRecord(state.drafts[draftKey]));
  useEffect(() => {
    if (!serverId || !hasContent) return;
    useNewWorkspaceDraftsStore.getState().recordDraft({
      draftKey,
      ...(draftId ? { draftId } : {}),
      serverId,
      ...(sourceDirectory ? { sourceDirectory } : {}),
      ...(projectId ? { projectId } : {}),
      ...(projectName ? { projectName } : {}),
      ...(setup ? { setup } : {}),
    });
  }, [draftId, draftKey, hasContent, projectId, projectName, serverId, setup, sourceDirectory]);
}
