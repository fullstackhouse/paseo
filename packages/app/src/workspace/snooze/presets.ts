export type SnoozePresetId = "indefinite" | "tonight" | "tomorrow" | "nextWeek";

export interface SnoozePreset {
  id: SnoozePresetId;
  /** ISO end of the snooze; null snoozes until the user wakes it. */
  until: string | null;
}

const EVENING_HOUR = 20;
const MORNING_HOUR = 9;

function atLocalHour(base: Date, dayOffset: number, hour: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/**
 * The menu's snooze choices in local time. Tonight is 20:00 and drops out once it has passed;
 * next week is the coming Monday at 09:00.
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const presets: SnoozePreset[] = [];
  const tonight = atLocalHour(now, 0, EVENING_HOUR);
  if (tonight > now) presets.push({ id: "tonight", until: tonight.toISOString() });
  presets.push({ id: "tomorrow", until: atLocalHour(now, 1, MORNING_HOUR).toISOString() });
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  presets.push({
    id: "nextWeek",
    until: atLocalHour(now, daysUntilMonday, MORNING_HOUR).toISOString(),
  });
  presets.push({ id: "indefinite", until: null });
  return presets;
}
