import { useCallback } from "react";
import { useFetchQuery } from "@/data/query";
import { getFshTestBuilds, type FshTestBuildsInfo } from "@/desktop/updates/fsh-test-builds";
import { shouldShowDesktopUpdateSection } from "@/desktop/updates/desktop-updates";

const STALE_MS = 5 * 60 * 1000;
const REFETCH_MS = 30 * 60 * 1000;

/** The FSH test builds, or null outside a packaged FSH desktop build. */
export function useFshTestBuilds(): {
  info: FshTestBuildsInfo | null;
  isLoading: boolean;
  refetch: () => void;
} {
  const enabled = shouldShowDesktopUpdateSection();
  const query = useFetchQuery({
    queryKey: ["desktop", "fsh-test-builds"],
    queryFn: getFshTestBuilds,
    dataShape: "value",
    enabled,
    staleTimeMs: STALE_MS,
    // GitHub allows 60 unauthenticated requests an hour: refetch on mount only once stale.
    refetchOnMount: true,
    refetchInterval: REFETCH_MS,
  });
  const { refetch: refetchQuery } = query;
  // Stable, so a focus effect that depends on it runs once per focus, not on every render.
  const refetch = useCallback(() => void refetchQuery(), [refetchQuery]);
  return { info: query.data ?? null, isLoading: query.isFetching, refetch };
}
