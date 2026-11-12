import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "~/db/schema";
import { DAYS_STALE, followUpFlag } from "~/lib/follow-up";

const TODAY = "2026-11-11";

type Row = Parameters<typeof followUpFlag>[0];

function row(overrides: Partial<Row> = {}): Row {
  return {
    status: "applied",
    appliedAt: null,
    nextStepAt: null,
    lastContactAt: null,
    ...overrides,
  };
}

const ACTIVE: ApplicationStatus[] = ["applied", "interviewing"];
const TERMINAL: ApplicationStatus[] = ["accepted", "rejected"];
const OVERDUE_ONLY: ApplicationStatus[] = ["wishlist", "offer"];
const ALL: ApplicationStatus[] = [...OVERDUE_ONLY, ...ACTIVE, ...TERMINAL];

describe("DAYS_STALE", () => {
  it("is 14", () => {
    expect(DAYS_STALE).toBe(14);
  });
});

describe("followUpFlag: overdue", () => {
  it("does not flag a next step due today", () => {
    expect(followUpFlag(row({ nextStepAt: TODAY }), TODAY)).toBeNull();
  });

  it("flags a next step due yesterday as 1 day overdue", () => {
    expect(followUpFlag(row({ nextStepAt: "2026-11-10" }), TODAY)).toEqual({
      kind: "overdue",
      days: 1,
    });
  });

  it("counts calendar days late", () => {
    expect(followUpFlag(row({ nextStepAt: "2026-10-31" }), TODAY)).toEqual({
      kind: "overdue",
      days: 11,
    });
  });

  it("does not flag a next step in the future", () => {
    expect(followUpFlag(row({ nextStepAt: "2026-11-12" }), TODAY)).toBeNull();
    expect(followUpFlag(row({ nextStepAt: "2027-01-01" }), TODAY)).toBeNull();
  });

  it.each([...OVERDUE_ONLY, ...ACTIVE])(
    "applies to status %s",
    (status) => {
      expect(
        followUpFlag(row({ status, nextStepAt: "2026-11-08" }), TODAY),
      ).toEqual({ kind: "overdue", days: 3 });
    },
  );

  it("wins over stale", () => {
    expect(
      followUpFlag(
        row({ appliedAt: "2026-09-01", nextStepAt: "2026-11-10" }),
        TODAY,
      ),
    ).toEqual({ kind: "overdue", days: 1 });
  });
});

describe("followUpFlag: stale", () => {
  it.each(ACTIVE)(
    "flags %s exactly 14 days after applying with no contact",
    (status) => {
      expect(
        followUpFlag(row({ status, appliedAt: "2026-10-28" }), TODAY),
      ).toEqual({ kind: "stale", days: 14 });
    },
  );

  it.each(ACTIVE)("does not flag %s 13 days after applying", (status) => {
    expect(
      followUpFlag(row({ status, appliedAt: "2026-10-29" }), TODAY),
    ).toBeNull();
  });

  it("reports the number of days since applying", () => {
    expect(followUpFlag(row({ appliedAt: "2026-10-01" }), TODAY)).toEqual({
      kind: "stale",
      days: 41,
    });
  });

  it.each(ACTIVE)(
    "flags %s that went quiet after a contact, counting from the contact",
    (status) => {
      expect(
        followUpFlag(
          row({ status, appliedAt: "2026-09-01", lastContactAt: "2026-10-20" }),
          TODAY,
        ),
      ).toEqual({ kind: "stale", days: 22 });
    },
  );

  it("does not flag when the last contact was within 14 days", () => {
    expect(
      followUpFlag(
        row({ appliedAt: "2026-09-01", lastContactAt: "2026-10-29" }),
        TODAY,
      ),
    ).toBeNull();
  });

  it("counts from the applied date when it is later than the last contact", () => {
    // A recruiter reached out before the application went in.
    expect(
      followUpFlag(
        row({ appliedAt: "2026-10-25", lastContactAt: "2026-10-01" }),
        TODAY,
      ),
    ).toEqual({ kind: "stale", days: 17 });
    expect(
      followUpFlag(
        row({ appliedAt: "2026-11-05", lastContactAt: "2026-10-01" }),
        TODAY,
      ),
    ).toBeNull();
  });

  it("counts from the last contact when there is no applied date", () => {
    expect(
      followUpFlag(
        row({ status: "interviewing", lastContactAt: "2026-10-20" }),
        TODAY,
      ),
    ).toEqual({ kind: "stale", days: 22 });
  });

  it.each(ACTIVE)("does not flag %s with no dates at all", (status) => {
    expect(followUpFlag(row({ status }), TODAY)).toBeNull();
  });

  it("still flags when the next step is today or later", () => {
    expect(
      followUpFlag(row({ appliedAt: "2026-10-01", nextStepAt: TODAY }), TODAY),
    ).toEqual({ kind: "stale", days: 41 });
    expect(
      followUpFlag(
        row({ appliedAt: "2026-10-01", nextStepAt: "2026-11-20" }),
        TODAY,
      ),
    ).toEqual({ kind: "stale", days: 41 });
  });

  it.each(OVERDUE_ONLY)("never applies to %s", (status) => {
    expect(
      followUpFlag(
        row({ status, appliedAt: "2026-08-01", lastContactAt: "2026-08-15" }),
        TODAY,
      ),
    ).toBeNull();
  });
});

describe("followUpFlag: terminal statuses", () => {
  it.each(TERMINAL)("never flags %s", (status) => {
    expect(
      followUpFlag(row({ status, nextStepAt: "2026-11-01" }), TODAY),
    ).toBeNull();
    expect(
      followUpFlag(row({ status, appliedAt: "2026-08-01" }), TODAY),
    ).toBeNull();
    expect(
      followUpFlag(
        row({
          status,
          appliedAt: "2026-08-01",
          lastContactAt: "2026-08-15",
          nextStepAt: "2026-09-01",
        }),
        TODAY,
      ),
    ).toBeNull();
  });
});

describe("followUpFlag: uses the given today, not the clock", () => {
  it("gives a different answer for a different today", () => {
    const r = row({ nextStepAt: "2026-11-11", appliedAt: "2026-11-01" });
    expect(followUpFlag(r, "2026-11-11")).toBeNull();
    expect(followUpFlag(r, "2026-11-12")).toEqual({ kind: "overdue", days: 1 });
    expect(followUpFlag(row({ appliedAt: "2026-11-01" }), "2026-11-15")).toEqual({
      kind: "stale",
      days: 14,
    });
  });

  it.each(ALL)("returns null for %s with no dates", (status) => {
    expect(followUpFlag(row({ status }), TODAY)).toBeNull();
  });
});
