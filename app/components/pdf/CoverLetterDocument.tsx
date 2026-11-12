import React from "react";
import { Document, Page, View, Text, Link, StyleSheet } from "@react-pdf/renderer";
import { registerFonts } from "./fonts";
import type { ResumeContact, TemplateId } from "./types";

registerFonts();

export type CoverLetterData = {
  contact: ResumeContact;
  template: TemplateId;
  /** Already formatted, e.g. "November 11, 2026". */
  date: string;
  recipient: string | null;
  /** Greeting through sign-off, a blank line between paragraphs. */
  body: string;
};

// The header copies each resume template's header (font, name size and
// alignment, contact separator, rule) and the page uses the same margins.
// The values are duplicated from templates/*.tsx on purpose: those files stay
// untouched.
interface HeaderStyle {
  fontFamily: "Inter" | "Lora";
  paddingVertical: number;
  paddingHorizontal: number;
  color: string;
  linkColor: string;
  name: { fontSize: number; lineHeight: number; align: "left" | "center" };
  contact: { fontSize: number; color: string; marginTop: number; lineHeight: number };
  separator: string;
  marginBottom: number;
  /** Thin rule under the header (classic only). */
  rule: { height: number; color: string } | null;
}

const HEADERS: Record<TemplateId, HeaderStyle> = {
  modern: {
    fontFamily: "Inter",
    paddingVertical: 48,
    paddingHorizontal: 48,
    color: "#111827",
    linkColor: "#374151",
    name: { fontSize: 16, lineHeight: 1.2, align: "left" },
    contact: { fontSize: 9, color: "#374151", marginTop: 3, lineHeight: 1.3 },
    separator: "  |  ",
    marginBottom: 1.5,
    rule: null,
  },
  classic: {
    fontFamily: "Inter",
    paddingVertical: 48,
    paddingHorizontal: 48,
    color: "#000000",
    linkColor: "#444",
    name: { fontSize: 18, lineHeight: 1.2, align: "center" },
    contact: { fontSize: 9, color: "#444", marginTop: 3, lineHeight: 1.3 },
    separator: "  |  ",
    marginBottom: 3,
    rule: { height: 0.5, color: "#999" },
  },
  minimal: {
    fontFamily: "Lora",
    paddingVertical: 48,
    paddingHorizontal: 48,
    color: "#1a1a1a",
    linkColor: "#555",
    name: { fontSize: 22, lineHeight: 1.1, align: "left" },
    contact: { fontSize: 9, color: "#555", marginTop: 4.5, lineHeight: 1.3 },
    separator: "  ·  ",
    marginBottom: 9,
    rule: null,
  },
};

const BODY_FONT_SIZE = 10.5;
const BODY_LINE_HEIGHT = 1.45;

function withScheme(url: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

/** Paragraphs split on blank lines; single newlines stay inside a paragraph. */
function paragraphsOf(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function CoverLetterDocument({ data }: { data: CoverLetterData }) {
  const { contact, template, date, recipient, body } = data;
  const h = HEADERS[template] ?? HEADERS.modern;

  const styles = StyleSheet.create({
    page: {
      paddingTop: h.paddingVertical,
      paddingBottom: h.paddingVertical,
      paddingLeft: h.paddingHorizontal,
      paddingRight: h.paddingHorizontal,
      fontFamily: h.fontFamily,
      fontSize: BODY_FONT_SIZE,
      color: h.color,
      lineHeight: BODY_LINE_HEIGHT,
    },
    header: { marginBottom: h.marginBottom },
    headerName: {
      fontSize: h.name.fontSize,
      fontWeight: "bold",
      color: "#000",
      lineHeight: h.name.lineHeight,
      textAlign: h.name.align,
    },
    headerContact: {
      fontSize: h.contact.fontSize,
      color: h.contact.color,
      marginTop: h.contact.marginTop,
      lineHeight: h.contact.lineHeight,
      textAlign: h.name.align,
    },
    contactLink: { color: h.linkColor, textDecoration: "none" },
    rule: { height: h.rule?.height ?? 0, backgroundColor: h.rule?.color ?? "#999" },
    date: { marginTop: 24 },
    recipient: { marginTop: 8 },
    paragraph: { marginTop: 10 },
    firstParagraph: { marginTop: 18 },
  });

  const contactItems: React.ReactNode[] = [];
  if (contact.phone) contactItems.push(<Text key="phone">{contact.phone}</Text>);
  if (contact.email)
    contactItems.push(
      <Link key="email" src={`mailto:${contact.email}`} style={styles.contactLink}>
        {contact.email}
      </Link>,
    );
  if (contact.linkedin)
    contactItems.push(
      <Link key="linkedin" src={withScheme(contact.linkedin)} style={styles.contactLink}>
        {contact.linkedin}
      </Link>,
    );
  if (contact.github)
    contactItems.push(
      <Link key="github" src={withScheme(contact.github)} style={styles.contactLink}>
        {contact.github}
      </Link>,
    );
  const contactLine = contactItems.flatMap((item, i) =>
    i === 0 ? [item] : [<Text key={`sep${i}`}>{h.separator}</Text>, item],
  );

  return (
    <Document title={`${contact.name} Cover Letter`} author={contact.name}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerName}>{contact.name}</Text>
          {contactLine.length > 0 ? <Text style={styles.headerContact}>{contactLine}</Text> : null}
        </View>
        {h.rule ? <View style={styles.rule} /> : null}
        <Text style={styles.date}>{date}</Text>
        {recipient ? <Text style={styles.recipient}>{recipient}</Text> : null}
        {paragraphsOf(body).map((p, i) => (
          <Text key={i} style={i === 0 ? styles.firstParagraph : styles.paragraph}>
            {p}
          </Text>
        ))}
      </Page>
    </Document>
  );
}
