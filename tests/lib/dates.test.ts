import { afterEach, describe, expect, it, vi } from "vitest";
import { appToday, daysBetween, todayIn } from "~/lib/dates";

// 6:30pm on Nov 11 in Denver, 1:30am on Nov 12 in UTC.
const EVENING_IN_DENVER = new Date("2026-11-12T01:30:00Z");

const savedZone = process.env.APP_TIMEZONE;

afterEach(() => {
  vi.useRealTimers();
  if (savedZone === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = savedZone;
});

describe("todayIn", () => {
  it("gives the calendar date in the named zone, not the UTC date", () => {
    expect(todayIn("America/Denver", EVENING_IN_DENVER)).toBe("2026-11-11");
    expect(todayIn("UTC", EVENING_IN_DENVER)).toBe("2026-11-12");
    expect(todayIn("Asia/Tokyo", EVENING_IN_DENVER)).toBe("2026-11-12");
  });

  it("gives a later date than UTC in zones ahead of UTC", () => {
    const lateUtc = new Date("2026-11-11T23:30:00Z");
    expect(todayIn("UTC", lateUtc)).toBe("2026-11-11");
    expect(todayIn("Asia/Tokyo", lateUtc)).toBe("2026-11-12");
    expect(todayIn("America/Denver", lateUtc)).toBe("2026-11-11");
  });

  it("follows daylight saving time rather than a fixed offset", () => {
    // Summer: Denver is UTC-6, so 05:30Z is still June 30 and 06:30Z is July 1.
    expect(todayIn("America/Denver", new Date("2026-07-01T05:30:00Z"))).toBe(
      "2026-06-30",
    );
    expect(todayIn("America/Denver", new Date("2026-07-01T06:30:00Z"))).toBe(
      "2026-07-01",
    );
    // Winter: Denver is UTC-7, so 06:30Z is still the previous day.
    expect(todayIn("America/Denver", new Date("2026-01-15T06:30:00Z"))).toBe(
      "2026-01-14",
    );
    expect(todayIn("America/Denver", new Date("2026-01-15T07:30:00Z"))).toBe(
      "2026-01-15",
    );
  });

  it("zero-pads month and day", () => {
    expect(todayIn("UTC", new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });

  it("uses the process's local zone when the zone is undefined", () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    for (const now of [EVENING_IN_DENVER, new Date("2026-07-01T05:30:00Z")]) {
      const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      expect(todayIn(undefined, now)).toBe(local);
    }
  });

  it("defaults to the current time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_IN_DENVER);
    expect(todayIn("America/Denver")).toBe("2026-11-11");
    expect(todayIn("UTC")).toBe("2026-11-12");
  });
});

describe("appToday", () => {
  it("uses APP_TIMEZONE, read at call time", () => {
    process.env.APP_TIMEZONE = "America/Denver";
    expect(appToday(EVENING_IN_DENVER)).toBe("2026-11-11");
    process.env.APP_TIMEZONE = "Asia/Tokyo";
    expect(appToday(EVENING_IN_DENVER)).toBe("2026-11-12");
  });

  it("defaults to the current time", () => {
    process.env.APP_TIMEZONE = "America/Denver";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_IN_DENVER);
    expect(appToday()).toBe("2026-11-11");
  });

  it("falls back to the process's local zone when APP_TIMEZONE is unset", () => {
    delete process.env.APP_TIMEZONE;
    expect(appToday(EVENING_IN_DENVER)).toBe(
      todayIn(undefined, EVENING_IN_DENVER),
    );
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days from the first date to the second", () => {
    expect(daysBetween("2026-11-11", "2026-11-11")).toBe(0);
    expect(daysBetween("2026-11-10", "2026-11-11")).toBe(1);
    expect(daysBetween("2026-10-28", "2026-11-11")).toBe(14);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetween("2026-11-12", "2026-11-11")).toBe(-1);
    expect(daysBetween("2026-12-01", "2026-11-11")).toBe(-20);
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("is not thrown off by daylight saving changes", () => {
    // US clocks change on 2026-03-08 and 2026-11-01.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
  });

  it("reads only the date part of a longer timestamp", () => {
    expect(daysBetween("2026-11-10T23:59:59.000Z", "2026-11-11")).toBe(1);
    expect(daysBetween("2026-11-10T00:00:01.000Z", "2026-11-11")).toBe(1);
    expect(daysBetween("2026-11-11", "2026-11-11T23:59:59.000Z")).toBe(0);
    expect(
      daysBetween("2026-11-01T18:00:00-07:00", "2026-11-03T01:00:00+09:00"),
    ).toBe(2);
  });

  it("returns NaN for input that does not start with a date", () => {
    expect(daysBetween("", "2026-11-11")).toBeNaN();
    expect(daysBetween("2026-11-11", "")).toBeNaN();
    expect(daysBetween("soon", "2026-11-11")).toBeNaN();
    expect(daysBetween("2026-11-11", "next week")).toBeNaN();
    expect(daysBetween("11/10/2026", "2026-11-11")).toBeNaN();
  });
});
