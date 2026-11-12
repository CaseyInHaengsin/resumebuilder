/**
 * Shared fixtures and types for the keyword coverage tests (phase 10).
 * No database access here, so the pure tests can import it without ./db.
 */
import type { ResumeData } from "~/components/pdf/types";

export type Term = { term: string; count: number };
export type LibraryItem = {
  kind: "bullet" | "skill";
  id: number;
  text: string;
  selected: boolean;
};
export type CoverageTerm = Term & {
  status: "covered" | "available" | "missing";
  suggestions: { kind: "bullet" | "skill"; id: number }[];
};
export type Coverage = { total: number; coveredCount: number; terms: CoverageTerm[] };

/** The contract of app/lib/keywords.ts. */
export type KeywordsModule = {
  KNOWN_TERMS: Iterable<string>;
  extractTerms(description: string, vocabulary: string[]): Term[];
  termAppearsIn(term: string, text: string): boolean;
  analyzeCoverage(input: {
    description: string;
    resume: ResumeData;
    library: LibraryItem[];
    vocabulary: string[];
  }): Coverage;
};

export async function loadKeywords(): Promise<KeywordsModule> {
  return (await import("~/lib/keywords")) as unknown as KeywordsModule;
}

/**
 * A full posting for a fictional company. Counts of the watched terms, with
 * aliases folded in, are listed in POSTING_WATCHED below.
 *
 * It deliberately contains things a naive tokenizer trips on: "going", "good"
 * and lowercase "go"; all-caps section headings; USA, PTO, EEO; hyphenated
 * words; "and/or"; "e.g."; "5+", "40,000", "$165,000"; SQL inside PostgreSQL.
 */
export const POSTING = `Senior Backend Engineer, Routing Platform

ABOUT THE ROLE
Larkspur Freight moves more than 40,000 loads a day for shippers across the USA and Canada, and the Routing Platform team owns the services that price and dispatch every one of them. We are a remote-first company going through a good stretch of growth, and we need an engineer who likes to go deep on hard problems and/or mentor others while doing it. You will work day-to-day with product, data science and our operations staff.

WHAT YOU WILL DO
- Design, build and operate services written in Go and TypeScript, running on Kubernetes in AWS.
- Own our PostgreSQL schemas and the Kafka pipelines that feed them. Most of our reporting is plain SQL.
- Ship GraphQL and REST endpoints used by our React dashboard and by partner integrations.
- Keep our CI/CD pipeline fast and our Terraform modules boring, so a new hire can deploy on day one.
- Join the on-call rotation (roughly one week in six) and write the postmortems nobody else wants to.

MUST HAVE
- 5+ years building backend systems in Go, Python or a similar language; our older services are in Ruby.
- Strong Postgres skills: indexing, query plans, zero-downtime migrations. We run Postgres 16.
- Production experience with Docker and K8s, including debugging a cluster in the middle of the night.
- Comfort with typed JavaScript. Most of our tooling is TS, and javascript fluency matters more than framework trivia.
- Experience securing services with OAuth, e.g. token exchange between internal services.

NICE TO HAVE
- Redis, MongoDB or another store you have operated under load.
- Exposure to Node.js services; we still run a few on Node.
- Infrastructure as code beyond Terraform, or continuous integration systems you have built yourself.

BENEFITS AND PAY
The salary range for this role is $165,000 to $190,000 plus equity. We offer unlimited PTO, a retirement match and a home-office stipend. Larkspur Freight is an EEO employer; we consider all qualified applicants without regard to race, religion, gender or any other protected status.`;

/**
 * The watched terms in the order extractTerms must return them: most frequent
 * first, ties by first appearance in POSTING.
 */
export const POSTING_WATCHED: Term[] = [
  { term: "PostgreSQL", count: 3 }, // PostgreSQL, Postgres, Postgres
  { term: "Go", count: 2 },
  { term: "TypeScript", count: 2 }, // TypeScript, TS
  { term: "Kubernetes", count: 2 }, // Kubernetes, K8s
  { term: "CI/CD", count: 2 }, // CI/CD, continuous integration
  { term: "Terraform", count: 2 },
  { term: "JavaScript", count: 2 }, // JavaScript, javascript
  { term: "Node.js", count: 2 }, // Node.js, Node
  { term: "AWS", count: 1 },
  { term: "Kafka", count: 1 },
  { term: "SQL", count: 1 }, // not the SQL inside PostgreSQL
  { term: "GraphQL", count: 1 },
  { term: "REST", count: 1 },
  { term: "React", count: 1 },
  { term: "Python", count: 1 },
  { term: "Ruby", count: 1 },
  { term: "Docker", count: 1 },
  { term: "OAuth", count: 1 },
  { term: "Redis", count: 1 },
  { term: "MongoDB", count: 1 },
];

/** A second, shorter posting for a different fictional company. */
export const POSTING_FRONTEND = `Frontend Engineer at Brindle & Wren Health

We are a twelve-person team building scheduling software for independent clinics. You will own the patient booking flow end to end: the React components, the GraphQL layer behind them and the tests that keep both honest. We deploy several times a day and we would like to keep it that way.

Requirements
- Three or more years of professional React and TypeScript.
- Solid CSS fundamentals and an eye for accessible markup.
- Experience with GraphQL clients and caching.
- Some exposure to Elixir is welcome, since our API is a Phoenix LiveView application backed by Oban jobs.
- You write tests without being asked.`;

export function resumeOf(parts: Partial<ResumeData> = {}): ResumeData {
  return {
    contact: { name: "Dana Whitlock", email: "dana@whitlock.example" },
    summary: "",
    jobs: [],
    skills: [],
    projects: [],
    education: null,
    ...parts,
  };
}

/** Case-insensitive lookup of a term in an extractTerms / analyzeCoverage result. */
export function find<T extends { term: string }>(terms: T[], name: string): T | undefined {
  return terms.find((t) => t.term.toLowerCase() === name.toLowerCase());
}

export function names(terms: { term: string }[]): string[] {
  return terms.map((t) => t.term);
}
