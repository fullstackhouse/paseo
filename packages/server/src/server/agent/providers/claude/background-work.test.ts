import { describe, expect, test } from "vitest";

import { toBackgroundWorkInputs } from "./background-work.js";

describe("toBackgroundWorkInputs", () => {
  test("maps shells, drops subagents and workflows", () => {
    expect(
      toBackgroundWorkInputs([
        { task_id: "bash-1", task_type: "local_bash", description: "sleep 20" },
        { task_id: "agent-1", task_type: "local_agent", description: "Explore" },
        { task_id: "wf-1", task_type: "local_workflow", description: "Run the spec workflow" },
        { task_id: "x-1", task_type: "remote_something", description: "  " },
        { task_id: "bash-2", task_type: "local_bash" },
      ]),
    ).toEqual([
      { id: "bash-1", kind: "shell", description: "sleep 20" },
      { id: "x-1", kind: "other", description: null },
      { id: "bash-2", kind: "shell", description: null },
    ]);
  });

  test("tags tasks a Monitor call started as monitors", () => {
    expect(
      toBackgroundWorkInputs(
        [
          { task_id: "bash-1", task_type: "local_bash", description: "npm run dev" },
          { task_id: "watch-1", task_type: "local_bash", description: "CI checks" },
        ],
        new Set(["watch-1"]),
      ),
    ).toEqual([
      { id: "bash-1", kind: "shell", description: "npm run dev" },
      { id: "watch-1", kind: "monitor", description: "CI checks" },
    ]);
  });
});
