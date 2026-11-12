// Pure: builds the home page's "Today" lists. Bundled for the browser too, so
// no server-only imports here.
import type { ApplicationStatus } from "~/db/schema";
import { daysBetween } from "~/lib/dates";
import { followUpFlag } from "~/lib/follow-up";

/** Upcoming covers next steps from tomorrow through this many days out. */
export const UPCOMING_DAYS = 7;

export type TodayRow = {
  id: number;
  jobTitle: string;
  companyName: string | null;
  status: ApplicationStatus;
  appliedAt: string | null;
  nextStepAt: string | null;
  lastContactAt: string | null;
};

export type TodayItem = {
  id: number;
  jobTitle: string;
  companyName: string | null;
  status: ApplicationStatus;
  /** The next step's date, or for a stale item the last applied/contact date. */
  date: string | null;
  /** Days overdue, days until the next step, or days of quiet. */
  days: number;
};

export type TodayView = {
  overdue: TodayItem[];
  dueToday: TodayItem[];
  upcoming: TodayItem[];
  stale: TodayItem[];
};

/**
 * Sorts applications into what needs attention on `today` (YYYY-MM-DD). Each
 * row lands in at most one list; a dated next step within the week wins over
 * a long quiet spell. Closed applications never appear.
 */
export function buildTodayView(rows: TodayRow[], today: string): TodayView {
  const view: TodayView = { overdue: [], dueToday: [], upcoming: [], stale: [] };

  for (const row of rows) {
    const item = (date: string | null, days: number): TodayItem => ({
      id: row.id,
      jobTitle: row.jobTitle,
      companyName: row.companyName,
      status: row.status,
      date,
      days,
    });

    const flag = followUpFlag(row, today);
    if (flag?.kind === "overdue") {
      view.overdue.push(item(row.nextStepAt, flag.days));
      continue;
    }
    if (row.status === "accepted" || row.status === "rejected") continue;

    const until = row.nextStepAt ? daysBetween(today, row.nextStepAt) : NaN;
    if (until === 0) {
      view.dueToday.push(item(row.nextStepAt, 0));
      continue;
    }
    if (until > 0 && until <= UPCOMING_DAYS) {
      view.upcoming.push(item(row.nextStepAt, until));
      continue;
    }

    if (flag?.kind === "stale") {
      // The same date followUpFlag measured the quiet spell from.
      const last = [row.appliedAt, row.lastContactAt]
        .filter((d): d is string => !!d && Number.isFinite(daysBetween(d, today)))
        .sort()
        .pop();
      view.stale.push(item(last ?? null, flag.days));
    }
  }

  const byDaysDesc = (a: TodayItem, b: TodayItem) => b.days - a.days || a.id - b.id;
  const byDaysAsc = (a: TodayItem, b: TodayItem) => a.days - b.days || a.id - b.id;
  view.overdue.sort(byDaysDesc);
  view.dueToday.sort(byDaysAsc);
  view.upcoming.sort(byDaysAsc);
  view.stale.sort(byDaysDesc);
  return view;
}
