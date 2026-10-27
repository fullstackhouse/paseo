import { describe, expect, it } from "vitest";
import {
  ALL_PROJECT_CATEGORIES,
  EMPTY_PROJECT_CATEGORIES_STATE,
  UNCATEGORIZED_PROJECTS,
  addProjectCategory,
  assignProjectCategory,
  createProjectCategoryMatcher,
  deleteProjectCategory,
  isProjectCategoryNameTaken,
  projectCategoryOf,
  renameProjectCategory,
  resolveProjectCategorySelection,
  type ProjectCategoriesState,
} from "./model";

function withCategories(): ProjectCategoriesState {
  let state = EMPTY_PROJECT_CATEGORIES_STATE;
  state = addProjectCategory(state, { name: "Work", id: "cat_work" }).state;
  state = addProjectCategory(state, { name: "Personal", id: "cat_personal" }).state;
  state = assignProjectCategory(state, { viewKey: "alpha", categoryId: "cat_work" });
  state = assignProjectCategory(state, { viewKey: "beta", categoryId: "cat_personal" });
  return state;
}

describe("addProjectCategory", () => {
  it("normalizes whitespace in the name", () => {
    const result = addProjectCategory(EMPTY_PROJECT_CATEGORIES_STATE, {
      name: "  Side   projects ",
      id: "cat_side",
    });
    expect(result.categoryId).toBe("cat_side");
    expect(result.state.categories).toEqual([{ id: "cat_side", name: "Side projects" }]);
  });

  it("returns the existing category for a name that differs only in case", () => {
    const result = addProjectCategory(withCategories(), { name: "work", id: "cat_new" });
    expect(result.categoryId).toBe("cat_work");
    expect(result.state.categories).toHaveLength(2);
  });

  it("ignores a blank name", () => {
    const result = addProjectCategory(EMPTY_PROJECT_CATEGORIES_STATE, { name: "  ", id: "x" });
    expect(result.categoryId).toBeNull();
    expect(result.state).toBe(EMPTY_PROJECT_CATEGORIES_STATE);
  });
});

describe("renameProjectCategory", () => {
  it("renames the category", () => {
    const state = renameProjectCategory(withCategories(), { id: "cat_work", name: "Clients" });
    expect(state.categories[0]).toEqual({ id: "cat_work", name: "Clients" });
  });

  it("refuses a name another category already has", () => {
    const before = withCategories();
    expect(renameProjectCategory(before, { id: "cat_work", name: "personal" })).toBe(before);
  });
});

describe("isProjectCategoryNameTaken", () => {
  it("matches another category's name ignoring case and spacing", () => {
    expect(isProjectCategoryNameTaken(withCategories().categories, " personal ", "cat_work")).toBe(
      true,
    );
  });

  it("does not count the category being renamed", () => {
    expect(isProjectCategoryNameTaken(withCategories().categories, "WORK", "cat_work")).toBe(false);
  });
});

describe("deleteProjectCategory", () => {
  it("uncategorizes its projects and resets a selection that pointed at it", () => {
    const state = deleteProjectCategory({ ...withCategories(), selection: "cat_work" }, "cat_work");
    expect(state.categories.map((category) => category.id)).toEqual(["cat_personal"]);
    expect(state.assignments).toEqual({ beta: "cat_personal" });
    expect(state.selection).toBe(ALL_PROJECT_CATEGORIES);
  });

  it("keeps a selection that pointed elsewhere", () => {
    const state = deleteProjectCategory(
      { ...withCategories(), selection: "cat_personal" },
      "cat_work",
    );
    expect(state.selection).toBe("cat_personal");
  });
});

describe("assignProjectCategory", () => {
  it("moves a project between categories and out of them", () => {
    let state = assignProjectCategory(withCategories(), {
      viewKey: "alpha",
      categoryId: "cat_personal",
    });
    expect(projectCategoryOf(state, "alpha")?.name).toBe("Personal");
    state = assignProjectCategory(state, { viewKey: "alpha", categoryId: null });
    expect(projectCategoryOf(state, "alpha")).toBeNull();
    expect(state.assignments).toEqual({ beta: "cat_personal" });
  });
});

describe("resolveProjectCategorySelection", () => {
  it("falls back to all projects for a category that no longer exists", () => {
    expect(resolveProjectCategorySelection({ ...withCategories(), selection: "cat_gone" })).toBe(
      ALL_PROJECT_CATEGORIES,
    );
  });

  it("falls back to all projects when there are no categories", () => {
    expect(
      resolveProjectCategorySelection({ categories: [], selection: UNCATEGORIZED_PROJECTS }),
    ).toBe(ALL_PROJECT_CATEGORIES);
  });
});

describe("createProjectCategoryMatcher", () => {
  const viewKeys = ["alpha", "beta", "gamma"];

  it("does not filter when every project is selected", () => {
    expect(createProjectCategoryMatcher(withCategories())).toBeNull();
  });

  it("keeps only the selected category's projects", () => {
    const matcher = createProjectCategoryMatcher({ ...withCategories(), selection: "cat_work" });
    expect(viewKeys.filter((viewKey) => matcher!(viewKey))).toEqual(["alpha"]);
  });

  it("keeps projects with no category, or one that was deleted, under uncategorized", () => {
    const state = {
      ...withCategories(),
      assignments: { alpha: "cat_work", beta: "cat_deleted" },
      selection: UNCATEGORIZED_PROJECTS,
    };
    const matcher = createProjectCategoryMatcher(state);
    expect(viewKeys.filter((viewKey) => matcher!(viewKey))).toEqual(["beta", "gamma"]);
  });
});
