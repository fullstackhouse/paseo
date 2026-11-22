import { describe, expect, test, vi } from "vitest";

type ConsoleListener = (event: unknown, level: number, message: string) => void;
type CreatedListener = (event: unknown, contents: unknown) => void;

const electronApp = vi.hoisted(() => ({
  listeners: [] as Array<(event: unknown, contents: unknown) => void>,
}));

vi.mock("electron", () => ({
  app: { on: (_event: string, listener: CreatedListener) => electronApp.listeners.push(listener) },
}));

import { logRendererConsoles } from "./renderer-console.js";

describe("renderer console log", () => {
  test("logs every renderer except tabs live view typed into", () => {
    const logged: unknown[] = [];
    logRendererConsoles({
      log: { processMessage: (message) => logged.push(message) },
      isWithheld: (contentsId) => contentsId === 2,
    });
    const consoles = [1, 2].map((id) => {
      let emit!: ConsoleListener;
      const contents = {
        id,
        isDestroyed: () => false,
        on: (_event: string, listener: ConsoleListener) => {
          emit = listener;
        },
      };
      for (const listener of electronApp.listeners) listener({}, contents);
      return emit;
    });

    consoles[0]!({}, 2, "a warning");
    consoles[1]!({}, 1, "LV3-SENTINEL-console");

    expect(logged).toEqual([
      { data: ["a warning"], level: "warn", variables: { processType: "renderer" } },
    ]);
  });
});
