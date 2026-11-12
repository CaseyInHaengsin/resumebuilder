import { beforeAll, describe, expect, it } from "vitest";

type Status = "wishlist" | "applied" | "interviewing" | "offer" | "accepted" | "rejected";
type TodayRow = {
  id: number;
  jobTitle: string;
  companyName: string | null;
  status: Status;
  appliedAt: string | null;
  nextStepAt: string | null;
  lastContactAt: string | null;
};
type TodayItem = {
  id: number;
  jobTitle: string;
  companyName: string | null;
  status: Status;
  date: string | null;
  days: number;
};
type TodayView = {
  overdue: TodayItem[];
  dueToday: TodayItem[];
  upcoming: TodayItem[];
  stale: TodayItem[];
};
type TodayModule = { buildTodayView(rows: TodayRow[], today: string): TodayView };

const TODAY = "2026-11-11";

let buildTodayView: TodayModule["buildTodayView"];

beforeAll(async () => {
  ({ buildTodayView } = (await import("~/lib/today")) as unknown as TodayModule);
});

function row(id: number, overrides: Partial<TodayRow> = {}): TodayRow {
  return {
    id,
    jobTitle: `Role ${id}`,
    companyName: null,
    status: "applied",
    appliedAt: null,
    nextStepAt: null,
    lastContactAt: null,
    ...overrides,
  };
}

const ids = (items: TodayItem[]) => items.map((i) => i.id);
const idsByList = (view: TodayView) => ({
  overdue: ids(view.overdue),
  dueToday: ids(view.dueToday),
  upcoming: ids(view.upcoming),
  stale: ids(view.stale),
});
const NOWHERE = { overdue: [], dueToday: [], upcoming: [], stale: [] };

describe("buildTodayView", () => {
  it("sorts applications into overdue, due today, upcoming and stale", () => {
    const rows: TodayRow[] = [
      row(1, { nextStepAt: "2026-11-10", status: "interviewing", companyName: "Larkspur Freight", jobTitle: "Senior Backend Engineer" }),
      row(2, { nextStepAt: "2026-11-01", status: "wishlist" }),
      row(3, { nextStepAt: TODAY, status: "offer" }),
      row(4, { nextStepAt: "2026-11-18", appliedAt: "2026-11-09" }),
      row(5, { nextStepAt: "2026-11-12" }),
      row(6, { nextStepAt: "2026-11-19", appliedAt: "2026-11-05" }),
      row(7, { appliedAt: "2026-10-01" }),
      row(8, { status: "interviewing", appliedAt: "2026-09-01", lastContactAt: "2026-10-20", companyName: "Brindle & Wren Health" }),
      row(9, { status: "accepted", nextStepAt: "2026-11-01" }),
      row(10, { status: "rejected", appliedAt: "2026-08-01" }),
      row(11, { appliedAt: "2026-11-05" }),
    ];

    expect(buildTodayView(rows, TODAY)).toEqual({
      overdue: [
        { id: 2, jobTitle: "Role 2", companyName: null, status: "wishlist", date: "2026-11-01", days: 10 },
        { id: 1, jobTitle: "Senior Backend Engineer", companyName: "Larkspur Freight", status: "interviewing", date: "2026-11-10", days: 1 },
      ],
      dueToday: [
        { id: 3, jobTitle: "Role 3", companyName: null, status: "offer", date: TODAY, days: 0 },
      ],
      upcoming: [
        { id: 5, jobTitle: "Role 5", companyName: null, status: "applied", date: "2026-11-12", days: 1 },
        { id: 4, jobTitle: "Role 4", companyName: null, status: "applied", date: "2026-11-18", days: 7 },
      ],
      stale: [
        { id: 7, jobTitle: "Role 7", companyName: null, status: "applied", date: "2026-10-01", days: 41 },
        { id: 8, jobTitle: "Role 8", companyName: "Brindle & Wren Health", status: "interviewing", date: "2026-10-20", days: 22 },
      ],
    });
  });

  it("returns four empty lists for no rows", () => {
    expect(buildTodayView([], TODAY)).toEqual(NOWHERE);
  });

  it("orders overdue by most overdue, upcoming by soonest and stale by longest quiet", () => {
    const view = buildTodayView(
      [
        row(1, { nextStepAt: "2026-11-09" }),
        row(2, { nextStepAt: "2026-10-01" }),
        row(3, { nextStepAt: "2026-11-05" }),
        row(4, { nextStepAt: "2026-11-17" }),
        row(5, { nextStepAt: "2026-11-13" }),
        row(6, { nextStepAt: "2026-11-15" }),
        row(7, { appliedAt: "2026-10-20" }),
        row(8, { appliedAt: "2026-07-04" }),
        row(9, { status: "interviewing", appliedAt: "2026-06-01", lastContactAt: "2026-10-10" }),
      ],
      TODAY,
    );
    expect(idsByList(view)).toEqual({
      overdue: [2, 3, 1],
      dueToday: [],
      upcoming: [5, 6, 4],
      stale: [8, 9, 7],
    });
    expect(view.overdue.map((i) => i.days)).toEqual([41, 6, 2]);
    expect(view.upcoming.map((i) => i.days)).toEqual([2, 4, 6]);
    expect(view.stale.map((i) => i.days)).toEqual([130, 32, 22]);
  });

  it("treats the next seven days as upcoming and no further", () => {
    const view = buildTodayView(
      [
        row(1, { nextStepAt: "2026-11-18" }),
        row(2, { nextStepAt: "2026-11-19" }),
        row(3, { nextStepAt: "2026-12-25" }),
      ],
      TODAY,
    );
    expect(idsByList(view)).toEqual({ ...NOWHERE, upcoming: [1] });
    expect(view.upcoming[0]).toMatchObject({ date: "2026-11-18", days: 7 });
  });

  it("calls an application stale from 14 quiet days, as followUpFlag does", () => {
    const view = buildTodayView(
      [
        row(1, { appliedAt: "2026-10-29" }), // 13 days
        row(2, { appliedAt: "2026-10-28" }), // 14 days
        row(3, { status: "interviewing", appliedAt: "2026-09-01", lastContactAt: "2026-10-30" }), // 12 days
      ],
      TODAY,
    );
    expect(idsByList(view)).toEqual({ ...NOWHERE, stale: [2] });
    expect(view.stale[0]).toMatchObject({ date: "2026-10-28", days: 14 });
  });

  it("dates a stale item by the later of appliedAt and lastContactAt", () => {
    const view = buildTodayView(
      [
        row(1, { status: "interviewing", appliedAt: "2026-09-01", lastContactAt: "2026-10-05" }),
        row(2, { appliedAt: "2026-10-12", lastContactAt: "2026-09-20" }),
        row(3, { status: "interviewing", lastContactAt: "2026-10-01" }),
      ],
      TODAY,
    );
    expect(view.stale.map((i) => [i.id, i.date, i.days])).toEqual([
      [3, "2026-10-01", 41],
      [1, "2026-10-05", 37],
      [2, "2026-10-12", 30],
    ]);
  });

  it.each(["wishlist", "offer"] as const)(
    "does not call a quiet %s application stale",
    (status) => {
      const view = buildTodayView([row(1, { status, appliedAt: "2026-08-01" })], TODAY);
      expect(view).toEqual(NOWHERE);
    },
  );

  it.each(["accepted", "rejected"] as const)("never lists a %s application", (status) => {
    const view = buildTodayView(
      [
        row(1, { status, nextStepAt: "2026-11-01" }),
        row(2, { status, nextStepAt: TODAY }),
        row(3, { status, nextStepAt: "2026-11-13" }),
        row(4, { status, appliedAt: "2026-08-01", lastContactAt: "2026-08-15" }),
      ],
      TODAY,
    );
    expect(view).toEqual(NOWHERE);
  });

  it("lists a row once: a dated next step wins over a long quiet spell", () => {
    const quiet = { appliedAt: "2026-08-01" };
    const view = buildTodayView(
      [
        row(1, { ...quiet, nextStepAt: "2026-11-04" }),
        row(2, { ...quiet, nextStepAt: TODAY }),
        row(3, { ...quiet, nextStepAt: "2026-11-14" }),
        row(4, { ...quiet, nextStepAt: "2026-12-15" }),
        row(5, quiet),
      ],
      TODAY,
    );
    expect(idsByList(view)).toEqual({
      overdue: [1],
      dueToday: [2],
      upcoming: [3],
      // A next step more than a week out does not hide a stale application.
      stale: [4, 5],
    });
    // Overdue counts days past the next step, not days of quiet.
    expect(view.overdue[0]).toMatchObject({ date: "2026-11-04", days: 7 });
    expect(view.dueToday[0]).toMatchObject({ date: TODAY, days: 0 });
    expect(view.upcoming[0]).toMatchObject({ date: "2026-11-14", days: 3 });
    expect(view.stale[0]).toMatchObject({ date: "2026-08-01", days: 102 });
  });

  it("ignores a next step that is not a date", () => {
    const view = buildTodayView(
      [
        row(1, { nextStepAt: "next week" }),
        row(2, { nextStepAt: "next week", appliedAt: "2026-10-01" }),
        row(3, { nextStepAt: "" }),
      ],
      TODAY,
    );
    expect(idsByList(view)).toEqual({ ...NOWHERE, stale: [2] });
  });

  it("works from the date it is given, not the clock", () => {
    const rows = [
      row(1, { nextStepAt: "2031-03-09" }),
      row(2, { nextStepAt: "2031-03-10" }),
      row(3, { nextStepAt: "2031-03-12" }),
      row(4, { appliedAt: "2031-02-01" }),
    ];
    expect(idsByList(buildTodayView(rows, "2031-03-10"))).toEqual({
      overdue: [1],
      dueToday: [2],
      upcoming: [3],
      stale: [4],
    });
    // Across a month and a leap day.
    const leap = buildTodayView([row(5, { nextStepAt: "2028-02-27" })], "2028-03-01");
    expect(leap.overdue.map((i) => [i.id, i.days])).toEqual([[5, 3]]);
  });

  it("does not change the rows it is given", () => {
    const rows = [
      row(1, { nextStepAt: "2026-11-09" }),
      row(2, { nextStepAt: "2026-10-01" }),
      row(3, { appliedAt: "2026-10-01" }),
    ];
    const before = structuredClone(rows);
    const first = buildTodayView(rows, TODAY);
    expect(rows).toEqual(before);
    expect(buildTodayView(rows, TODAY)).toEqual(first);
  });
});
