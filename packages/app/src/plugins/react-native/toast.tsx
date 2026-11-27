import { useCallback, useMemo } from "react";
import type { ToastAction, ToastApi, ToastOptions } from "@getpaseo/plugin/client/ui";
import { ActionToast } from "@/components/action-toast";
import type { DismissToast } from "@/components/toast-host";
import { useToast as useAppToast } from "@/contexts/toast-api-context";

/** Filled in once the toast is up, so its button can close it. */
interface DismissHandle {
  dismiss: DismissToast;
}

function dismissHandle(): DismissHandle {
  return { dismiss: () => {} };
}

function PluginActionToast({
  message,
  label,
  onPress,
  handle,
}: {
  message: string;
  label: ToastAction["label"];
  onPress: ToastAction["onPress"];
  handle: DismissHandle;
}) {
  const press = useCallback(() => {
    handle.dismiss();
    onPress();
  }, [handle, onPress]);
  return <ActionToast message={message} actionLabel={label} onAction={press} />;
}

export function useToast(): ToastApi {
  const toast = useAppToast();
  return useMemo(
    () => ({
      show(message: string, options?: ToastOptions) {
        const { action, ...rest } = options ?? {};
        if (!action) return toast.show(message, rest);
        const handle = dismissHandle();
        handle.dismiss = toast.show(
          <PluginActionToast
            message={message}
            label={action.label}
            onPress={action.onPress}
            handle={handle}
          />,
          rest,
        );
        return handle.dismiss;
      },
      error(message: string) {
        toast.error(message);
      },
    }),
    [toast],
  );
}
