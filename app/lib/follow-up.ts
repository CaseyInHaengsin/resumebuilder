import type { ApplicationStatus } from "~/db/schema";
import { daysBetween } from "~/lib/dates";

export const DAYS_STALE = 14;

export type FollowUpFlag = { kind: "overdue" | "stale"; days: number } | null;

export type FollowUpRow = {
  status: ApplicationStatus;
  appliedAt: string | null;
  nextStepAt: string | null;
  lastContactAt: string | null;
};

/** Pure: `today` is a YYYY-MM-DD string supplied by the server. */
export function followUpFlag(row: FollowUpRow, today: string): FollowUpFlag {
  if (row.status === "accepted" || row.status === "rejected") return null;

  if (row.nextStepAt) {
    const late = daysBetween(row.nextStepAt, today);
    if (late > 0) return { kind: "overdue", days: late };
  }

  if (row.status === "applied" || row.status === "interviewing") {
    const last = [row.appliedAt, row.lastContactAt]
      .filter((d): d is string => !!d && Number.isFinite(daysBetween(d, today)))
      .sort()
      .pop();
    if (last) {
      const quiet = daysBetween(last, today);
      if (quiet >= DAYS_STALE) return { kind: "stale", days: quiet };
    }
  }
  return null;
}
