// contents.js – kurssin sisältö (Moodle-sivulta kerätyt tiedostot, kansiot, linkit ja videot)
// ja niistä muodostettava kurssisivu Kurssin tiedot.md.

import { courseProperties, COURSE_PAGE_PROPERTY } from "./rules.js";
import { dateKey } from "./agenda.js";

// Sisällön lajit.
//   icon  = ikoni Kurssikaverin sivuilla (shared/icons.js)
//   label = nimi; Markdown-tiedostoissa laji kerrotaan tällä sanalla
export const KINDS = {
  file:       { label: "Tiedosto",         icon: "file" },
  folder:     { label: "Kansio",           icon: "folder" },
  video:      { label: "Video",            icon: "video" },
  link:       { label: "Linkki",           icon: "link" },
  tool:       { label: "Ulkoinen työkalu", icon: "tool" },
  page:       { label: "Sivu",             icon: "page" },
  assignment: { label: "Palautustehtävä",  icon: "assignment" },
  activity:   { label: "Aktiviteetti",     icon: "activity" }
};

// Lajit, jotka näytetään kirjaston Linkit-osiossa
export const LINK_KINDS = ["link", "video", "tool"];

// Moodle-aktiviteetin tyypistä (modtype) ja kuvakkeesta laji.
export function kindOf(modtype, icon, name) {
  switch (modtype) {
    case "url": return "link";
    case "resource": return icon === "video" || icon === "mpeg" ? "video" : "file";
    case "lti": return /\d{1,2}:\d{2}/.test(name || "") ? "video" : "tool";
    case "folder": return "folder";
    case "page": case "book": return "page";
    case "assign": return "assignment";
    case "video": return "video"; // tekstilohkoon upotettu video (content.js)
    default: return "activity";
  }
}

// Tallennettavan tiedoston tunniste: tiedostoaktiviteetti "107367", kansion tiedosto "85233:alikansio/kuva.png"
export function fileKey(cmid, subpath = "", name = "") {
  return name ? `${cmid}:${subpath}${name}` : String(cmid);
}

// Kaikki kerätyt kohteet litteänä listana: [{ ...kohde, moodleId, section, sectionOrder }]
export function allItems(courseContent) {
  const result = [];
  for (const [moodleId, content] of Object.entries(courseContent || {})) {
    for (const [section, info] of Object.entries(content.sections || {})) {
      for (const item of info.items) result.push({ ...item, moodleId: Number(moodleId), section, sectionOrder: info.order });
    }
  }
  return result;
}

function sortedSections(content) {
  return Object.entries(content.sections || {}).sort((a, b) => a[1].order - b[1].order);
}

function mdText(text) {
  return String(text || "").replace(/[\[\]]/g, m => (m === "[" ? "(" : ")")).replace(/\s+/g, " ").trim();
}

// Paikallinen polku linkiksi: välilyönnit ja ä/ö koodataan, jotta linkki toimii kaikissa editoreissa
function localLink(relativePath) {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

// ---------- Videolinkit (omat linkit) ----------
// Tunnistaa YouTube-, Vimeo- ja Panopto-videot ja niiden aloituskohdan (t=, start=, #t=).
// Palauttaa { site, start } tai null. start = sekunteina tai null.

function parseTime(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (/^\d+(\.\d+)?s?$/.test(v)) return Math.floor(parseFloat(v));
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return null;
}

export function videoInfo(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const hashT = new URLSearchParams(u.hash.replace(/^#/, "")).get("t");
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (!(u.pathname === "/watch" && u.searchParams.get("v")) && !/^\/(shorts|live|embed)\/[\w-]+/.test(u.pathname)) return null;
    return { site: "YouTube", start: parseTime(u.searchParams.get("t") || u.searchParams.get("start") || hashT) };
  }
  if (host === "youtu.be" && /^\/[\w-]+/.test(u.pathname)) {
    return { site: "YouTube", start: parseTime(u.searchParams.get("t") || u.searchParams.get("start")) };
  }
  if ((host === "vimeo.com" || host === "player.vimeo.com") && /\/\d+/.test(u.pathname)) {
    return { site: "Vimeo", start: parseTime(hashT) };
  }
  if (/(^|\.)panopto\.(com|eu)$/.test(host) && /viewer\.aspx|embed\.aspx/i.test(u.pathname)) {
    return { site: "Panopto", start: parseTime(u.searchParams.get("start")) };
  }
  return null;
}

// 750 → "12:30", 3723 → "1:02:03"
export function formatStart(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const two = n => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// Välilehden otsikko siistiksi: ilmoitusten määrä "(3) " alusta ja palvelun nimi lopusta pois
export function cleanPageTitle(title, url) {
  let t = String(title || "").replace(/^\(\d+\+?\)\s*/, "").trim();
  if (videoInfo(url)) t = t.replace(/\s*[-–|·]\s*(YouTube|Vimeo|Panopto)\s*$/i, "").replace(/\s+on Vimeo$/i, "").trim();
  return t;
}

// Osoite Markdown-linkkiin: välilyönnit, sulut ja kulmasulut koodataan, jotta linkki ei katkea
function mdUrl(url) {
  return String(url || "").replace(/[\s()<>]/g, ch => encodeURIComponent(ch).replace("(", "%28").replace(")", "%29"));
}

const NEW_MS = 14 * 86400 * 1000; // sama kuin status.js:n NEW_DAYS
const isNewAt = (time, now) => Boolean(time) && now - time < NEW_MS;
const NEW_MARK = " · *uusi*";
const UPDATED_MARK = " · *päivitetty Moodlessa, uusi versio tallentamatta*";

// Tallennetun tiedoston tieto: polku tai { path, updated } (opettaja on vaihtanut tiedoston Moodlessa)
function savedFile(value) {
  if (!value) return null;
  return typeof value === "string" ? { path: value, updated: false } : value;
}

// Muodostaa Kurssin tiedot.md:n. Määräajat näytetään Kurssikaverissa, ei Markdownissa.
// Sisällön laji kerrotaan sanalla rivin lopussa (haettavissa Obsidianissa),
// ja tallennetut tiedostot erottuvat siitä, että linkki osoittaa omaan kansioon.
//   saved     = { tiedostoavain: "02 Työhyvinvointi/Luento_X.pptx" } – tallennetut tiedostot kurssikansiosta katsottuna
//               (tai { path, updated: true }, jos tiedosto on vaihdettu Moodlessa tallennuksen jälkeen)
//   bookmarks = käyttäjän kurssille tallentamat nettisivut: [{ url, title, note, created }]
//   options   = { embedVideos, savedTexts } – embedVideos: YouTube-videot upotetaan (Obsidian näyttää videon muistiinpanossa);
//               savedTexts: hiiren oikealla tallennettujen tekstien linkit (store.js)
export function contentsMarkdown(course, content, saved, moodleUrl, now = Date.now(), bookmarks = [], options = {}) {
  const today = dateKey(now); // paikallinen päivä (UTC-päivä olisi Suomessa klo 0–2 edellinen päivä)
  const collected = sortedSections(content).map(([name]) => name);
  // Himmennetyt välilehdet eivät ole puuttuvia (sama sääntö kuin shared/status.js: unreadTabsOf)
  const missing = (content.tabs || []).filter(tab => !collected.includes(tab) && !(content.dimTabs || []).includes(tab));

  const lines = [
    "---",
    ...courseProperties(course, moodleUrl),
    `updated: ${today}`,
    "aliases:",
    `  - ${JSON.stringify(course.name)}`, // Obsidianin haku ja linkit löytävät tiedoston kurssin nimellä
    COURSE_PAGE_PROPERTY,
    "---",
    "",
    `# ${mdText(course.name)}`,
    "",
    "> Kurssikaverin ylläpitämä kurssisivu. Päivittyy automaattisesti – älä kirjoita tähän omia muistiinpanoja.",
    ""
  ].filter(line => line !== null);

  if (missing.length > 0) {
    lines.push(`*Osa kurssista puuttuu vielä (${missing.join(", ")}). Avaa kurssi Moodlessa, niin se päivittyy.*`, "");
  }

  // Omat linkit: nettisivut, jotka käyttäjä on tallentanut kurssille ponnahdusikkunasta (uusin ensin)
  // Videot omana ryhmänään ("video" rivin lopussa, kuten Moodlen videoilla), muut linkit sen jälkeen.
  if (bookmarks.length > 0) {
    lines.push("## Omat linkit", "");
    const sorted = [...bookmarks].sort((x, y) => y.created - x.created);
    const videos = sorted.filter(b => videoInfo(b.url));
    const pages = sorted.filter(b => !videoInfo(b.url));
    const savedDay = b => { const d = new Date(b.created); return `tallennettu ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };
    if (videos.length) {
      if (pages.length) lines.push("### Videot", "");
      for (const b of videos) {
        const v = videoInfo(b.url);
        const title = `${mdText(b.title) || `${v.site}-video`}${v.start ? ` · alkaen ${formatStart(v.start)}` : ""}`;
        lines.push(`- [${title}](${mdUrl(b.url)}) – video · ${v.site} · ${savedDay(b)}`);
        if (b.note) lines.push(`    ${mdText(b.note)}`);
        // Obsidian upottaa YouTube-videon: upotus omalle rivilleen listan perään
        if (options.embedVideos && v.site === "YouTube") lines.push("", `![${mdText(b.title) || "Video"}](${mdUrl(b.url)})`, "");
      }
      lines.push("");
    }
    if (pages.length) {
      if (videos.length) lines.push("### Muut linkit", "");
      for (const b of pages) {
        const details = [hostOf(b.url), savedDay(b)].filter(Boolean).join(" · ");
        lines.push(`- [${mdText(b.title) || hostOf(b.url) || "Linkki"}](${mdUrl(b.url)}) – ${details}`);
        if (b.note) lines.push(`    ${mdText(b.note)}`);
      }
      lines.push("");
    }
  }

  // Linkit sekä kokonaisiin sivutallennuksiin että hiiren oikealla tallennettuihin katkelmiin.
  // Tekstit ovat erillisiä tiedostoja Omat tallennukset -kansiossa.
  const texts = [...new Map([
    ...bookmarks.filter(b => b.clipPath).map(b => ({ ...b, path: b.clipPath, saved: b.created })),
    ...(options.savedTexts || [])
  ].map(t => [t.path, t])).values()].sort((x, y) => y.saved - x.saved);
  if (texts.length > 0) {
    lines.push("## Linkit tallennettuihin teksteihin", "", "Tekstitiedostot ovat kurssin Omat tallennukset -kansiossa.", "");
    for (const t of texts) {
      const d = new Date(t.saved);
      const when = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} klo ${d.getHours()}.${String(d.getMinutes()).padStart(2, "0")}`;
      lines.push(`- [${mdText(t.title) || hostOf(t.url) || "Tallennettu teksti"}](${localLink(t.path)}) – ${when} · lähde: [${hostOf(t.url) || "sivu"}](${mdUrl(t.url)})`);
      if (t.note) lines.push(`    ${mdText(t.note)}`);
    }
    lines.push("");
  }

  lines.push("## Kurssimateriaalit", "");
  // Säilytetään aiemman sisällysluettelon uusien materiaalien yhteenveto.
  const fresh = [];
  for (const [section, info] of sortedSections(content)) {
    for (const item of info.items) {
      const kind = (KINDS[item.kind] || KINDS.activity).label.toLowerCase();
      if (isNewAt(item.firstSeen, now)) fresh.push(`- ${mdText(item.name)} – ${kind} · ${mdText(section)}`);
      else {
        const added = (item.files || []).filter(f => isNewAt(f.firstSeen, now));
        if (added.length) fresh.push(`- ${mdText(item.name)} – uudet tiedostot: ${added.map(f => mdText(f.name)).join(", ")} · ${mdText(section)}`);
      }
    }
  }
  if (fresh.length > 0) lines.push("### Uutta (14 päivää)", "", ...fresh, "");
  if (sortedSections(content).length === 0) lines.push("Avaa kurssi Moodlessa, niin sen materiaalien luettelo päivittyy tähän.", "");
  for (const [section, info] of sortedSections(content)) {
    lines.push(`### ${mdText(section)}`, "");
    let label = null;
    for (const item of info.items) {
      if (item.label !== label) {
        label = item.label;
        if (label) lines.push("", `#### ${mdText(label)}`, "");
      }
      lines.push(...itemLines(item, saved, now));
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function itemLines(item, saved, now) {
  const kind = (KINDS[item.kind] || KINDS.activity).label.toLowerCase();
  const name = mdText(item.name);
  const fresh = isNewAt(item.firstSeen, now) ? NEW_MARK : "";
  const lines = [];

  if (item.kind === "file") {
    const file = savedFile(saved[fileKey(item.cmid)]);
    lines.push(file ? `- [${name}](${localLink(file.path)}) – ${kind}${fresh}${file.updated ? UPDATED_MARK : ""}`
      : `- [${name}](${item.moodleUrl}) – ${kind}, ei tallennettu${fresh}`);
  } else if (item.kind === "folder") {
    const files = item.files || [];
    const savedCount = files.filter(f => saved[fileKey(item.cmid, f.subpath, f.name)]).length;
    const count = files.length ? `, ${files.length} tiedostoa${savedCount && savedCount < files.length ? ` (${savedCount} tallennettu)` : ""}` : "";
    lines.push(`- [${name}](${item.moodleUrl}) – ${kind}${count}${fresh}`);
    for (const file of files) {
      const stored = savedFile(saved[fileKey(item.cmid, file.subpath, file.name)]);
      const label = mdText(`${file.subpath || ""}${file.name}`);
      const fileFresh = !fresh && isNewAt(file.firstSeen, now) ? NEW_MARK : "";
      lines.push(stored ? `    - [${label}](${localLink(stored.path)})${fileFresh}${stored.updated ? UPDATED_MARK : ""}`
        : `    - [${label}](${file.url}) – ei tallennettu${fileFresh}`);
    }
  } else {
    const details = [kind];
    if (item.kind === "video") details.push(item.service, item.duration);
    else if (item.target) details.push(hostOf(item.target));
    lines.push(`- [${name}](${item.target || item.moodleUrl}) – ${details.filter(Boolean).join(", ")}${fresh}`);
  }
  if (item.description) lines.push(`    ${mdText(item.description).slice(0, 240)}`);
  return lines;
}

// Tallennetun tiedoston polku kurssikansiosta katsottuna (Kurssin tiedot.md:n linkkejä varten)
export function relativeToCourse(path, courseFolderPath) {
  const normalized = String(path || "").replace(/\\/g, "/");
  const marker = `${courseFolderPath}/`;
  const index = normalized.lastIndexOf(`/${marker}`);
  if (index >= 0) return normalized.slice(index + marker.length + 1);
  if (normalized.startsWith(marker)) return normalized.slice(marker.length);
  return null;
}
