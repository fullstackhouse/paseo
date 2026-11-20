import { describe, expect, test } from "vitest";
import { type AdmissionTicket, PriorityAdmission } from "./priority-admission.js";

function createGate(): { promise: Promise<void>; open: () => void } {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("PriorityAdmission", () => {
  test("admits interactive work ahead of background work queued before it", async () => {
    const admission = new PriorityAdmission(1);
    const started: string[] = [];
    const blocker = createGate();
    const run = (name: string, ticket: AdmissionTicket, gate?: Promise<void>) =>
      admission.run(ticket, async () => {
        started.push(name);
        await gate;
      });

    const runs = [
      run("busy", { priority: "background" }, blocker.promise),
      run("background-1", { priority: "background" }),
      run("background-2", { priority: "background" }),
      run("interactive", { priority: "interactive" }),
    ];
    expect(admission.pendingCount).toBe(3);

    blocker.open();
    await Promise.all(runs);

    expect(started).toEqual(["busy", "interactive", "background-1", "background-2"]);
  });

  test("promotes a waiting ticket when its priority is raised", async () => {
    const admission = new PriorityAdmission(1);
    const started: string[] = [];
    const blocker = createGate();
    const promoted: AdmissionTicket = { priority: "background" };
    const runs = [
      admission.run({ priority: "background" }, () => blocker.promise),
      admission.run({ priority: "background" }, () => {
        started.push("other");
      }),
      admission.run(promoted, () => {
        started.push("promoted");
      }),
    ];

    promoted.priority = "interactive";
    blocker.open();
    await Promise.all(runs);

    expect(started).toEqual(["promoted", "other"]);
  });

  test("never runs more than the concurrency limit at once", async () => {
    const admission = new PriorityAdmission(2);
    let active = 0;
    let maxActive = 0;
    const work = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    };
    const priorities = ["interactive", "background"] as const;
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        admission.run({ priority: priorities[index % 2]! }, work),
      ),
    );
    expect(maxActive).toBe(2);
    expect(admission.activeCount).toBe(0);
  });

  test("releases the slot when work throws", async () => {
    const admission = new PriorityAdmission(1);
    await expect(
      admission.run({ priority: "background" }, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(admission.run({ priority: "background" }, () => "next")).resolves.toBe("next");
  });

  test("clear rejects waiting work with an AbortError", async () => {
    const admission = new PriorityAdmission(1);
    const blocker = createGate();
    const running = admission.run({ priority: "background" }, () => blocker.promise);
    const waiting = admission.run({ priority: "interactive" }, () => "never");

    admission.clear();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(admission.pendingCount).toBe(0);
    blocker.open();
    await running;
  });
});
