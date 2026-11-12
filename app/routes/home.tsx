import { Link, useLoaderData } from "react-router";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { applications, companies, type ApplicationStatus } from "~/db/schema";
import { requireUserId } from "~/lib/auth.server";
import { appToday } from "~/lib/dates";
import { buildTodayView, type TodayItem } from "~/lib/today";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const rows = db
    .select({
      id: applications.id,
      jobTitle: applications.jobTitle,
      companyName: companies.name,
      status: applications.status,
      appliedAt: applications.appliedAt,
      nextStepAt: applications.nextStepAt,
      lastContactAt: applications.lastContactAt,
    })
    .from(applications)
    .leftJoin(companies, eq(companies.id, applications.companyId))
    .where(eq(applications.userId, userId))
    .all();
  const today = appToday();
  return { today, view: buildTodayView(rows, today) };
}

const STATUS_BADGE: Record<ApplicationStatus, { label: string; className: string }> = {
  wishlist: { label: "Wishlist", className: "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300" },
  applied: { label: "Applied", className: "bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200" },
  interviewing: { label: "Interviewing", className: "bg-purple-200 dark:bg-purple-900 text-purple-800 dark:text-purple-200" },
  offer: { label: "Offer", className: "bg-amber-200 dark:bg-amber-900 text-amber-800 dark:text-amber-200" },
  accepted: { label: "Accepted", className: "bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200" },
  rejected: { label: "Rejected", className: "bg-rose-200 dark:bg-rose-900 text-rose-800 dark:text-rose-200" },
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Wednesday, November 11, 2026" for a YYYY-MM-DD date, without a time zone shift. */
function longDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default function Today() {
  const { today, view } = useLoaderData<typeof loader>();
  const sections: { title: string; items: TodayItem[]; describe: (i: TodayItem) => string }[] = [
    { title: "Overdue", items: view.overdue, describe: (i) => `${plural(i.days, "day")} overdue` },
    { title: "Due today", items: view.dueToday, describe: () => "today" },
    { title: "Upcoming (next 7 days)", items: view.upcoming, describe: (i) => (i.days === 1 ? "tomorrow" : `in ${plural(i.days, "day")}`) },
    { title: "Gone quiet", items: view.stale, describe: (i) => `quiet for ${plural(i.days, "day")}` },
  ];
  const shown = sections.filter((s) => s.items.length > 0);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Today</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{longDate(today)}</p>
      </div>

      {shown.length === 0 ? (
        <p className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5 text-sm text-gray-600 dark:text-gray-400">
          Nothing needs attention today.
        </p>
      ) : (
        shown.map((section) => (
          <section
            key={section.title}
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5 space-y-2"
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {section.title}
            </h3>
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {section.items.map((item) => {
                const badge = STATUS_BADGE[item.status];
                return (
                  <li key={item.id}>
                    <Link
                      to={`/applications/${item.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {item.jobTitle}
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {item.companyName ?? "—"}
                      </span>
                      <span className={`text-[10px] rounded-full px-2 py-0.5 ${badge.className}`}>
                        {badge.label}
                      </span>
                      <span className="ml-auto text-gray-500 dark:text-gray-400">
                        {section.describe(item)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <div className="flex gap-6 text-sm">
        <Link to="/applications" className="text-blue-600 dark:text-blue-400 hover:underline">
          Applications board
        </Link>
        <Link to="/builder" className="text-blue-600 dark:text-blue-400 hover:underline">
          Resumes
        </Link>
        <Link to="/library" className="text-blue-600 dark:text-blue-400 hover:underline">
          Library
        </Link>
      </div>
    </div>
  );
}
