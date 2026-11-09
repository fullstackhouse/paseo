import { describe, expect, it } from "vitest";
import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { describeScheduleRun, describeScheduleRuns } from "./schedule-runs";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

function run(overrides: Partial<ScheduleRun>): ScheduleRun {
  return {
    id: "run-1",
    scheduledFor: "2026-11-08T09:00:00.000Z",
    startedAt: "2026-11-08T09:00:00.000Z",
    endedAt: "2026-11-08T09:04:12.000Z",
    status: "succeeded",
    agentId: AGENT_ID,
    workspaceId: "ws-1",
    output: null,
    error: null,
    ...overrides,
  };
}

const NOW = new Date("2026-11-08T10:00:00.000Z");

describe("describeScheduleRun", () => {
  it("describes a finished run with its duration and agent", () => {
    const view = describeScheduleRun(run({}), NOW);
    expect(view.badge).toEqual({ label: "Succeeded", variant: "success" });
    expect(view.durationLabel).toBe("Took 4m 12s");
    expect(view.error).toBeNull();
    expect(view.agentId).toBe(AGENT_ID);
    expect(view.workspaceId).toBe("ws-1");
  });

  it("counts a running run's duration up to now", () => {
    const view = describeScheduleRun(
      run({ status: "running", endedAt: null, startedAt: "2026-11-08T09:58:30.000Z" }),
      NOW,
    );
    expect(view.badge.label).toBe("Running");
    expect(view.durationLabel).toBe("Running for 1m 30s");
  });

  it("shows the error only for failed runs", () => {
    expect(describeScheduleRun(run({ status: "failed", error: " boom " }), NOW).error).toBe("boom");
    expect(describeScheduleRun(run({ status: "failed", error: "  " }), NOW).error).toBeNull();
    expect(describeScheduleRun(run({ error: "stale" }), NOW).error).toBeNull();
  });

  it("keeps the agent's final message as the run's report", () => {
    expect(describeScheduleRun(run({ output: "\n## Done\n" }), NOW).output).toBe("## Done");
    expect(describeScheduleRun(run({ output: " " }), NOW).output).toBeNull();
    expect(describeScheduleRun(run({ output: null }), NOW).output).toBeNull();
  });

  it("treats a missing workspace as null", () => {
    expect(describeScheduleRun(run({ workspaceId: undefined }), NOW).workspaceId).toBeNull();
  });
});

describe("describeScheduleRuns", () => {
  it("orders runs newest-first", () => {
    const views = describeScheduleRuns(
      [
        run({ id: "old", startedAt: "2026-11-01T09:00:00.000Z" }),
        run({ id: "new", startedAt: "2026-11-08T09:00:00.000Z" }),
      ],
      NOW,
    );
    expect(views.map((view) => view.id)).toEqual(["new", "old"]);
  });
});
