import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  EMPTY_PROJECT_CATEGORIES_STATE,
  addProjectCategory,
  assignProjectCategory,
  createProjectCategoryId,
  deleteProjectCategory,
  renameProjectCategory,
  type ProjectCategoriesState,
  type ProjectCategorySelection,
} from "./model";

interface ProjectCategoriesStore extends ProjectCategoriesState {
  /** Returns the new category's id, or the existing one's when the name is taken. */
  createCategory: (name: string) => string | null;
  renameCategory: (id: string, name: string) => void;
  deleteCategory: (id: string) => void;
  assignProject: (viewKey: string, categoryId: string | null) => void;
  select: (selection: ProjectCategorySelection) => void;
}

const ProjectCategoriesPersistedStateSchema = z.strictObject({
  categories: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  assignments: z.record(z.string(), z.string()),
  selection: z.string().nullable(),
});

function pickState(state: ProjectCategoriesState): ProjectCategoriesState {
  return {
    categories: state.categories,
    assignments: state.assignments,
    selection: state.selection,
  };
}

/**
 * Per-device, like the sidebar's project order: categories are how this person arranges their
 * sidebar, not a fact about the project that its hosts should hold.
 */
export const useProjectCategoriesStore = create<ProjectCategoriesStore>()(
  persist(
    (set, get) => ({
      ...EMPTY_PROJECT_CATEGORIES_STATE,
      createCategory: (name) => {
        const result = addProjectCategory(pickState(get()), {
          name,
          id: createProjectCategoryId(),
        });
        set(result.state);
        return result.categoryId;
      },
      renameCategory: (id, name) =>
        set((state) => renameProjectCategory(pickState(state), { id, name })),
      deleteCategory: (id) => set((state) => deleteProjectCategory(pickState(state), id)),
      assignProject: (viewKey, categoryId) =>
        set((state) => assignProjectCategory(pickState(state), { viewKey, categoryId })),
      select: (selection) => set({ selection }),
    }),
    {
      name: "project-categories",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, ProjectCategoriesPersistedStateSchema),
      partialize: (state) => pickState(state),
    },
  ),
);
