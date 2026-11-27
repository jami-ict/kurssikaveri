// backup.js – Kurssikaverin tiedot talteen opintokansioon ja takaisin.
//
// Lisäosan poisto tyhjentää selaimen muistin (chrome.storage), vaikka kurssien tiedostot jäävät kansioon.
// Siksi tärkeimmät tiedot kirjoitetaan myös tiedostoon opintokansion juureen:
//
//   .kurssikaveri/tiedot.json
//
// Tiedostossa ovat kurssit, omat kalenterimerkinnät, omat linkit, omat värimaailmat, muutama asetus ja luettelo tallennetuista
// tiedostoista (mikä Moodlen tiedosto on missä polussa). Kurssien materiaaleja siinä ei ole, eikä tämä vaikuta
// siihen, mihin tiedostot tallentuvat.
//
// Kirjoitus: taustaskripti (background.js: writeBackup) aina, kun jokin näistä muuttuu.
// Palautus: aloitusopas (onboarding.js), kun valitussa kansiossa on tämä tiedosto ja lisäosan muisti on tyhjä.
// Toimii vain, kun tallennuspaikka on oma kansio: latauskansiota lisäosa ei voi lukea.

import { getSkin, customSkins } from "./skins.js";

export const BACKUP_DIR = ".kurssikaveri";            // pisteellä alkava kansio ei näy Obsidianissa
export const BACKUP_PATH = `${BACKUP_DIR}/tiedot.json`;
export const BACKUP_OLD_PATH = `${BACKUP_DIR}/tiedot-aiempi.json`; // toisen asennuksen tiedot ennen kuin ne korvattiin
const VERSION = 1;

// Asetukset, jotka kulkevat mukana. Tallennuspaikka ja Obsidian-holvi eivät kulje: ne valitaan aloitusoppaassa.
const SETTINGS = ["organizeBy", "theme", "showHomeCalendar", "popupFirst", "skin", "customSkins", "moodleButtons", "notifications"];

// Tallennettu tiedosto, joka on opintokansiossa
const isSavedFile = d => d && d.stored === "folder" && d.state === "complete" && Boolean(d.path);

// Tiedostoon kirjoitettava sisältö. data = loadAll(), owner = tämän asennuksen tunniste (settings.backupId).
export function backupObject(data, owner, now = Date.now()) {
  const settings = {};
  for (const key of SETTINGS) if (data.settings[key] !== undefined) settings[key] = data.settings[key];
  return {
    app: "Kurssikaveri",
    version: VERSION,
    owner,
    saved: new Date(now).toISOString(),
    settings,
    courses: data.courses,
    moodleMap: data.moodleMap,
    ownEntries: data.ownEntries,
    calendarPrefs: data.calendarPrefs,
    viewPrefs: data.viewPrefs,
    bookmarks: data.bookmarks,
    savedTexts: data.savedTexts,
    files: Object.values(data.downloads).filter(isSavedFile).map(d => ({ ...d, downloadId: null }))
  };
}

// Sisältö ilman tallennusaikaa: jos tämä ei ole muuttunut, tiedostoa ei kirjoiteta uudelleen
export function backupFingerprint(object) {
  return JSON.stringify({ ...object, saved: "" });
}

// Lukee ja tarkistaa tiedoston tekstin. Palauttaa siistityn sisällön tai null, jos tiedosto ei kelpaa.
export function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (error) { return null; }
  if (!raw || typeof raw !== "object" || raw.app !== "Kurssikaveri" || raw.version !== VERSION) return null;

  const isObject = v => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const list = v => (Array.isArray(v) ? v.filter(isObject) : []);
  const settings = {};
  if (isObject(raw.settings)) for (const key of SETTINGS) if (raw.settings[key] !== undefined) settings[key] = raw.settings[key];

  return {
    owner: typeof raw.owner === "string" ? raw.owner : "",
    saved: typeof raw.saved === "string" ? raw.saved : "",
    settings,
    courses: list(raw.courses).filter(c => typeof c.id === "string" && typeof c.name === "string"),
    moodleMap: isObject(raw.moodleMap) ? raw.moodleMap : {},
    ownEntries: list(raw.ownEntries).filter(e => typeof e.id === "string" && typeof e.date === "string"),
    calendarPrefs: isObject(raw.calendarPrefs) ? raw.calendarPrefs : {},
    viewPrefs: isObject(raw.viewPrefs) ? raw.viewPrefs : {},
    bookmarks: list(raw.bookmarks).filter(b => typeof b.id === "string" && typeof b.courseId === "string" && /^https?:\/\//i.test(b.url || "")),
    savedTexts: list(raw.savedTexts).filter(t => typeof t.id === "string" && typeof t.courseId === "string" && typeof t.path === "string"),
    files: list(raw.files).filter(f => typeof f.id === "string" && isSavedFile(f))
  };
}

// Onko lisäosan muisti tyhjä (uusi asennus)? Vain silloin palautusta tarjotaan.
export function isEmpty(data) {
  return data.courses.length === 0 && data.ownEntries.length === 0 && data.bookmarks.length === 0 && data.savedTexts.length === 0 && Object.keys(data.downloads).length === 0;
}

// Lyhyt kuvaus oppaaseen: "6 kurssia, 4 omaa merkintää, 132 tallennettua tiedostoa"
export function backupSummary(backup) {
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [count(backup.courses.length, "kurssi", "kurssia")];
  if (backup.ownEntries.length) parts.push(count(backup.ownEntries.length, "oma merkintä", "omaa merkintää"));
  if (backup.bookmarks.length) parts.push(count(backup.bookmarks.length, "oma linkki", "omaa linkkiä"));
  if (backup.savedTexts.length) parts.push(count(backup.savedTexts.length, "tallennettu teksti", "tallennettua tekstiä"));
  if (backup.files.length) parts.push(count(backup.files.length, "tallennettu tiedosto", "tallennettua tiedostoa"));
  const skins = customSkins(backup.settings).length;
  if (skins) parts.push(count(skins, "oma värimaailma", "omaa värimaailmaa"));
  return parts.join(", ");
}

// Tallennuspäivä suomalaisittain, esim. "15.11.2026" ("" jos ei tiedossa)
export function backupDay(backup) {
  const d = new Date(backup.saved);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// Mitä chrome.storageen kirjoitetaan palautuksessa. settings = nykyiset asetukset (tallennuspaikka säilyy).
export function restoreChanges(backup, settings) {
  const restored = { ...settings, ...backup.settings, backupId: backup.owner || settings.backupId || "" };
  restored.customSkins = customSkins(restored);
  restored.skin = getSkin(restored).id;
  return {
    settings: restored,
    courses: backup.courses,
    moodleMap: backup.moodleMap,
    ownEntries: backup.ownEntries,
    calendarPrefs: backup.calendarPrefs,
    viewPrefs: backup.viewPrefs,
    bookmarks: backup.bookmarks,
    savedTexts: backup.savedTexts,
    downloads: Object.fromEntries(backup.files.map(f => [f.id, f]))
  };
}
