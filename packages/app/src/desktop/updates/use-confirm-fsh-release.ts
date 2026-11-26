import { useTranslation } from "react-i18next";
import {
  formatTestBuildLabel,
  type FshRelease,
  type FshTestBuild,
} from "@/desktop/updates/fsh-test-builds";
import { useStableEvent } from "@/hooks/use-stable-event";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { confirmDialog } from "@/utils/confirm-dialog";

export type FshReleaseChoice = { kind: "test"; build: FshTestBuild } | { kind: "stable" };

/**
 * FSH fork: confirm, then install a test build or go back to stable through the regular update
 * install, which quits and reopens Paseo.
 */
export function useConfirmFshRelease(
  installUpdate: (fshRelease: FshRelease) => unknown,
): (choice: FshReleaseChoice) => void {
  const { t } = useTranslation();
  return useStableEvent((choice: FshReleaseChoice) => {
    clearCommandCenterFocusRestoreElement();
    const dialog =
      choice.kind === "test"
        ? {
            title: t("desktop.updates.testBuilds.installTitle"),
            message: t("desktop.updates.testBuilds.installMessage", {
              build: formatTestBuildLabel(choice.build),
            }),
            confirmLabel: t("desktop.updates.testBuilds.installConfirm"),
          }
        : {
            title: t("desktop.updates.testBuilds.stableTitle"),
            message: t("desktop.updates.testBuilds.stableMessage"),
            confirmLabel: t("desktop.updates.testBuilds.stableConfirm"),
          };
    void confirmDialog({ ...dialog, cancelLabel: t("common.actions.cancel") })
      .then((confirmed) => {
        if (confirmed) void installUpdate(choice.kind === "test" ? choice.build.tag : "stable");
        return;
      })
      .catch((error) => {
        console.error("[Updates] Failed to open test build confirmation", error);
      });
  });
}
