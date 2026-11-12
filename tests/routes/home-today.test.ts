import { createUser, seedApplication, seedCompany } from "../helpers/db";
import { getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { TODAY, TOMORROW, useDenverClock, YESTERDAY } from "../helpers/timeline";
import { describe, expect, it } from "vitest";

useDenverClock();

type Item = {
  id: number;
  jobTitle: string;
  companyName: string | null;
  status: string;
  date: string | null;
  days: number;
};
type HomeData = {
  today: string;
  view: { overdue: Item[]; dueToday: Item[]; upcoming: Item[]; stale: Item[] };
};

async function home(cookie?: string) {
  const { loader } = await import("~/routes/home");
  return run(loader, getRequest("/", cookie));
}

describe("home loader: Today view", () => {
  it("redirects to login when signed out", async () => {
    const result = await home();
    expect(result).toBeInstanceOf(Response);
    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toMatch(/^\/login/);
  });

  it("returns today in APP_TIMEZONE and the signed-in user's applications sorted into the view", async () => {
    const user = await createUser();
    const stranger = await createUser();
    const company = await seedCompany(user.id, "Larkspur Freight");

    const overdue = await seedApplication(user.id, {
      jobTitle: "Senior Backend Engineer",
      companyId: company.id,
      status: "interviewing",
      nextStepAt: YESTERDAY,
    });
    // On a UTC clock this one would be overdue and the next one due today.
    const dueToday = await seedApplication(user.id, {
      jobTitle: "Platform Engineer",
      appliedAt: "2026-11-09",
      nextStepAt: TODAY,
    });
    const upcoming = await seedApplication(user.id, {
      jobTitle: "Frontend Engineer",
      status: "wishlist",
      nextStepAt: TOMORROW,
    });
    const stale = await seedApplication(user.id, {
      jobTitle: "Data Engineer",
      appliedAt: "2026-10-01",
    });
    await seedApplication(user.id, {
      jobTitle: "Closed role",
      status: "rejected",
      nextStepAt: YESTERDAY,
    });
    await seedApplication(user.id, { jobTitle: "Fresh application", appliedAt: "2026-11-05" });
    await seedApplication(stranger.id, {
      jobTitle: "Stranger's overdue role",
      nextStepAt: "2026-11-01",
    });

    const result = await home(await sessionCookie(user.id));
    expect(result).not.toBeInstanceOf(Response);
    const data = result as HomeData;
    expect(data.today).toBe(TODAY);
    expect(data.view).toEqual({
      overdue: [
        {
          id: overdue.id,
          jobTitle: "Senior Backend Engineer",
          companyName: "Larkspur Freight",
          status: "interviewing",
          date: YESTERDAY,
          days: 1,
        },
      ],
      dueToday: [
        { id: dueToday.id, jobTitle: "Platform Engineer", companyName: null, status: "applied", date: TODAY, days: 0 },
      ],
      upcoming: [
        { id: upcoming.id, jobTitle: "Frontend Engineer", companyName: null, status: "wishlist", date: TOMORROW, days: 1 },
      ],
      stale: [
        { id: stale.id, jobTitle: "Data Engineer", companyName: null, status: "applied", date: "2026-10-01", days: 41 },
      ],
    });
  });

  it("matches buildTodayView over the user's rows", async () => {
    const user = await createUser();
    const company = await seedCompany(user.id, "Brindle & Wren Health");
    const rows = [
      await seedApplication(user.id, { jobTitle: "A", nextStepAt: "2026-11-03", companyId: company.id }),
      await seedApplication(user.id, { jobTitle: "B", nextStepAt: "2026-11-16" }),
      await seedApplication(user.id, { jobTitle: "C", status: "interviewing", appliedAt: "2026-09-01", lastContactAt: "2026-10-15" }),
      await seedApplication(user.id, { jobTitle: "D", nextStepAt: "2026-10-20" }),
    ];
    const { buildTodayView } = (await import("~/lib/today")) as unknown as {
      buildTodayView(rows: unknown[], today: string): HomeData["view"];
    };
    const expected = buildTodayView(
      rows.map((r) => ({
        id: r.id,
        jobTitle: r.jobTitle,
        companyName: r.companyId === company.id ? "Brindle & Wren Health" : null,
        status: r.status,
        appliedAt: r.appliedAt,
        nextStepAt: r.nextStepAt,
        lastContactAt: r.lastContactAt,
      })),
      TODAY,
    );

    const data = (await home(await sessionCookie(user.id))) as HomeData;
    expect(data.view).toEqual(expected);
    expect(data.view.overdue.map((i) => i.jobTitle)).toEqual(["D", "A"]);
    expect(data.view.upcoming.map((i) => i.jobTitle)).toEqual(["B"]);
    expect(data.view.stale.map((i) => i.jobTitle)).toEqual(["C"]);
  });

  it("returns an empty view for a user with no applications", async () => {
    const user = await createUser();
    const data = (await home(await sessionCookie(user.id))) as HomeData;
    expect(data.today).toBe(TODAY);
    expect(data.view).toEqual({ overdue: [], dueToday: [], upcoming: [], stale: [] });
  });
});
