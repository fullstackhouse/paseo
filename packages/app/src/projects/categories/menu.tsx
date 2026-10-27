import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, Folders, Plus } from "lucide-react-native";
import {
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSubTrigger,
  MenuSurface,
  MenuTextField,
  MenuTrigger,
  useMenuContext,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  ALL_PROJECT_CATEGORIES,
  UNCATEGORIZED_PROJECTS,
  normalizeProjectCategoryName,
  projectCategoryOf,
  resolveProjectCategorySelection,
  type ProjectCategory,
  type ProjectCategorySelection,
} from "./model";
import { useProjectCategoriesStore } from "./store";

/** The `MenuSubTrigger` on a project's menu that opens the assign page. */
export const PROJECT_CATEGORY_PAGE_ID = "projectCategory";
const PROJECT_CATEGORY_CREATE_PAGE_ID = "projectCategoryCreate";
const SWITCHER_CREATE_PAGE_ID = "projectCategorySwitcherCreate";
const SWITCHER_RENAME_PAGE_ID = "projectCategorySwitcherRename";

const MENU_ICON_SIZE = 14;
const SWITCHER_MENU_WIDTH = 220;

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedPlus = withUnistyles(Plus);
const ThemedFolders = withUnistyles(Folders);
const ThemedChevronDown = withUnistyles(ChevronDown);

const CREATE_LEADING = <ThemedPlus size={MENU_ICON_SIZE} uniProps={mutedMapping} />;
const CATEGORY_LEADING = <ThemedFolders size={MENU_ICON_SIZE} uniProps={mutedMapping} />;

const NO_PAGES: readonly MenuPageDefinition[] = [];

/**
 * The pages behind a project's `Category` row, for both the kebab dropdown and the row's context
 * menu.
 */
export function useProjectCategoryMenuPages(
  projectViewKey: string | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!projectViewKey) return NO_PAGES;
    return [
      {
        id: PROJECT_CATEGORY_PAGE_ID,
        title: t("sidebar.categories.label"),
        content: <ProjectCategoryAssignPage projectViewKey={projectViewKey} />,
      },
      {
        id: PROJECT_CATEGORY_CREATE_PAGE_ID,
        title: t("sidebar.categories.create"),
        // A page you type into is not one the pointer opens or dismisses on its own.
        hoverIntent: false,
        content: <ProjectCategoryCreateAndAssignPage projectViewKey={projectViewKey} />,
      },
    ];
  }, [projectViewKey, t]);
}

/** The project menu's root row, carrying the project's current category as its value. */
export function ProjectCategorySubTrigger({
  projectViewKey,
}: {
  projectViewKey: string;
}): ReactElement {
  const { t } = useTranslation();
  const categoryName = useProjectCategoriesStore(
    (state) => projectCategoryOf(state, projectViewKey)?.name,
  );
  return (
    <MenuSubTrigger
      id={PROJECT_CATEGORY_PAGE_ID}
      leading={CATEGORY_LEADING}
      value={categoryName}
      testID={`sidebar-project-menu-category-${projectViewKey}`}
    >
      {t("sidebar.categories.label")}
    </MenuSubTrigger>
  );
}

/** A project sits in one category, so picking a row moves it there and closes the menu. */
function ProjectCategoryAssignPage({ projectViewKey }: { projectViewKey: string }): ReactElement {
  const { t } = useTranslation();
  const categories = useProjectCategoriesStore((state) => state.categories);
  const assignProject = useProjectCategoriesStore((state) => state.assignProject);
  const currentId = useProjectCategoriesStore(
    (state) => projectCategoryOf(state, projectViewKey)?.id ?? null,
  );
  const select = useCallback(
    (categoryId: string | null) => assignProject(projectViewKey, categoryId),
    [assignProject, projectViewKey],
  );

  return (
    <>
      <CategoryOption
        value={null}
        label={t("sidebar.categories.none")}
        selected={currentId === null}
        onSelect={select}
        testID="project-category-assign-none"
      />
      {categories.map((category) => (
        <CategoryOption
          key={category.id}
          value={category.id}
          label={category.name}
          selected={currentId === category.id}
          onSelect={select}
          testID={`project-category-assign-${category.name}`}
        />
      ))}
      <MenuSeparator />
      <MenuSubTrigger
        id={PROJECT_CATEGORY_CREATE_PAGE_ID}
        leading={CREATE_LEADING}
        testID="project-category-assign-create"
      >
        {t("sidebar.categories.create")}
      </MenuSubTrigger>
    </>
  );
}

function ProjectCategoryCreateAndAssignPage({
  projectViewKey,
}: {
  projectViewKey: string;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("ProjectCategoryCreateAndAssignPage");
  const createCategory = useProjectCategoriesStore((state) => state.createCategory);
  const assignProject = useProjectCategoriesStore((state) => state.assignProject);
  const submit = useCallback(
    (name: string) => {
      const categoryId = createCategory(name);
      if (!categoryId) return;
      assignProject(projectViewKey, categoryId);
      menu.goBack();
    },
    [assignProject, createCategory, menu, projectViewKey],
  );
  return (
    <CategoryNameForm
      confirmLabel={t("sidebar.categories.createConfirm")}
      onSubmit={submit}
      testIDPrefix="project-category-create"
    />
  );
}

/**
 * The sidebar's category switcher: which category the project list is narrowed to, and the place
 * to create, rename and delete categories.
 *
 * Absent until a category exists — the first one is made from a project's menu, where it is
 * assigned at the same time, so a switcher with nothing to switch between never shows.
 */
export function ProjectCategorySwitcher(): ReactElement | null {
  const { t } = useTranslation();
  const categories = useProjectCategoriesStore((state) => state.categories);
  const selection = useProjectCategoriesStore(resolveProjectCategorySelection);
  const select = useProjectCategoriesStore((state) => state.select);
  const deleteCategory = useProjectCategoriesStore((state) => state.deleteCategory);
  const selectedCategory = categories.find((category) => category.id === selection) ?? null;

  const handleDelete = useCallback(() => {
    if (!selectedCategory) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("sidebar.categories.deleteTitle"),
        message: t("sidebar.categories.deleteMessage", { name: selectedCategory.name }),
        confirmLabel: t("sidebar.categories.delete"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (confirmed) deleteCategory(selectedCategory.id);
    })();
  }, [deleteCategory, selectedCategory, t]);

  const pages = useMemo<MenuPageDefinition[]>(() => {
    const definitions: MenuPageDefinition[] = [
      {
        id: SWITCHER_CREATE_PAGE_ID,
        title: t("sidebar.categories.create"),
        hoverIntent: false,
        content: <SwitcherCreatePage />,
      },
    ];
    if (selectedCategory) {
      definitions.push({
        id: SWITCHER_RENAME_PAGE_ID,
        title: t("sidebar.categories.rename"),
        hoverIntent: false,
        content: <SwitcherRenamePage category={selectedCategory} />,
      });
    }
    return definitions;
  }, [selectedCategory, t]);

  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      hovered && styles.triggerHovered,
    ],
    [],
  );

  if (categories.length === 0) return null;

  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.categories.switcher")}
        testID="sidebar-project-category-switcher"
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {selectionLabel({ selection, selectedCategory, t })}
        </Text>
        <ThemedChevronDown size={12} uniProps={mutedMapping} />
      </MenuTrigger>
      <MenuSurface
        align="end"
        width={SWITCHER_MENU_WIDTH}
        pages={pages}
        sheetTitle={t("sidebar.categories.label")}
        testID="sidebar-project-category-switcher-content"
      >
        <CategoryOption
          value={ALL_PROJECT_CATEGORIES}
          label={t("sidebar.categories.all")}
          selected={selection === ALL_PROJECT_CATEGORIES}
          onSelect={select}
          testID="sidebar-project-category-all"
        />
        {categories.map((category) => (
          <CategoryOption
            key={category.id}
            value={category.id}
            label={category.name}
            selected={selection === category.id}
            onSelect={select}
            testID={`sidebar-project-category-${category.name}`}
          />
        ))}
        <CategoryOption
          value={UNCATEGORIZED_PROJECTS}
          label={t("sidebar.categories.uncategorized")}
          selected={selection === UNCATEGORIZED_PROJECTS}
          onSelect={select}
          testID="sidebar-project-category-uncategorized"
        />
        <MenuSeparator />
        <MenuSubTrigger
          id={SWITCHER_CREATE_PAGE_ID}
          leading={CREATE_LEADING}
          testID="sidebar-project-category-create"
        >
          {t("sidebar.categories.create")}
        </MenuSubTrigger>
        {selectedCategory ? (
          <>
            <MenuSubTrigger id={SWITCHER_RENAME_PAGE_ID} testID="sidebar-project-category-rename">
              {t("sidebar.categories.rename")}
            </MenuSubTrigger>
            <MenuItem onSelect={handleDelete} testID="sidebar-project-category-delete">
              {t("sidebar.categories.delete")}
            </MenuItem>
          </>
        ) : null}
      </MenuSurface>
    </MenuRoot>
  );
}

function selectionLabel(input: {
  selection: ProjectCategorySelection;
  selectedCategory: ProjectCategory | null;
  t: (key: string) => string;
}): string {
  if (input.selectedCategory) return input.selectedCategory.name;
  if (input.selection === UNCATEGORIZED_PROJECTS)
    return input.t("sidebar.categories.uncategorized");
  return input.t("sidebar.categories.all");
}

function SwitcherCreatePage(): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("SwitcherCreatePage");
  const createCategory = useProjectCategoriesStore((state) => state.createCategory);
  const submit = useCallback(
    (name: string) => {
      if (createCategory(name)) menu.goBack();
    },
    [createCategory, menu],
  );
  return (
    <CategoryNameForm
      confirmLabel={t("sidebar.categories.createConfirm")}
      onSubmit={submit}
      testIDPrefix="sidebar-project-category-create"
    />
  );
}

function SwitcherRenamePage({ category }: { category: ProjectCategory }): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("SwitcherRenamePage");
  const renameCategory = useProjectCategoriesStore((state) => state.renameCategory);
  const submit = useCallback(
    (name: string) => {
      renameCategory(category.id, name);
      menu.goBack();
    },
    [category.id, menu, renameCategory],
  );
  return (
    <CategoryNameForm
      initialValue={category.name}
      confirmLabel={t("sidebar.categories.renameConfirm")}
      onSubmit={submit}
      testIDPrefix="sidebar-project-category-rename"
    />
  );
}

function CategoryNameForm({
  initialValue = "",
  confirmLabel,
  onSubmit,
  testIDPrefix,
}: {
  initialValue?: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  testIDPrefix: string;
}): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState(initialValue);
  const normalized = normalizeProjectCategoryName(name);
  const submit = useCallback(() => {
    if (normalized) onSubmit(normalized);
  }, [normalized, onSubmit]);
  return (
    <>
      <MenuTextField
        initialValue={initialValue}
        onChangeText={setName}
        placeholder={t("sidebar.categories.name")}
        autoFocus
        onSubmitEditing={submit}
        testID={`${testIDPrefix}-name`}
      />
      <MenuSeparator />
      <MenuItem
        disabled={!normalized}
        closeOnSelect={false}
        onSelect={submit}
        testID={`${testIDPrefix}-submit`}
      >
        {confirmLabel}
      </MenuItem>
    </>
  );
}

function CategoryOption<Value extends ProjectCategorySelection>({
  value,
  label,
  selected,
  onSelect,
  testID,
}: {
  value: Value;
  label: string;
  selected: boolean;
  onSelect: (value: Value) => void;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <MenuItem selected={selected} onSelect={handleSelect} testID={testID}>
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    height: 28,
    maxWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  triggerText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
