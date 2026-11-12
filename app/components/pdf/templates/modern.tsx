import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { registerFonts } from "../fonts";
import type { ResumeData } from "../types";

registerFonts();

const sp = { 0: 0, 0.5: 1.5, 1: 3, 1.5: 4.5, 2: 6, 3: 9, 4: 12, 16: 48 } as const;

const styles = StyleSheet.create({
  page: {
    paddingTop: sp[4],
    paddingBottom: sp[4],
    paddingLeft: sp[16],
    paddingRight: sp[16],
    fontFamily: "Inter",
    fontSize: 10,
    color: "#111827",
    lineHeight: 1.3,
  },
  header: { marginBottom: sp[0.5] },
  headerName: { fontSize: 16, fontWeight: "bold", color: "#000", lineHeight: 1.2 },
  headerContact: { fontSize: 9, color: "#374151", marginTop: sp[1], lineHeight: 1.3 },
  section: { marginTop: sp[2] },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", marginBottom: sp[0.5] },
  sectionBar: { height: 3.75, width: 30, backgroundColor: "#374151", marginRight: sp[2] },
  sectionHeaderText: { fontSize: 10, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 0.3, color: "#000" },
  flexRowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  entryFirst: {},
  entry: { marginTop: sp[1.5] },
  entryTitle: { fontWeight: "bold", fontSize: 10, color: "#000" },
  entryDates: { fontSize: 10, color: "#374151" },
  entrySubtitle: { fontSize: 10, color: "#374151" },
  entryLocation: { fontSize: 10, color: "#374151" },
  bulletList: { marginTop: sp[0.5] },
  bulletRow: { flexDirection: "row", marginBottom: 1 },
  bulletDot: { width: 10, fontSize: 10, color: "#374151", paddingTop: 1 },
  bulletText: { flexGrow: 1, flexBasis: 0, fontSize: 10, color: "#111827", lineHeight: 1.3 },
  inlineRow: { fontSize: 10, marginBottom: 1, color: "#111827" },
  inlineBold: { fontWeight: "bold", color: "#000" },
  summary: { fontSize: 10, color: "#111827", lineHeight: 1.3 },
});

// Page-break rules (react-pdf):
// - Every bullet is unbreakable.
// - A heading is grouped with the first row under it, and an entry header with its first bullet.
// The groups are direct children of the page (no wrapping Section or entry View): react-pdf
// squeezes an unbreakable group nested inside breakable Views instead of moving it to the next page.

function SectionHeading({ title }: { title: string }) {
  return (
    <>
    <View style={styles.sectionHeadingRow}>
      <View style={styles.sectionBar} />
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
    </>
  );
}

function Bullet({ text, first }: { text: string; first?: boolean }) {
  return (
    <View style={first ? [styles.bulletRow, styles.bulletList] : styles.bulletRow} wrap={false}>
      <Text style={styles.bulletDot}>{"\u2022"}</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function TextSection({ title, rows }: { title: string; rows: React.ReactNode[] }) {
  return (
    <>
      <View style={styles.section} wrap={false}>
        <SectionHeading title={title} />
        {rows[0]}
      </View>
      {rows.slice(1)}
    </>
  );
}

interface EntryParts {
  header: React.ReactNode;
  bullets: string[];
}

function EntrySection({ title, entries }: { title: string; entries: EntryParts[] }) {
  return (
    <>
      {entries.map(({ header, bullets }, i) => (
        <React.Fragment key={i}>
          <View style={i === 0 ? styles.section : styles.entry} wrap={false}>
            {i === 0 ? <SectionHeading title={title} /> : null}
            {header}
            {bullets.length > 0 ? <Bullet text={bullets[0]} first /> : null}
          </View>
          {bullets.slice(1).map((t, j) => (
            <Bullet key={j} text={t} />
          ))}
        </React.Fragment>
      ))}
    </>
  );
}

function jobParts(job: ResumeData["jobs"][0]): EntryParts {
  return {
    bullets: job.bullets,
    header: (
      <>
        <View style={styles.flexRowBetween}>
          <Text style={styles.entryTitle}>{job.title}</Text>
          <Text style={styles.entryDates}>{job.dates}</Text>
        </View>
        <View style={styles.flexRowBetween}>
          <Text style={styles.entrySubtitle}>{job.company}</Text>
          <Text style={styles.entryLocation}>{job.location}</Text>
        </View>
      </>
    ),
  };
}

function projectParts(project: ResumeData["projects"][0]): EntryParts {
  return {
    bullets: project.bullets,
    header: (
      <>
        <View style={styles.flexRowBetween}>
          <Text style={styles.entryTitle}>{project.name}</Text>
          <Text style={styles.entryDates}>{project.dates}</Text>
        </View>
        <Text style={styles.entrySubtitle}>{project.tech}</Text>
      </>
    ),
  };
}

export function ModernTemplate({ data }: { data: ResumeData }) {
  const { contact, summary, jobs, skills, projects, education } = data;
  const contactParts = [contact.phone, contact.email, contact.linkedin, contact.github].filter(Boolean);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerName}>{contact.name}</Text>
          <Text style={styles.headerContact}>{contactParts.join("  |  ")}</Text>
        </View>
        {summary ? <TextSection title="PROFESSIONAL SUMMARY" rows={[<Text key="summary" style={styles.summary}>{summary}</Text>]} /> : null}
        {jobs.length > 0 && <EntrySection title="WORK EXPERIENCE" entries={jobs.map(jobParts)} />}
        {skills.length > 0 && <TextSection title="TECHNICAL SKILLS" rows={skills.map((r, i) => <Text key={i} style={styles.inlineRow}><Text style={styles.inlineBold}>{r.category}</Text>{"  |  "}{r.items.join(", ")}</Text>)} />}
        {projects.length > 0 && <EntrySection title="PROJECTS" entries={projects.map(projectParts)} />}
        <TextSection title="EDUCATION" rows={[<Text style={styles.inlineRow}><Text style={styles.inlineBold}>{education.school}</Text>{"  |  "}{education.degrees.join(", ")}</Text>]} />
      </Page>
    </Document>
  );
}
