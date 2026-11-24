import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { togglePinnedProject } from "./model";

interface PinnedProjectsStore {
  pinnedViewKeys: string[];
  togglePin: (viewKey: string) => void;
}

const PinnedProjectsPersistedStateSchema = z.strictObject({
  pinnedViewKeys: z.array(z.string()),
});

/** Per-device, like project categories: pins are how this person arranges their sidebar. */
export const usePinnedProjectsStore = create<PinnedProjectsStore>()(
  persist(
    (set) => ({
      pinnedViewKeys: [],
      togglePin: (viewKey) =>
        set((state) => ({ pinnedViewKeys: togglePinnedProject(state.pinnedViewKeys, viewKey) })),
    }),
    {
      name: "pinned-projects",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PinnedProjectsPersistedStateSchema),
      partialize: (state) => ({ pinnedViewKeys: state.pinnedViewKeys }),
    },
  ),
);
