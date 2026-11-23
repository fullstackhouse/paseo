import { afterEach, expect, it } from "vitest";
import { useHistoryViewStore } from "./history-view-store";

afterEach(() => {
  useHistoryViewStore.setState({ view: "agents" });
});

it("remembers the chosen History tab outside the screen component", () => {
  expect(useHistoryViewStore.getState().view).toBe("agents");
  useHistoryViewStore.getState().setView("archived");
  expect(useHistoryViewStore.getState().view).toBe("archived");
});
