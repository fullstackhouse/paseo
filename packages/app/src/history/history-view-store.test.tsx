// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useHistoryView, useHistoryViewStore } from "./history-view-store";

afterEach(() => {
  useHistoryViewStore.setState({ view: "agents" });
});

it("keeps the chosen History tab when the screen content remounts, as it does on Back", () => {
  const first = renderHook(() => useHistoryView());
  expect(first.result.current.view).toBe("agents");
  act(() => first.result.current.setView("archived"));
  first.unmount();

  const second = renderHook(() => useHistoryView());
  expect(second.result.current.view).toBe("archived");
});
