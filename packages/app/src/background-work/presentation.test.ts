import { expect, test } from "vitest";
import { backgroundWorkBucket, backgroundWorkState, backgroundWorkText } from "./presentation";

test("shows descriptions and commands once, with useful fallbacks", () => {
  expect(
    backgroundWorkText({ description: "Watch build", command: "tail -f build.log" }, "Monitor"),
  ).toEqual({ title: "Watch build", detailTitle: "Watch build", command: "tail -f build.log" });
  expect(backgroundWorkText({ description: null, command: "sleep 10" }, "Shell")).toEqual({
    title: "sleep 10",
    detailTitle: "Shell",
    command: null,
  });
  expect(backgroundWorkText({ description: "sleep 10", command: "sleep 10" }, "Shell")).toEqual({
    title: "sleep 10",
    detailTitle: "Shell",
    command: null,
  });
  expect(backgroundWorkText({ description: null }, "Shell")).toEqual({
    title: "Shell",
    detailTitle: "Shell",
    command: null,
  });
});

test("names a task's state from the host listing and its stop request", () => {
  expect(backgroundWorkState({ live: true })).toBe("running");
  expect(backgroundWorkState({ live: true, stopStatus: "pending" })).toBe("stopping");
  expect(backgroundWorkState({ live: false, stopStatus: "pending" })).toBe("stopping");
  expect(backgroundWorkState({ live: true, stopStatus: "error" })).toBe("running");
  expect(backgroundWorkState({ live: false, stopStatus: "error" })).toBe("notRunning");
  expect(backgroundWorkState({ live: false })).toBe("notRunning");
});

test("marks running and stopping tasks with the ring and unconfirmed stops as failed", () => {
  expect(backgroundWorkBucket({ state: "running" })).toBe("running");
  expect(backgroundWorkBucket({ state: "stopping", stopStatus: "pending" })).toBe("running");
  expect(backgroundWorkBucket({ state: "notRunning" })).toBe("done");
  expect(backgroundWorkBucket({ state: "running", stopStatus: "error" })).toBe("failed");
  expect(backgroundWorkBucket({ state: "notRunning", stopStatus: "error" })).toBe("failed");
});
