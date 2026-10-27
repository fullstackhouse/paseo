/**
 * Project categories: a per-device grouping of sidebar projects, and the one category the
 * sidebar is narrowed to.
 *
 * Projects are keyed by `SidebarProjectEntry.viewKey`, the same key the sidebar's project order
 * and project filter use, so a category follows a project across hosts the way its position does.
 * A project sits in at most one category.
 */
export interface ProjectCategory {
  id: string;
  name: string;
}

/** Shows every project. */
export const ALL_PROJECT_CATEGORIES = null;

/**
 * Shows the projects in no category. Category ids are `cat_`-prefixed, so this can never collide
 * with one.
 */
export const UNCATEGORIZED_PROJECTS = "uncategorized";

/** `null` for all projects, `UNCATEGORIZED_PROJECTS`, or a category id. */
export type ProjectCategorySelection = string | null;

export interface ProjectCategoriesState {
  categories: ProjectCategory[];
  /** Category id by project view key. */
  assignments: Record<string, string>;
  selection: ProjectCategorySelection;
}

export const EMPTY_PROJECT_CATEGORIES_STATE: ProjectCategoriesState = {
  categories: [],
  assignments: {},
  selection: ALL_PROJECT_CATEGORIES,
};

export function normalizeProjectCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function createProjectCategoryId(): string {
  return `cat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function findCategoryByName(
  categories: readonly ProjectCategory[],
  name: string,
): ProjectCategory | undefined {
  const key = name.toLocaleLowerCase();
  return categories.find((category) => category.name.toLocaleLowerCase() === key);
}

/**
 * Adds a category, or finds the one already named that way (case-insensitively), so typing an
 * existing name twice never yields two categories that look the same in the switcher.
 */
export function addProjectCategory(
  state: ProjectCategoriesState,
  input: { name: string; id: string },
): { state: ProjectCategoriesState; categoryId: string | null } {
  const name = normalizeProjectCategoryName(input.name);
  if (!name) return { state, categoryId: null };
  const existing = findCategoryByName(state.categories, name);
  if (existing) return { state, categoryId: existing.id };
  return {
    state: { ...state, categories: [...state.categories, { id: input.id, name }] },
    categoryId: input.id,
  };
}

/** Renaming onto another category's name is refused rather than merging the two. */
export function renameProjectCategory(
  state: ProjectCategoriesState,
  input: { id: string; name: string },
): ProjectCategoriesState {
  const name = normalizeProjectCategoryName(input.name);
  if (!name) return state;
  const clash = findCategoryByName(state.categories, name);
  if (clash && clash.id !== input.id) return state;
  return {
    ...state,
    categories: state.categories.map((category) =>
      category.id === input.id ? { ...category, name } : category,
    ),
  };
}

/** Its projects become uncategorized, and a sidebar narrowed to it goes back to all projects. */
export function deleteProjectCategory(
  state: ProjectCategoriesState,
  id: string,
): ProjectCategoriesState {
  return {
    categories: state.categories.filter((category) => category.id !== id),
    assignments: Object.fromEntries(
      Object.entries(state.assignments).filter(([, categoryId]) => categoryId !== id),
    ),
    selection: state.selection === id ? ALL_PROJECT_CATEGORIES : state.selection,
  };
}

/** `categoryId: null` takes the project out of its category. */
export function assignProjectCategory(
  state: ProjectCategoriesState,
  input: { viewKey: string; categoryId: string | null },
): ProjectCategoriesState {
  const { [input.viewKey]: _previous, ...rest } = state.assignments;
  const assignments =
    input.categoryId === null ? rest : { ...rest, [input.viewKey]: input.categoryId };
  return { ...state, assignments };
}

/** The project's category, or `null` when it has none or its category no longer exists. */
export function projectCategoryOf(
  state: Pick<ProjectCategoriesState, "categories" | "assignments">,
  viewKey: string,
): ProjectCategory | null {
  const categoryId = state.assignments[viewKey];
  if (categoryId === undefined) return null;
  return state.categories.find((category) => category.id === categoryId) ?? null;
}

/**
 * The selection as it is actually applied: one naming a category that no longer exists shows
 * every project, and so does "uncategorized" once there are no categories to be outside of.
 *
 * This is the only definition of "is a category selected". The switcher's label, its checks and
 * the sidebar's filter all read it, so they cannot disagree.
 */
export function resolveProjectCategorySelection(
  state: Pick<ProjectCategoriesState, "categories" | "selection">,
): ProjectCategorySelection {
  const { selection, categories } = state;
  if (selection === ALL_PROJECT_CATEGORIES || categories.length === 0) {
    return ALL_PROJECT_CATEGORIES;
  }
  if (selection === UNCATEGORIZED_PROJECTS) return selection;
  return categories.some((category) => category.id === selection)
    ? selection
    : ALL_PROJECT_CATEGORIES;
}

/**
 * Whether a project belongs in the sidebar under the current selection, or `null` when every
 * project does and there is nothing to filter.
 */
export function createProjectCategoryMatcher(
  state: ProjectCategoriesState,
): ((viewKey: string) => boolean) | null {
  const selection = resolveProjectCategorySelection(state);
  if (selection === ALL_PROJECT_CATEGORIES) return null;
  if (selection === UNCATEGORIZED_PROJECTS) {
    return (viewKey) => projectCategoryOf(state, viewKey) === null;
  }
  return (viewKey) => state.assignments[viewKey] === selection;
}
