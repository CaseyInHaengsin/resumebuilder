/**
 * Keyword coverage: which technical terms in a job posting a resume covers.
 * Plain term matching, no network. Pure and browser-safe: no server imports.
 */
import type { ResumeData } from "~/components/pdf/types";

export type Term = { term: string; count: number };
export type LibraryItem = {
  kind: "bullet" | "skill";
  id: number;
  text: string;
  selected: boolean;
};
export type CoverageStatus = "covered" | "available" | "missing";
export type CoverageTerm = Term & {
  status: CoverageStatus;
  suggestions: { kind: "bullet" | "skill"; id: number }[];
};
export type Coverage = { total: number; coveredCount: number; terms: CoverageTerm[] };

const MAX_SUGGESTIONS = 5;

/**
 * The built-in dictionary. Each row is the canonical spelling followed by its
 * aliases. A leading "!" makes a spelling case-sensitive, used for words that
 * are also ordinary English ("Go", "Node", "Rust") or short abbreviations
 * ("JS", "TS", "REST"). Every other spelling matches in any case.
 */
const DICTIONARY: string[][] = [
  // Languages
  ["JavaScript", "!JS"],
  ["TypeScript", "!TS"],
  ["Python"],
  ["Java"],
  ["!Go", "Golang"],
  ["!Rust"],
  ["!Ruby"],
  ["PHP"],
  ["C++"],
  ["C#"],
  ["F#"],
  ["!Swift"],
  ["Kotlin"],
  ["Scala"],
  ["Elixir"],
  ["Erlang"],
  ["Clojure"],
  ["Haskell"],
  ["OCaml"],
  ["Perl"],
  ["!Dart"],
  ["Lua"],
  ["Objective-C"],
  ["!Bash"],
  ["PowerShell"],
  ["SQL"],
  ["NoSQL"],
  ["HTML"],
  ["CSS"],
  ["Sass"],
  ["SCSS"],
  ["Solidity"],
  ["Groovy"],
  ["COBOL"],
  ["MATLAB"],
  ["!Julia"],
  ["Zig"],
  [".NET"],
  ["ASP.NET"],
  // Frontend and mobile
  ["React", "React.js", "ReactJS"],
  ["React Native"],
  ["Vue", "Vue.js", "VueJS"],
  ["Angular", "AngularJS"],
  ["Svelte"],
  ["Next.js", "NextJS"],
  ["Nuxt"],
  ["Redux"],
  ["jQuery"],
  ["Webpack"],
  ["Vite"],
  ["Babel"],
  ["ESLint"],
  ["Storybook"],
  ["Tailwind CSS", "Tailwind"],
  ["Bootstrap"],
  ["Electron"],
  ["Flutter"],
  ["Android"],
  ["iOS"],
  ["SwiftUI"],
  ["WebAssembly", "WASM"],
  ["WebSockets", "WebSocket"],
  ["Apollo"],
  // Backend frameworks and runtimes
  ["Node.js", "!Node", "NodeJS"],
  ["Deno"],
  ["!Express", "Express.js", "ExpressJS"],
  ["NestJS"],
  ["Django"],
  ["!Flask"],
  ["FastAPI"],
  ["Ruby on Rails", "!Rails"],
  ["!Spring", "Spring Boot"],
  ["Laravel"],
  ["Symfony"],
  ["gRPC"],
  ["GraphQL"],
  ["!REST", "RESTful"],
  ["API", "APIs"],
  ["Microservices", "Microservice"],
  ["Distributed systems", "Distributed system"],
  ["Event-driven", "Event driven"],
  ["SaaS"],
  ["!Phoenix"],
  ["LiveView", "Live View"],
  ["Ecto"],
  ["Absinthe"],
  ["OpenAPI", "Swagger"],
  // Databases and data
  ["PostgreSQL", "Postgres"],
  ["MySQL"],
  ["MariaDB"],
  ["SQLite"],
  ["SQL Server", "MSSQL"],
  ["MongoDB", "Mongo"],
  ["Redis"],
  ["DynamoDB"],
  ["Cassandra"],
  ["Elasticsearch"],
  ["OpenSearch"],
  ["CouchDB"],
  ["Neo4j"],
  ["Memcached"],
  ["ClickHouse"],
  ["Snowflake"],
  ["BigQuery"],
  ["Redshift"],
  ["Firebase"],
  ["Supabase"],
  ["Kafka"],
  ["RabbitMQ"],
  ["ActiveMQ"],
  ["!Spark", "Apache Spark"],
  ["Hadoop"],
  ["!Hive"],
  ["Flink"],
  ["Trino"],
  ["Databricks"],
  ["Airflow"],
  ["dbt"],
  ["ETL"],
  ["Tableau"],
  ["Looker"],
  ["Power BI"],
  // Machine learning
  ["Machine Learning", "ML"],
  ["Deep Learning"],
  ["NLP"],
  ["LLM", "LLMs"],
  ["TensorFlow"],
  ["PyTorch"],
  ["scikit-learn", "sklearn"],
  ["Pandas"],
  ["NumPy"],
  ["Jupyter"],
  ["OpenAI"],
  ["LangChain"],
  // Cloud
  ["AWS", "Amazon Web Services"],
  ["Google Cloud", "GCP", "Google Cloud Platform"],
  ["Azure"],
  ["Heroku"],
  ["Vercel"],
  ["Netlify"],
  ["Cloudflare"],
  ["DigitalOcean"],
  ["Fly.io"],
  ["EC2"],
  ["S3"],
  ["!Lambda", "AWS Lambda"],
  ["ECS"],
  ["EKS"],
  ["RDS"],
  ["SQS"],
  ["SNS"],
  ["CloudFormation"],
  ["Serverless"],
  // Infrastructure and tooling
  ["Kubernetes", "K8s"],
  ["Docker"],
  ["Terraform"],
  ["Ansible"],
  ["Pulumi"],
  ["Helm"],
  ["!Chef"],
  ["!Puppet"],
  ["Jenkins"],
  ["GitHub Actions"],
  ["GitHub"],
  ["GitLab"],
  ["Bitbucket"],
  ["Git"],
  ["CircleCI"],
  ["Travis CI"],
  ["ArgoCD"],
  ["CI/CD", "CI CD", "CI-CD", "CICD", "Continuous Integration", "Continuous Delivery", "Continuous Deployment"],
  ["Infrastructure as Code", "IaC"],
  ["DevOps"],
  ["SRE", "Site Reliability Engineering"],
  ["Datadog"],
  ["Grafana"],
  ["Prometheus"],
  ["Splunk"],
  ["New Relic"],
  ["!Sentry"],
  ["PagerDuty"],
  ["OpenTelemetry"],
  ["Observability"],
  ["Nginx"],
  ["Apache"],
  ["HAProxy"],
  ["Envoy"],
  ["Istio"],
  ["Linux"],
  ["Unix"],
  ["Jira"],
  ["Figma"],
  ["Postman"],
  // Testing
  ["Jest"],
  ["Vitest"],
  ["!Mocha"],
  ["!Cypress"],
  ["Playwright"],
  ["Selenium"],
  ["Pytest"],
  ["JUnit"],
  ["RSpec"],
  ["TDD"],
  ["BDD"],
  // Practices, security and compliance
  ["Agile"],
  ["Scrum"],
  ["Kanban"],
  ["DDD"],
  ["OAuth", "OAuth2", "OAuth 2.0", "OAuth2.0", "OAuth 2"],
  ["OpenID Connect", "OIDC"],
  ["SAML"],
  ["JWT"],
  ["HIPAA"],
  ["GDPR"],
  ["SOC 2", "SOC2"],
  ["Stripe"],
  ["Twilio"],
  ["Salesforce"],
];

/** Canonical spellings of the built-in dictionary. */
export const KNOWN_TERMS: readonly string[] = DICTIONARY.map((row) => row[0].replace(/^!/, ""));

// ── Matching engine ──

type Spec = { text: string; cs: boolean };
type Entry = { canonical: string; regex: RegExp; byKey: Map<string, Spec> };

const BEFORE = "(?<![A-Za-z0-9_])";
const AFTER = "(?![A-Za-z0-9_])";

const normalize = (s: string) => s.trim().replace(/\s+/g, " ");
const keyOf = (s: string) => normalize(s).toLowerCase();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function makeEntry(canonical: string, specs: Spec[]): Entry {
  const byKey = new Map(specs.map((s) => [keyOf(s.text), s]));
  const alternatives = specs
    .map((s) => normalize(s.text).split(" ").map(escapeRegExp).join("\\s+"))
    .sort((a, b) => b.length - a.length);
  const regex = new RegExp(`${BEFORE}(?:${alternatives.join("|")})${AFTER}`, "gi");
  return { canonical, regex, byKey };
}

type Hit = { start: number; end: number };

function hitsOf(entry: Entry, text: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of text.matchAll(entry.regex)) {
    const spec = entry.byKey.get(keyOf(m[0]));
    if (spec?.cs && normalize(m[0]) !== spec.text) continue;
    hits.push({ start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

let dictionaryEntries: Entry[] | null = null;
let dictionaryIndex: Map<string, Entry> | null = null;

function loadDictionary(): { entries: Entry[]; index: Map<string, Entry> } {
  if (!dictionaryEntries || !dictionaryIndex) {
    dictionaryEntries = DICTIONARY.map((row) => {
      const specs = row.map((raw) => ({ text: raw.replace(/^!/, ""), cs: raw.startsWith("!") }));
      return makeEntry(specs[0].text, specs);
    });
    dictionaryIndex = new Map();
    for (const entry of dictionaryEntries) {
      for (const key of entry.byKey.keys()) if (!dictionaryIndex.has(key)) dictionaryIndex.set(key, entry);
    }
  }
  return { entries: dictionaryEntries, index: dictionaryIndex };
}

const literalEntries = new Map<string, Entry>();

/** The entry for a term: a dictionary entry through any of its spellings, else the literal text. */
function entryForTerm(term: string): Entry | null {
  const key = keyOf(term);
  if (!key) return null;
  const known = loadDictionary().index.get(key);
  if (known) return known;
  let entry = literalEntries.get(key);
  if (!entry) {
    entry = makeEntry(normalize(term), [{ text: normalize(term), cs: false }]);
    if (literalEntries.size > 2000) literalEntries.clear();
    literalEntries.set(key, entry);
  }
  return entry;
}

/** Whether `term` (or any alias of it) appears in `text` as a whole word. */
export function termAppearsIn(term: string, text: string): boolean {
  if (!text) return false;
  const entry = entryForTerm(term);
  return entry ? hitsOf(entry, text).length > 0 : false;
}

// ── Terms that look technical but are not in any list ──

/** Uppercase words that are ordinary English or non-technical acronyms. */
const NOT_TECHNICAL = new Set(
  (
    "A AN AND ARE AS AT BE BUT BY CAN DO FOR FROM GO HAS HAVE HOW IF IN INTO IS IT ITS MAY MUST NEW NO NOT NOW OF ON ONE " +
    "OR OUR OUT OWN PAY ROLE SEE SO THAN THE THEIR THEM THEN THIS TO UP US USE WE WHAT WHEN WHO WHY WILL WITH YOU YOUR " +
    "ALL ANY BOTH EACH FEW MORE MOST NICE ABOUT ABOVE AFTER BEING BELOW BONUS CORE DAILY DAYS EVERY FULL GOOD GREAT HELP " +
    "HIRING HOME JOIN JOBS KEY LEAD LIFE LOVE MAKE MANY MEET NEED NEXT ONLY OPEN OVER PART PLUS REAL SOME SUCH TEAM TIME " +
    "UPON VERY WANT WELL WORK YEAR YEARS REMOTE HYBRID SENIOR JUNIOR STAFF TOTAL BASE RANGE NOTE EQUITY BENEFITS PERKS " +
    "USA UK EU UAE USD EUR GBP CAD AUD PTO EEO EOE AAP HR CEO CTO CFO COO CIO CMO VP SVP EVP FAQ ASAP FYI ETA LLC INC LTD " +
    "CORP PM AM OK NA TBD NYC SF LA DC FTE RSVP DEI LGBTQ ADA FLSA IRS RN MBA PHD BS BA MS MA GPA ID PDF ZIP SSN COVID " +
    "MON TUE WED THU FRI SAT SUN JAN FEB MAR APR JUN JUL AUG SEP SEPT OCT NOV DEC EST PST CST MST UTC GMT"
  ).split(" "),
);
const NOT_TECHNICAL_MIXED = new Set(["B2B", "B2C", "H1B", "Q1", "Q2", "Q3", "Q4", "W2", "MP3", "MP4", "COVID19"]);

const TOKEN = /(?<![A-Za-z0-9_])\.?[A-Za-z][A-Za-z0-9]*(?:\+\+|#)?/g;

function isTechnicalToken(token: string, inHeading: boolean): boolean {
  if (/^[A-Z]{2,6}$/.test(token)) return !inHeading && !NOT_TECHNICAL.has(token);
  if (NOT_TECHNICAL_MIXED.has(token.toUpperCase())) return false;
  if (/^[A-Za-z][A-Za-z0-9]*(?:\+\+|#)$/.test(token)) return true; // C++, C#
  if (/^\.[A-Z][A-Za-z0-9]*$/.test(token)) return true; // .NET
  return /^[A-Z][A-Za-z]*\d[A-Za-z0-9]*$/.test(token); // S3, HL7, X12
}

/** Marks character positions on lines written entirely in capitals (section headings). */
function headingMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let offset = 0;
  for (const line of text.split("\n")) {
    const words = line.match(/[A-Za-z]+/g) ?? [];
    if (words.length >= 2 && !/[a-z]/.test(line)) mask.fill(true, offset, offset + line.length);
    offset += line.length + 1;
  }
  return mask;
}

// ── Extraction ──

/** The caller's own terms, minus blanks, dictionary spellings and repeats that differ by case. */
function vocabularyEntries(vocabulary: string[]): Entry[] {
  const { index } = loadDictionary();
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const raw of vocabulary) {
    const spelling = normalize(raw ?? "");
    const key = spelling.toLowerCase();
    if (spelling.length < 2 || spelling.length > 40 || seen.has(key)) continue;
    seen.add(key);
    if (index.has(key)) continue;
    entries.push(makeEntry(spelling, [{ text: spelling, cs: false }]));
  }
  return entries;
}

export function extractTerms(description: string, vocabulary: string[]): Term[] {
  if (!description || !description.trim()) return [];
  const { entries: dictionary, index } = loadDictionary();
  const entries = [...dictionary, ...vocabularyEntries(vocabulary)];

  // Collect every hit, then keep the earliest and longest where hits overlap.
  const all: { entry: Entry; start: number; end: number }[] = [];
  for (const entry of entries) {
    for (const hit of hitsOf(entry, description)) all.push({ entry, ...hit });
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);

  const claimed = new Array<boolean>(description.length).fill(false);
  const found = new Map<string, { term: string; count: number; first: number }>();
  const note = (key: string, term: string, first: number) => {
    const current = found.get(key);
    if (current) current.count += 1;
    else found.set(key, { term, count: 1, first });
  };
  let lastEnd = 0;
  for (const hit of all) {
    if (hit.start < lastEnd) continue;
    lastEnd = hit.end;
    claimed.fill(true, hit.start, hit.end);
    note(hit.entry.canonical.toLowerCase(), hit.entry.canonical, hit.start);
  }

  // Tokens that look technical but are not listed anywhere.
  const headings = headingMask(description);
  const tokens: { text: string; start: number }[] = [];
  for (const m of description.matchAll(TOKEN)) {
    const end = m.index + m[0].length;
    let overlaps = false;
    for (let i = m.index; i < end; i++) {
      if (claimed[i]) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps && !index.has(m[0].toLowerCase())) tokens.push({ text: m[0], start: m.index });
  }
  const spellings = new Map<string, string>();
  for (const t of tokens) {
    const key = t.text.toLowerCase();
    if (!spellings.has(key) && isTechnicalToken(t.text, headings[t.start])) spellings.set(key, t.text);
  }
  for (const t of tokens) {
    const key = t.text.toLowerCase();
    const spelling = spellings.get(key);
    if (spelling && !found.has(key)) note(key, spelling, t.start);
    else if (spelling) found.get(key)!.count += 1;
  }

  return [...found.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .map(({ term, count }) => ({ term, count }));
}

// ── Coverage ──

/** The text a printed resume shows: summary, job titles, project names and tech, bullets, skill items. */
function printedText(resume: ResumeData): string {
  const parts: string[] = [resume.summary];
  for (const job of resume.jobs) parts.push(job.title, ...job.bullets);
  for (const project of resume.projects) parts.push(project.name, project.tech, ...project.bullets);
  for (const row of resume.skills) parts.push(...row.items);
  return parts.filter(Boolean).join("\n");
}

export function analyzeCoverage(input: {
  description: string;
  resume: ResumeData;
  library: LibraryItem[];
  vocabulary: string[];
}): Coverage {
  const terms = extractTerms(input.description, input.vocabulary);
  const printed = printedText(input.resume);
  const unselected = input.library.filter((item) => !item.selected);
  const unselectedBullets = unselected.filter((item) => item.kind === "bullet");
  const unselectedSkills = unselected.filter((item) => item.kind === "skill");

  const result: CoverageTerm[] = terms.map(({ term, count }) => {
    if (termAppearsIn(term, printed)) return { term, count, status: "covered", suggestions: [] };
    const suggestions = [...unselectedBullets, ...unselectedSkills]
      .filter((item) => termAppearsIn(term, item.text))
      .slice(0, MAX_SUGGESTIONS)
      .map(({ kind, id }) => ({ kind, id }));
    return { term, count, status: suggestions.length ? "available" : "missing", suggestions };
  });

  return {
    total: result.length,
    coveredCount: result.filter((t) => t.status === "covered").length,
    terms: result,
  };
}
