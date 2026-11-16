import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { describe, expect, it } from "vitest";
import type { AggregatedSchedule } from "./aggregated-schedules";
import { collectScheduleAttention } from "./schedule-attention";

const NOW = new Date("2026-11-15T10:00:00.000Z");

function makeRun(overrides: Partial<ScheduleRun>): ScheduleRun {
  return {
    id: "run-1",
    scheduledFor: "2026-11-15T08:00:00.000Z",
    startedAt: "2026-11-15T08:00:00.000Z",
    endedAt: "2026-11-15T08:46:00.000Z",
    status: "succeeded",
    agentId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "wks_1",
    output: null,
    error: null,
    attention: { reason: "plugin", message: "1 open ask", resolvedAt: null },
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<AggregatedSchedule>): AggregatedSchedule {
  return {
    id: "sched-1",
    name: "Weekly Dependabot merge",
    prompt: "Merge dependabot PRs",
    cadence: { type: "every", everyMs: 60_000 },
    target: { type: "new-agent", config: { provider: "claude", cwd: "/repo" } },
    status: "active",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    serverId: "srv-1",
    serverName: "Laptop",
    ...overrides,
  };
}

describe("collectScheduleAttention", () => {
  it("lists unresolved runs across schedules, newest first, with a readable reason", () => {
    const items = collectScheduleAttention(
      [
        makeSchedule({ attentionRuns: [makeRun({})] }),
        makeSchedule({
          id: "sched-2",
          name: "Weekly fsh rebase",
          attentionRuns: [
            makeRun({
              id: "run-2",
              startedAt: "2026-11-15T09:00:00.000Z",
              attention: { reason: "permission", message: null, resolvedAt: null },
            }),
          ],
        }),
      ],
      NOW,
    );

    expect(items.map((item) => [item.scheduleTitle, item.reasonLabel, item.message])).toEqual([
      ["Weekly fsh rebase", "Waiting for permission", null],
      ["Weekly Dependabot merge", "Needs you", "1 open ask"],
    ]);
    expect(items[1]).toMatchObject({
      key: "srv-1:sched-1:run-1",
      serverId: "srv-1",
      agentId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "wks_1",
    });
  });

  it("skips resolved runs and hosts that don't report attention", () => {
    const items = collectScheduleAttention(
      [
        makeSchedule({
          attentionRuns: [
            makeRun({
              attention: { reason: "failed", message: "x", resolvedAt: NOW.toISOString() },
            }),
          ],
        }),
        makeSchedule({ id: "old-host" }),
      ],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("still lists a reason a newer host invented", () => {
    const [item] = collectScheduleAttention(
      [
        makeSchedule({
          attentionRuns: [
            makeRun({ attention: { reason: "quota", message: null, resolvedAt: null } }),
          ],
        }),
      ],
      NOW,
    );
    expect(item?.reasonLabel).toBe("Needs you");
  });
});
