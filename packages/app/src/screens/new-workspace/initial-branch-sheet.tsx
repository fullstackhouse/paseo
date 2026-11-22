import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { toErrorMessage } from "@/utils/error-messages";
import type { EmptyRepositoryChoice, EmptyRepositoryPrompt } from "./initial-branch";

export interface InitialBranchSheetRequest extends EmptyRepositoryPrompt {
  resolve: (choice: EmptyRepositoryChoice) => void;
}

// Shown when a worktree is requested in a repository with no commits. The branch is created from
// here so a slow push keeps the sheet open with its progress and any error in place.
export function InitialBranchSheet({ request }: { request: InitialBranchSheetRequest | null }) {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsCreating(false);
    setError(null);
  }, [request]);

  const handleCancel = useCallback(() => {
    if (isCreating) return;
    request?.resolve("cancelled");
  }, [isCreating, request]);

  const handleUseLocalCheckout = useCallback(() => {
    if (isCreating) return;
    request?.resolve("local");
  }, [isCreating, request]);

  const handleCreateBranch = useCallback(async () => {
    if (!request || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      await request.createBranch();
      request.resolve("created");
    } catch (createError) {
      setIsCreating(false);
      setError(toErrorMessage(createError));
    }
  }, [isCreating, request]);

  const handleCreateBranchVoid = useCallback(() => {
    void handleCreateBranch();
  }, [handleCreateBranch]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("newWorkspace.initialBranch.title") }),
    [t],
  );
  const branch = request?.branch ?? "";
  const createLabel = isCreating
    ? t("newWorkspace.initialBranch.creating", { branch })
    : t("newWorkspace.initialBranch.create", { branch });

  return (
    <AdaptiveModalSheet
      visible={request !== null}
      onClose={handleCancel}
      header={header}
      desktopMaxWidth={520}
      testID="initial-branch-sheet"
    >
      <View style={styles.body}>
        <Text style={styles.message}>{t("newWorkspace.initialBranch.message")}</Text>
        <Text style={styles.message}>
          {request?.pushTo
            ? t("newWorkspace.initialBranch.createDetailWithPush", {
                branch,
                remote: request.pushTo,
              })
            : t("newWorkspace.initialBranch.createDetail", { branch })}
        </Text>
        <Text style={styles.message}>
          {t("newWorkspace.initialBranch.localDetail", { branch })}
        </Text>
        {error ? (
          <Text style={styles.errorText} testID="initial-branch-sheet-error">
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            variant="secondary"
            onPress={handleCancel}
            disabled={isCreating}
            testID="initial-branch-sheet-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="outline"
            onPress={handleUseLocalCheckout}
            disabled={isCreating}
            testID="initial-branch-sheet-local"
          >
            {t("newWorkspace.initialBranch.useLocalCheckout")}
          </Button>
          <Button
            variant="default"
            onPress={handleCreateBranchVoid}
            disabled={isCreating}
            testID="initial-branch-sheet-create"
          >
            {createLabel}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
