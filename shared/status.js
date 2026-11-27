// status.js – kurssin tilanne yhdestä paikasta: mitä on tallennettu, mitä on uutta,
// mitkä määräajat ovat tulossa ja onko kurssi päättymässä.
//
// Käyttävät sekä taustaskripti (Sisalto.md, Opinnot.md, Moodle-palkki) että sivut (Tänään-sivu, kurssisivu).

import { fileKey } from "./contents.js";
import { isMoodleDeadline } from "./moodle.js";
import * as folder from "./fsstore.js";

export const NEW_DAYS = 14;        // "uusi" = löytyi Moodlesta viimeisen 14 päivän aikana
export const ENDING_DAYS = 14;     // muistutus tallentamattomista, kun kurssi päättyy 14 päivän sisällä
const DAY = 86400 * 1000;

export function isNew(firstSeen, now = Date.now()) {
  return Boolean(firstSeen) && now - firstSeen < NEW_DAYS * DAY;
}

// Mitkä tallennetut tiedostot ovat yhä levyllä?
//   { latauksenId: true | false, folderFiles: { polku: true | false } | null }
// Latauskansiossa Chrome tietää sen. Omassa kansiossa katsotaan kansiosta, jos siihen on lupa (muuten null).
//   downloads = kirjaston merkinnät; jos puuttuu, ne luetaan tallennustilasta
export async function existsMap(downloads = null) {
  const map = {};
  for (const item of await chrome.downloads.search({ limit: 0 })) map[item.id] = item.exists;
  if (!downloads) downloads = (await chrome.storage.local.get("downloads")).downloads || {};
  const paths = Object.values(downloads)
    .filter(d => d.stored === "folder" && d.state === "complete" && d.path)
    .map(d => d.path);
  map.folderFiles = paths.length ? await folder.existingFiles(paths) : null;
  return map;
}

// Onko tiedosto yhä tallessa? exists = existsMap()-funktion tulos. Jos tietoa ei ole, oletetaan kyllä.
export function isPresent(entry, exists) {
  if (entry.stored === "downloads" && entry.downloadId !== null && entry.downloadId !== undefined) {
    return !exists || exists[entry.downloadId] !== false;
  }
  if (entry.stored === "folder" && entry.state === "complete" && entry.path && exists && exists.folderFiles) {
    return exists.folderFiles[entry.path] !== false;
  }
  return true;
}

// Moodle-kurssin tallennetut tiedostot: { tiedostoavain: tallennus }
//   includeBusy = myös kesken olevat ja lupaa odottavat (Moodle-palkin painikkeet)
export function savedEntries(data, moodleId, exists, includeBusy = false) {
  const states = includeBusy ? ["complete", "in_progress", "pending"] : ["complete"];
  const saved = {};
  for (const d of Object.values(data.downloads)) {
    if (d.moodleId !== Number(moodleId) || !d.fileKey || d.status !== "filed" || d.movingTo) continue;
    if (!states.includes(d.state) || !isPresent(d, exists)) continue;
    if (d.duplicateOf && saved[d.fileKey]) continue; // alkuperäinen voittaa kopion
    saved[d.fileKey] = d;
  }
  return saved;
}

function sortedSections(content) {
  return Object.entries((content && content.sections) || {}).sort((a, b) => a[1].order - b[1].order);
}

// Uudet kohteet: kokonaan uudet aktiviteetit ja kansioihin lisätyt tiedostot
export function newItems(content, now = Date.now()) {
  const result = [];
  for (const [section, info] of sortedSections(content)) {
    for (const item of info.items) {
      if (isNew(item.firstSeen, now)) { result.push({ ...item, section, sectionOrder: info.order, firstSeen: item.firstSeen }); continue; }
      const added = (item.files || []).filter(f => isNew(f.firstSeen, now));
      if (added.length) result.push({ ...item, section, sectionOrder: info.order, addedFiles: added, firstSeen: Math.max(...added.map(f => f.firstSeen)) });
    }
  }
  return result.sort((a, b) => b.firstSeen - a.firstSeen);
}

// Kurssin määräajat aikajärjestyksessä, myös palautetut tehtävät.
export function courseDeadlines(data, moodleId) {
  const items = (data.deadlines && data.deadlines.items) || [];
  return items.filter(d => d.moodleId === Number(moodleId) && isMoodleDeadline(d)).sort((a, b) => a.time - b.time);
}

// Tulevat määräajat ilman palautettuja tehtäviä (submitted: background.js withSubmissions)
export function upcomingDeadlines(data, limit = Infinity, now = Date.now()) {
  const items = (data.deadlines && data.deadlines.items) || [];
  return items.filter(d => isMoodleDeadline(d) && d.time >= now - DAY && !d.submitted).sort((a, b) => a.time - b.time).slice(0, limit);
}

// Tallennetut tiedostot, jotka opettaja on vaihtanut Moodlessa (uusi versio tallentamatta)
export function updatedEntries(data, moodleId, exists) {
  return Object.values(savedEntries(data, moodleId, exists)).filter(d => d.update);
}

// Tiedostojen määrä: tiedostoaktiviteetit + kansioiden tiedostot (kansiot, joiden sisältöä ei tiedetä, erikseen)
export function fileCounts(content, saved) {
  let total = 0, savedCount = 0, unknownFolders = 0;
  for (const [, info] of sortedSections(content)) {
    for (const item of info.items) {
      if (item.kind === "file") { total++; if (saved[fileKey(item.cmid)]) savedCount++; }
      else if (item.kind === "folder") {
        if (!item.files) { unknownFolders++; continue; }
        for (const f of item.files) { total++; if (saved[fileKey(item.cmid, f.subpath, f.name)]) savedCount++; }
      }
    }
  }
  return { total, saved: savedCount, unsaved: total - savedCount, unknownFolders };
}

// Välilehdet, joita ei ole vielä luettu. Himmennetyt välilehdet (dimTabs) eivät ole puuttuvia: Moodle ei välttämättä
// näytä niiden sisältöä opiskelijalle (esim. aukeaa myöhemmin). Ne luetaan, kun sisältö tulee näkyviin.
export function unreadTabsOf(content) {
  const sections = Object.keys(content?.sections || {});
  const dimmed = content?.dimTabs || [];
  return (content?.tabs || []).filter(tab => !sections.includes(tab) && !dimmed.includes(tab));
}

// Kurssin tilanne kortteja ja Tänään-sivua varten
export function courseSummary(data, course, exists, now = Date.now()) {
  const content = course.moodleId ? data.courseContent[course.moodleId] : null;
  const saved = course.moodleId ? savedEntries(data, course.moodleId, exists) : {};
  const counts = fileCounts(content, saved);
  const sections = Object.keys(content?.sections || {});
  const unreadTabs = unreadTabsOf(content);
  const items = content ? sortedSections(content).flatMap(([, info]) => info.items) : [];
  const endMs = course.end ? course.end * 1000 : 0;
  return {
    content,
    savedMap: saved,       // { tiedostoavain: tallennus }
    ...counts,             // total, saved (lukumäärä), unsaved, unknownFolders
    links: items.filter(i => ["link", "video", "tool"].includes(i.kind)).length,
    collectedTabs: sections.length,
    totalTabs: Math.max((content?.tabs || []).length, sections.length),
    unreadTabs,
    materialsUnchecked: Boolean(course.moodleId) && (!sections.length || unreadTabs.length > 0 || counts.unknownFolders > 0),
    newItems: newItems(content, now),
    updated: course.moodleId ? updatedEntries(data, course.moodleId, exists) : [], // vaihdettu Moodlessa
    deadlines: course.moodleId ? courseDeadlines(data, course.moodleId).filter(d => d.time >= now - DAY) : [],
    // Päättynyt: loppupäivä on ohi tai Moodle näyttää kurssin menneissä (esim. suoritettu ennen loppupäivää)
    ended: course.status === "active" && !course.endHandled && ((endMs > 0 && endMs < now) || Boolean(course.moodlePast)),
    endedInMoodle: Boolean(course.moodlePast) && !(endMs > 0 && endMs < now),
    endingSoon: course.status === "active" && !course.moodlePast && endMs > now && endMs - now < ENDING_DAYS * DAY,
    daysLeft: endMs > now ? Math.ceil((endMs - now) / DAY) : 0
  };
}

// Päivämäärät suomalaisittain
export function formatDay(ms, withYear = false) {
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}.${withYear ? d.getFullYear() : ""}`;
}

export function formatDeadline(ms) {
  const d = new Date(ms);
  const time = `${d.getHours()}.${String(d.getMinutes()).padStart(2, "0")}`;
  const weekday = d.toLocaleDateString("fi-FI", { weekday: "short" });
  return `${weekday} ${formatDay(ms)} klo ${time}`;
}

// "huomenna", "3 päivän päästä", "myöhässä"
export function relativeDays(ms, now = Date.now()) {
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (ms < now) return days === 0 ? "tänään, myöhässä" : "myöhässä";
  if (days === 0) return "tänään";
  if (days === 1) return "huomenna";
  return `${days} päivän päästä`;
}

export function courseDates(course) {
  if (!course.start && !course.end) return "";
  const start = course.start ? formatDay(course.start * 1000, !course.end) : "";
  const end = course.end ? formatDay(course.end * 1000, true) : "";
  return `${start}–${end}`;
}
