// overview.js – Opinnot.md: koko opintokansion yhteenveto (Obsidianin aloitussivu).
//
//   Opinnot.md
//     Käynnissä / Tulevat / Päättyneet kurssit linkkeineen
//     Uutta kursseilla (14 päivää)

import { coursePagePath, rootPrefix } from "./rules.js";
import { courseSummary, courseDates } from "./status.js";
import { dateKey } from "./agenda.js";

export const INDEX_FILE = "Opinnot.md";

const md = text => String(text || "").replace(/[\[\]]/g, m => (m === "[" ? "(" : ")")).replace(/\s+/g, " ").trim();
const link = path => path.split("/").map(encodeURIComponent).join("/");

// Polku opintokansion juuresta (Opinnot.md:n sijainnista) kurssin tiedostoon
function coursePath(data, course) {
  return link(coursePagePath(data, course).slice(rootPrefix(data.settings).length));
}

export function indexPath(settings) {
  return `${rootPrefix(settings)}${INDEX_FILE}`;
}

export function overviewMarkdown(data, exists, now = Date.now()) {
  const { courses } = data;

  const lines = [
    "---",
    `updated: ${dateKey(now)}`, // paikallinen päivä
    "---",
    "",
    "# Opinnot",
    "",
    "> Kurssikaverin ylläpitämä yhteenveto. Päivittyy automaattisesti – älä kirjoita tähän omia muistiinpanoja.",
    ""
  ];

  const groups = [["active", "Käynnissä"], ["upcoming", "Tulevat"], ["completed", "Päättyneet"]];
  for (const [status, title] of groups) {
    const list = courses.filter(c => c.status === status).sort((a, b) => a.name.localeCompare(b.name, "fi"));
    if (list.length === 0) continue;
    lines.push(`## ${title}`, "");
    for (const course of list) {
      const s = courseSummary(data, course, exists, now);
      const info = [course.code, courseDates(course)].filter(Boolean).join(" · ");
      const extra = [];
      if (s.total) extra.push(`${s.saved}/${s.total} tiedostoa`);
      if (s.newItems.length) extra.push(`${s.newItems.length} uutta`);
      lines.push(`- [${md(course.name)}](${coursePath(data, course)})${info ? ` · ${md(info)}` : ""}${extra.length ? ` · ${extra.join(" · ")}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
