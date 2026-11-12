import { beforeAll, describe, expect, it } from "vitest";
import {
  find,
  loadKeywords,
  names,
  POSTING,
  POSTING_FRONTEND,
  POSTING_WATCHED,
  resumeOf,
  type KeywordsModule,
  type LibraryItem,
} from "../helpers/coverage";

let kw: KeywordsModule;

beforeAll(async () => {
  kw = await loadKeywords();
});

const lower = (terms: { term: string }[]) => terms.map((t) => t.term.toLowerCase());

describe("KNOWN_TERMS", () => {
  it("holds the canonical spelling of common software terms", () => {
    expect([...kw.KNOWN_TERMS]).toEqual(
      expect.arrayContaining([
        "JavaScript",
        "TypeScript",
        "Python",
        "Go",
        "Ruby",
        "Elixir",
        "React",
        "Node.js",
        "GraphQL",
        "PostgreSQL",
        "MongoDB",
        "Redis",
        "Kubernetes",
        "Docker",
        "AWS",
        "Terraform",
        "CI/CD",
        "OAuth",
        "REST",
        "Kafka",
      ]),
    );
  });
});

describe("extractTerms: a full posting", () => {
  it("returns the watched terms with canonical names and alias-folded counts, most frequent first then by first appearance", () => {
    const terms = kw.extractTerms(POSTING, []);
    const watched = new Set(POSTING_WATCHED.map((t) => t.term));
    expect(terms.filter((t) => watched.has(t.term))).toEqual(POSTING_WATCHED);
  });

  it("sorts the whole list by count, highest first", () => {
    const counts = kw.extractTerms(POSTING, []).map((t) => t.count);
    expect(counts.length).toBeGreaterThanOrEqual(POSTING_WATCHED.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    for (const c of counts) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(1);
    }
  });

  it("lists each term once, whatever its spelling in the posting", () => {
    const all = lower(kw.extractTerms(POSTING, []));
    expect(new Set(all).size).toBe(all.length);
    // Aliases are folded into the canonical term, never listed beside it.
    for (const alias of ["postgres", "ts", "js", "k8s", "node", "nodejs", "golang", "continuous integration"]) {
      expect(all, `alias "${alias}" listed as its own term`).not.toContain(alias);
    }
  });

  it("does not split CI/CD, PostgreSQL, GraphQL, JavaScript or TypeScript into smaller terms", () => {
    const all = lower(kw.extractTerms(POSTING, []));
    for (const part of ["ci", "cd", "ql", "java", "script", "type", "graph", "c"]) {
      expect(all, `"${part}" listed as a term`).not.toContain(part);
    }
  });

  it("leaves out all-caps English words, section headings and non-technical acronyms", () => {
    const all = lower(kw.extractTerms(POSTING, []));
    for (const word of [
      "usa", "pto", "eeo", "and",
      "about", "the", "role", "what", "you", "will", "do",
      "must", "have", "nice", "to", "pay", "benefits",
    ]) {
      expect(all, `"${word}" listed as a term`).not.toContain(word);
    }
  });

  it("leaves out ordinary words, hyphenated words, 'and/or', 'e.g.' and numbers", () => {
    const terms = kw.extractTerms(POSTING, []);
    const all = lower(terms);
    for (const word of [
      "going", "good", "larkspur", "freight", "canada", "senior", "design", "strong",
      "experience", "remote-first", "day-to-day", "on-call", "zero-downtime",
      "home-office", "and/or", "e.g.", "e.g", "5+", "16", "40,000", "$165,000", "165,000",
    ]) {
      expect(all, `"${word}" listed as a term`).not.toContain(word);
    }
    for (const t of terms) {
      expect(t.term, "a term needs at least one letter").toMatch(/[A-Za-z]/);
      expect(t.term, "a hyphenated lowercase word is not a term").not.toMatch(/^[a-z]+(-[a-z]+)+$/);
      expect(t.term).toBe(t.term.trim());
    }
  });

  it("counts Go only where the posting names the language", () => {
    // POSTING also contains "going", "good" and lowercase "go deep".
    expect(find(kw.extractTerms(POSTING, []), "Go")).toEqual({ term: "Go", count: 2 });
  });

  it("is deterministic and does not depend on the vocabulary for dictionary terms", () => {
    const plain = kw.extractTerms(POSTING, []);
    expect(kw.extractTerms(POSTING, [])).toEqual(plain);
    const watched = new Set(POSTING_WATCHED.map((t) => t.term));
    expect(
      kw.extractTerms(POSTING, ["Rust", "Haskell"]).filter((t) => watched.has(t.term)),
    ).toEqual(POSTING_WATCHED);
  });
});

describe("extractTerms: Go", () => {
  it.each([
    ["We are going to keep going, and it is a good place to go far.", "lowercase go, going, good"],
    ["Our stack is on Google Cloud with MongoDB and Django.", "Go inside other words"],
    ["You will go above and beyond; let's go.", "lowercase go as a verb"],
  ])("does not find Go in %j (%s)", (text) => {
    expect(lower(kw.extractTerms(text, []))).not.toContain("go");
  });

  it("finds capitalized Go and Golang as one term named Go", () => {
    const terms = kw.extractTerms(
      "Services are written in Go. Prior Golang experience helps, and you will go deep on Go tooling.",
      [],
    );
    expect(find(terms, "Go")).toEqual({ term: "Go", count: 3 });
    expect(lower(terms)).not.toContain("golang");
  });
});

describe("extractTerms: aliases and canonical names", () => {
  it.each([
    ["Strong postgres experience required.", "PostgreSQL"],
    ["Strong Postgres experience required.", "PostgreSQL"],
    ["Strong POSTGRESQL experience required.", "PostgreSQL"],
    ["We write a lot of JS here.", "JavaScript"],
    ["We write a lot of TS here.", "TypeScript"],
    ["You have run K8s in production.", "Kubernetes"],
    ["You have run k8s in production.", "Kubernetes"],
    ["Backend services run on Node and Express.", "Node.js"],
    ["Backend services run on NodeJS and Express.", "Node.js"],
    ["Backend services run on node.js and Express.", "Node.js"],
    ["Data lives in Mongo for now.", "MongoDB"],
    ["You own our CI CD setup.", "CI/CD"],
    ["You care about continuous integration.", "CI/CD"],
    ["You care about Continuous Integration.", "CI/CD"],
    ["Expert-level typescript is expected.", "TypeScript"],
    ["Our API is graphql first.", "GraphQL"],
  ])("%j yields %s", (text, canonical) => {
    const terms = kw.extractTerms(text, []);
    expect(names(terms)).toContain(canonical);
    expect(find(terms, canonical)?.count).toBe(1);
  });

  it("adds alias and canonical mentions into one count", () => {
    const terms = kw.extractTerms(
      "We run Postgres. Our PostgreSQL cluster is large, and postgres tuning is part of the job. " +
        "The front end is JavaScript; JS experience is required.",
      [],
    );
    expect(terms.slice(0, 2)).toEqual([
      { term: "PostgreSQL", count: 3 },
      { term: "JavaScript", count: 2 },
    ]);
  });

  it("treats GCP and Google Cloud as one term", () => {
    const terms = kw.extractTerms(
      "Everything runs on GCP. Experience with Google Cloud networking is a plus.",
      [],
    );
    const cloud = terms.filter((t) => /^(GCP|Google Cloud( Platform)?)$/.test(t.term));
    expect(cloud).toHaveLength(1);
    expect(cloud[0].count).toBe(2);
  });

  it("does not read Java into JavaScript, or JavaScript into Java", () => {
    expect(lower(kw.extractTerms("Deep JavaScript knowledge and some TypeScript.", []))).not.toContain("java");
    const java = kw.extractTerms("Deep Java knowledge on the JVM.", []);
    expect(lower(java)).not.toContain("javascript");
  });

  it("matches a term followed by punctuation", () => {
    const terms = kw.extractTerms(
      "Our stack: React, Redis; Kafka. You know (Docker) and Terraform/AWS. Do you like Elixir?",
      [],
    );
    expect(names(terms)).toEqual(["React", "Redis", "Kafka", "Docker", "Terraform", "AWS", "Elixir"]);
    expect(terms.every((t) => t.count === 1)).toBe(true);
  });
});

describe("extractTerms: technical tokens outside the dictionary", () => {
  it("keeps all-caps acronyms of 2 to 6 letters that are not English words", () => {
    const terms = kw.extractTerms(
      "You will write SQL daily AND expose GRPC services. We are based in the USA, offer generous PTO and are an EEO employer.",
      [],
    );
    expect(find(terms, "SQL")).toEqual({ term: "SQL", count: 1 });
    expect(find(terms, "GRPC")?.count).toBe(1);
    for (const word of ["and", "usa", "pto", "eeo"]) {
      expect(lower(terms)).not.toContain(word);
    }
  });

  it("ignores all-caps runs longer than six letters and single letters", () => {
    const all = lower(
      kw.extractTerms("IMPORTANT: RESPONSIBILITIES include plan A and plan B. QUALIFICATIONS follow.", []),
    );
    for (const word of ["important", "responsibilities", "qualifications", "a", "b"]) {
      expect(all).not.toContain(word);
    }
  });

  it("keeps tokens with a symbol or digit in them, as written, without trailing punctuation", () => {
    const terms = kw.extractTerms(
      "Firmware is C++, tooling is C#. Our services are .NET, files live in S3, and we exchange HL7 and X12 messages.",
      [],
    );
    expect(names(terms)).toEqual(expect.arrayContaining(["C++", "C#", ".NET", "S3", "HL7", "X12"]));
    for (const t of ["C++", "C#", ".NET", "S3", "HL7", "X12"]) {
      expect(find(terms, t)?.count, t).toBe(1);
    }
  });

  it("recognizes OAuth2", () => {
    const terms = kw.extractTerms("Secure the public endpoints with OAuth2 and rotate keys.", []);
    const oauth = terms.filter((t) => /^OAuth( ?2(\.0)?)?$/.test(t.term));
    expect(oauth).toHaveLength(1);
    expect(oauth[0].count).toBe(1);
  });

  it("does not treat C alone as a term", () => {
    const terms = kw.extractTerms("Experience with C, C++ or C# is required. Plan C is Rust.", []);
    expect(lower(terms)).not.toContain("c");
    expect(find(terms, "C++")?.count).toBe(1);
    expect(find(terms, "C#")?.count).toBe(1);
  });

  it("uses the spelling of the first appearance for a term it does not know", () => {
    const terms = kw.extractTerms("We exchange HL7 messages. Knowing hl7 well matters.", []);
    expect(find(terms, "HL7")).toEqual({ term: "HL7", count: 2 });
  });
});

describe("extractTerms: the caller's vocabulary", () => {
  const VOCABULARY = ["Phoenix LiveView", "Oban", "Accessibility", "Ash", "Tailwind"];

  it("finds vocabulary terms, single and multi-word, in the vocabulary's spelling", () => {
    const terms = kw.extractTerms(
      "Our API is a phoenix liveview application backed by oban jobs. Phoenix LiveView experience is a plus, and accessibility matters to us.",
      VOCABULARY,
    );
    expect(find(terms, "Phoenix LiveView")).toEqual({ term: "Phoenix LiveView", count: 2 });
    expect(find(terms, "Oban")).toEqual({ term: "Oban", count: 1 });
    expect(find(terms, "Accessibility")).toEqual({ term: "Accessibility", count: 1 });
  });

  it("does not find those words without the vocabulary", () => {
    const all = lower(kw.extractTerms(POSTING_FRONTEND, []));
    expect(all).not.toContain("oban");
    expect(all).not.toContain("phoenix liveview");
    expect(all).toEqual(expect.arrayContaining(["react", "typescript", "graphql", "elixir"]));
  });

  it("orders vocabulary terms with dictionary terms by count then first appearance", () => {
    const terms = kw.extractTerms(POSTING_FRONTEND, ["Oban", "Phoenix LiveView", "CSS"]);
    const watched = ["React", "GraphQL", "TypeScript", "CSS", "Elixir", "Phoenix LiveView", "Oban"];
    expect(terms.filter((t) => watched.includes(t.term))).toEqual([
      { term: "React", count: 2 },
      { term: "GraphQL", count: 2 },
      { term: "TypeScript", count: 1 },
      { term: "CSS", count: 1 },
      { term: "Elixir", count: 1 },
      { term: "Phoenix LiveView", count: 1 },
      { term: "Oban", count: 1 },
    ]);
  });

  it("only returns vocabulary terms that the posting mentions", () => {
    const terms = kw.extractTerms("We use Kafka for everything.", ["Elixir", "Oban", "Tailwind"]);
    expect(terms).toEqual([{ term: "Kafka", count: 1 }]);
  });

  it("respects word boundaries for vocabulary terms", () => {
    const terms = kw.extractTerms(
      "You will build a dashboard for cash reporting and smash bugs.",
      ["Ash"],
    );
    expect(lower(terms)).not.toContain("ash");
  });

  it("ignores blank vocabulary entries and repeats that differ only by case", () => {
    const terms = kw.extractTerms("Background jobs run on Oban.", ["Oban", "oban", "", "   "]);
    expect(terms).toHaveLength(1);
    expect(terms[0].term.toLowerCase()).toBe("oban");
    expect(terms[0].count).toBe(1);
  });
});

describe("extractTerms: empty input", () => {
  it.each(["", "   ", "\n\n\t"])("returns [] for %j", (text) => {
    expect(kw.extractTerms(text, ["TypeScript"])).toEqual([]);
  });

  it("returns [] for prose with no technical terms", () => {
    expect(
      kw.extractTerms(
        "We are a friendly team looking for someone curious who enjoys working with customers.",
        [],
      ),
    ).toEqual([]);
  });
});

describe("termAppearsIn", () => {
  it.each([
    ["React", "Built dashboards in React, Redux and D3"],
    ["React", "Migrated the admin app to React."],
    ["React", "React/Redux front end"],
    ["react", "Led the REACT migration"],
    ["REACT", "wrote react components"],
    ["Node.js", "Maintained node.js services"],
    ["Node.js", "Maintained NodeJS services"],
    ["Node.js", "Ran Node workers behind a queue"],
    ["Node", "Maintained Node.js services"],
    ["JavaScript", "Ten years of JS"],
    ["JS", "Wrote JavaScript for the kiosk"],
    ["TypeScript", "TS and React"],
    ["TS", "Moved the codebase to TypeScript"],
    ["PostgreSQL", "Tuned Postgres queries"],
    ["Postgres", "Upgraded to PostgreSQL 16"],
    ["Kubernetes", "Ran k8s clusters"],
    ["K8s", "Moved dispatch to Kubernetes"],
    ["MongoDB", "Operated Mongo replica sets"],
    ["Mongo", "Operated MongoDB replica sets"],
    ["GCP", "Deployed to Google Cloud"],
    ["Google Cloud", "Moved from AWS to GCP"],
    ["CI/CD", "Set up CI CD for the monorepo"],
    ["CI/CD", "Championed continuous integration"],
    ["CI/CD", "Owned the CI/CD pipeline"],
    ["continuous integration", "Owned the CI/CD pipeline"],
    ["Go", "Wrote Go services"],
    ["Go", "Wrote Golang services"],
    ["Golang", "Services in Go and Rust"],
    ["C++", "Wrote C++ for firmware"],
    ["C#", "Unity scripting in C#."],
    [".NET", "Maintained .NET services"],
    ["SQL", "Wrote SQL reports"],
    ["AWS", "Cloud (AWS) migrations"],
    ["Phoenix LiveView", "Rebuilt the scheduler in phoenix liveview"],
  ])("%j appears in %j", (term, text) => {
    expect(kw.termAppearsIn(term, text)).toBe(true);
  });

  it.each([
    ["Go", "Going forward, a good team"],
    ["Go", "We go fast"],
    ["Go", "Google Cloud and MongoDB"],
    ["Java", "Ten years of JavaScript"],
    ["JavaScript", "Ten years of Java"],
    ["React", "Reactive streams and a reactor"],
    ["SQL", "Tuned PostgreSQL and MySQL"],
    ["C++", "Wrote C and C# code"],
    ["C#", "Wrote C++ for firmware"],
    ["Redis", "Redistributed load across regions"],
    ["AWS", "Laws, paws and jaws"],
    [".NET", "Rebuilt the internal network"],
    ["Kafka", "Untangled a Kafkaesque approval process"],
    ["Docker", "Dockerized nothing"],
    ["Ash", "Built a dashboard"],
    ["TypeScript", ""],
    ["Kubernetes", "Ran Docker Swarm clusters"],
  ])("%j does not appear in %j", (term, text) => {
    expect(kw.termAppearsIn(term, text)).toBe(false);
  });
});

describe("analyzeCoverage", () => {
  const DESCRIPTION =
    "We need TypeScript, React, Kubernetes, Kafka, Redis, Terraform and Postgres. " +
    "Python and Docker are welcome. Bonus points for Elixir or MongoDB.";

  // Each covered term is present in exactly one printed place.
  const RESUME = resumeOf({
    summary: "Backend engineer with ten years of logistics software in TypeScript.",
    jobs: [
      {
        title: "Senior React Engineer",
        company: "Fernhill Robotics",
        dates: "2021 - 2025",
        location: "Remote",
        bullets: [
          "Moved the dispatch service to K8s, cutting deploys from 40 minutes to 6",
          "Led five engineers going from a monolith to services",
        ],
      },
    ],
    projects: [
      {
        name: "Kafka Lag Watcher",
        dates: "2024",
        tech: "Rust, Redis",
        bullets: ["Published a Terraform module that 30 teams adopted"],
      },
    ],
    skills: [{ category: "Databases", items: ["Postgres", "SQLite"] }],
  });

  const LIBRARY: LibraryItem[] = [
    { kind: "skill", id: 3, text: "Python, Bash", selected: false },
    { kind: "bullet", id: 11, text: "Wrote Python tooling for release notes", selected: false },
    { kind: "bullet", id: 12, text: "Packaged services with Docker and Compose", selected: false },
    { kind: "skill", id: 4, text: "Docker, Python", selected: false },
    { kind: "bullet", id: 13, text: "Moved the dispatch service to K8s, cutting deploys from 40 minutes to 6", selected: true },
    { kind: "bullet", id: 14, text: "Ported a Python ETL job to Elixir", selected: false },
    // Selected in the library but absent from RESUME: must not be suggested.
    { kind: "bullet", id: 15, text: "Ran MongoDB for the analytics team", selected: true },
    { kind: "skill", id: 5, text: "TypeScript, React", selected: false },
  ];

  const run = (overrides: Partial<Parameters<KeywordsModule["analyzeCoverage"]>[0]> = {}) =>
    kw.analyzeCoverage({
      description: DESCRIPTION,
      resume: RESUME,
      library: LIBRARY,
      vocabulary: [],
      ...overrides,
    });

  it("keeps extractTerms order and counts", () => {
    const result = run();
    expect(result.terms.map(({ term, count }) => ({ term, count }))).toEqual(
      kw.extractTerms(DESCRIPTION, []),
    );
    expect(names(result.terms)).toEqual([
      "TypeScript", "React", "Kubernetes", "Kafka", "Redis", "Terraform",
      "PostgreSQL", "Python", "Docker", "Elixir", "MongoDB",
    ]);
  });

  it.each([
    ["TypeScript", "the summary"],
    ["React", "a job title"],
    ["Kubernetes", "a job bullet, through the K8s alias"],
    ["Kafka", "a project name"],
    ["Redis", "a project's tech line"],
    ["Terraform", "a project bullet"],
    ["PostgreSQL", "a skill item, through the Postgres alias"],
  ])("marks %s covered when it is in %s", (term) => {
    expect(find(run().terms, term)).toMatchObject({ status: "covered", suggestions: [] });
  });

  it("marks a term available when only unselected library items have it, bullets before skills in library order", () => {
    const result = run();
    expect(find(result.terms, "Python")).toMatchObject({
      status: "available",
      suggestions: [
        { kind: "bullet", id: 11 },
        { kind: "bullet", id: 14 },
        { kind: "skill", id: 3 },
        { kind: "skill", id: 4 },
      ],
    });
    expect(find(result.terms, "Docker")).toMatchObject({
      status: "available",
      suggestions: [
        { kind: "bullet", id: 12 },
        { kind: "skill", id: 4 },
      ],
    });
    expect(find(result.terms, "Elixir")).toMatchObject({
      status: "available",
      suggestions: [{ kind: "bullet", id: 14 }],
    });
  });

  it("returns suggestions as { kind, id } only", () => {
    expect(find(run().terms, "Elixir")?.suggestions).toEqual([{ kind: "bullet", id: 14 }]);
  });

  it("marks a term missing when no unselected library item has it", () => {
    // MongoDB is only in a library item flagged selected.
    expect(find(run().terms, "MongoDB")).toMatchObject({ status: "missing", suggestions: [] });
    expect(
      find(run({ library: [] }).terms, "Python"),
    ).toMatchObject({ status: "missing", suggestions: [] });
  });

  it("does not suggest library items for a covered term", () => {
    // Skill 5 is unselected and mentions TypeScript and React, both covered.
    const result = run();
    expect(find(result.terms, "TypeScript")?.suggestions).toEqual([]);
    expect(find(result.terms, "React")?.suggestions).toEqual([]);
  });

  it("counts terms in total and coveredCount", () => {
    const result = run();
    expect(result.total).toBe(11);
    expect(result.coveredCount).toBe(7);
    expect(result.terms.map((t) => t.status)).toEqual([
      "covered", "covered", "covered", "covered", "covered", "covered", "covered",
      "available", "available", "available", "missing",
    ]);
  });

  it("caps suggestions at five, bullets first", () => {
    const library: LibraryItem[] = [
      { kind: "skill", id: 1, text: "Python", selected: false },
      { kind: "bullet", id: 21, text: "Python script one", selected: false },
      { kind: "bullet", id: 22, text: "Python script two", selected: false },
      { kind: "skill", id: 2, text: "python, Ruby", selected: false },
      { kind: "bullet", id: 23, text: "Wrote no scripts at all", selected: false },
      { kind: "bullet", id: 24, text: "Python script three", selected: false },
      { kind: "bullet", id: 25, text: "Python script four", selected: false },
      { kind: "bullet", id: 26, text: "Python script five", selected: false },
      { kind: "bullet", id: 27, text: "Python script six", selected: false },
    ];
    expect(find(run({ library }).terms, "Python")?.suggestions).toEqual([
      { kind: "bullet", id: 21 },
      { kind: "bullet", id: 22 },
      { kind: "bullet", id: 24 },
      { kind: "bullet", id: 25 },
      { kind: "bullet", id: 26 },
    ]);

    const fewBullets = library.filter((i) => i.kind === "skill" || i.id <= 22);
    expect(find(run({ library: fewBullets }).terms, "Python")?.suggestions).toEqual([
      { kind: "bullet", id: 21 },
      { kind: "bullet", id: 22 },
      { kind: "skill", id: 1 },
      { kind: "skill", id: 2 },
    ]);
  });

  it("keeps bullet 7 and skill 7 apart", () => {
    const library: LibraryItem[] = [
      { kind: "skill", id: 7, text: "Elixir", selected: false },
      { kind: "bullet", id: 7, text: "Shipped an Elixir service", selected: false },
    ];
    expect(find(run({ library }).terms, "Elixir")?.suggestions).toEqual([
      { kind: "bullet", id: 7 },
      { kind: "skill", id: 7 },
    ]);
  });

  it("ignores company, location, dates, skill category, contact and education", () => {
    const resume = resumeOf({
      contact: {
        name: "Dana Whitlock",
        email: "dana@graphql.example",
        github: "github.com/dana-redis",
      },
      jobs: [
        {
          title: "Engineer",
          company: "Kafka Street Collective",
          dates: "2020 - 2024 (Python era)",
          location: "Docker Bay, Remote",
          bullets: [],
        },
      ],
      skills: [{ category: "Elixir", items: ["Erlang"] }],
      education: { school: "Terraform Institute", degrees: ["Certificate in MongoDB Administration"] },
    });
    const result = kw.analyzeCoverage({
      description:
        "Requirements: GraphQL, Redis, Kafka, Python, Docker, Elixir, Terraform and MongoDB.",
      resume,
      library: [],
      vocabulary: [],
    });
    expect(result.total).toBe(8);
    expect(result.coveredCount).toBe(0);
    expect(result.terms.every((t) => t.status === "missing")).toBe(true);
  });

  it("uses the vocabulary to find terms in the posting", () => {
    const description =
      "Dispatch runs on Elixir with Oban for background jobs, and you will own our fleet telematics pipeline.";
    const resume = resumeOf({
      jobs: [
        {
          title: "Engineer",
          company: "Fernhill Robotics",
          dates: "2020 - 2024",
          location: "Remote",
          bullets: ["Built the Fleet Telematics ingestion service"],
        },
      ],
    });
    const library: LibraryItem[] = [
      { kind: "bullet", id: 31, text: "Moved nightly billing to Oban with retries", selected: false },
    ];

    const without = kw.analyzeCoverage({ description, resume, library, vocabulary: [] });
    expect(names(without.terms)).toEqual(["Elixir"]);

    const withVocabulary = kw.analyzeCoverage({
      description,
      resume,
      library,
      vocabulary: ["Fleet Telematics", "Oban"],
    });
    expect(withVocabulary).toEqual({
      total: 3,
      coveredCount: 1,
      terms: [
        { term: "Elixir", count: 1, status: "missing", suggestions: [] },
        { term: "Oban", count: 1, status: "available", suggestions: [{ kind: "bullet", id: 31 }] },
        { term: "Fleet Telematics", count: 1, status: "covered", suggestions: [] },
      ],
    });
  });

  it("does not match Go in a resume that only says going", () => {
    const result = kw.analyzeCoverage({
      description: "Services are written in Go and Python.",
      resume: resumeOf({
        summary: "Engineer going after hard problems with a good track record.",
      }),
      library: [{ kind: "bullet", id: 1, text: "Wrote Golang services for dispatch", selected: false }],
      vocabulary: [],
    });
    expect(result).toEqual({
      total: 2,
      coveredCount: 0,
      terms: [
        { term: "Go", count: 1, status: "available", suggestions: [{ kind: "bullet", id: 1 }] },
        { term: "Python", count: 1, status: "missing", suggestions: [] },
      ],
    });
  });

  it("handles the full posting against a realistic resume", () => {
    const result = kw.analyzeCoverage({
      description: POSTING,
      resume: RESUME,
      library: LIBRARY,
      vocabulary: [],
    });
    expect(result.total).toBe(result.terms.length);
    expect(result.coveredCount).toBe(result.terms.filter((t) => t.status === "covered").length);
    const status = (term: string) => find(result.terms, term)?.status;
    for (const term of ["PostgreSQL", "TypeScript", "Kubernetes", "Terraform", "Kafka", "React", "Redis"]) {
      expect(status(term), term).toBe("covered");
    }
    for (const term of ["Python", "Docker"]) expect(status(term), term).toBe("available");
    // "going" in a RESUME bullet is not Go; SQLite and PostgreSQL are not SQL.
    for (const term of ["Go", "SQL", "AWS", "GraphQL", "Ruby", "OAuth", "MongoDB", "Node.js", "JavaScript", "CI/CD", "REST"]) {
      expect(status(term), term).toBe("missing");
    }
  });

  it.each(["", "  \n "])("returns an empty result for a blank description %j", (description) => {
    expect(run({ description })).toEqual({ total: 0, coveredCount: 0, terms: [] });
  });
});
