import { afterEach, expect, it } from "vitest";
import { useHistoryViewStore } from "./history-view-store";

afterEach(() => {
  useHistoryViewStore.setState({ view: "agents" });
});

it("keeps the chosen History tab outside the screen, so Back finds it again", () => {
  expect(useHistoryViewStore.getState().view).toBe("agents");
  useHistoryViewStore.getState().setView("archived");
  expect(useHistoryViewStore.getState().view).toBe("archived");
});
