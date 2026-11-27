// ui.js – sivujen yhteiset apufunktiot.

import * as folder from "./fsstore.js";
import { moodleBase } from "./store.js";
import { isImportedCourse } from "./moodle.js";
import { isPresent, existsMap } from "./status.js";
import { savedMessage, saveCourseText } from "./barState.js";

export { isPresent, existsMap };

export const STATUS_LABELS = { active: "Käynnissä", upcoming: "Tuleva", completed: "Päättynyt" };

// Estää tekstiä rikkomasta HTML:ää. Käytä aina, kun tulostat dataa innerHTML:ään.
export function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text ?? "").replace(/[&<>"']/g, ch => map[ch]);
}

export function courseImportNotice(data) {
  const discovery = data.courseDiscovery;
  if (discovery?.base !== moodleBase(data.settings)) return "";
  const missing = discovery.courses.filter(c => !isImportedCourse(c.id, data.courses, data.moodleMap));
  if (!missing.length) return "";
  if (missing.length === 1) return `Moodlesta löytyi tuomaton kurssi: ${missing[0].fullname}.`;
  return `Moodlesta löytyi ${missing.length} tuomatonta kurssia.`;
}

export const ORGANIZE_LABELS = { topic: "Moodlen välilehdet", type: "Tiedostotyyppi" };

export function choice(name, options, value, label) {
  return `<div class="seg3" role="radiogroup" aria-label="${label}">${options.map(([key, text]) => `
    <label><input class="sr-only" type="radio" name="${name}" value="${key}" ${key === value ? "checked" : ""}>${text}</label>`).join("")}</div>`;
}

export function baseName(path) {
  return String(path || "").split(/[\\/]/).pop();
}

export function formatDate(ms) {
  const date = new Date(ms);
  const today = new Date();
  const time = date.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `tänään ${time}`;
  return date.toLocaleDateString("fi-FI");
}

// Tiedostot, jotka vaativat käyttäjän huomiota. Käytetään sekä ponnahdusikkunassa että kirjastossa.
export function attentionItems(data, exists = null) {
  const all = Object.values(data.downloads).filter(d => d.state === "complete" && !d.movingTo && isPresent(d, exists));
  return {
    unsorted: all.filter(d => d.status === "unsorted" && !d.duplicateOf),
    check: all.filter(d => d.status === "filed" && d.confidence === "medium" && !d.duplicateOf),
    duplicates: all.filter(d => d.duplicateOf),
    pending: Object.values(data.downloads).filter(d => d.state === "pending"),
    leftBehind: all.filter(d => d.note && d.note.startsWith("Jäi latauskansioon"))
  };
}

export function attentionCount(data, exists = null) {
  const a = attentionItems(data, exists);
  return a.unsorted.length + a.check.length + a.duplicates.length + a.pending.length;
}

// Avaa tiedoston. Latauskansiossa Chrome avaa sen oletusohjelmassa; omasta kansiosta
// tiedosto luetaan ja näytetään selaimessa (PDF, kuvat, teksti) tai Chrome tarjoaa sen avattavaksi.
export async function openEntry(entry) {
  if (entry.stored === "downloads" && entry.downloadId !== null && entry.downloadId !== undefined) {
    chrome.downloads.open(entry.downloadId);
    return;
  }
  const file = await folder.readFile(entry.path);
  const url = URL.createObjectURL(file);
  chrome.tabs.create({ url });
}

export function canShowInFolder(entry) {
  return entry.stored === "downloads" && entry.downloadId !== null && entry.downloadId !== undefined;
}

export function showInFolder(entry) {
  if (canShowInFolder(entry)) chrome.downloads.show(entry.downloadId);
}

// Pyytää luvan opintokansioon (vain painikkeen painalluksesta) ja tekee odottaneet tallennukset
export async function grantFolderPermission() {
  const state = await folder.requestPermission();
  if (state !== "granted") throw new Error("Lupaa ei annettu.");
  return ask("processPending");
}

// Ilmoitus luvan antamisen jälkeen: montako odottanutta tiedostoa tallennettiin ja montako epäonnistui
export function grantNote(result) {
  let text = "Lupa annettu.";
  if (result.done) text += ` Tallennettiin ${result.done} ${result.done === 1 ? "odottanut tiedosto" : "odottanutta tiedostoa"}.`;
  if (result.failed) text += ` ${result.failed} tiedoston tallennus epäonnistui. Yritä tallennusta uudelleen Moodlesta.`;
  return { kind: result.failed ? "error" : "ok", text };
}

// Moodlen tietojen päivitys taustalla (määräajat, kurssien päivämäärät). Virheet eivät estä sivua.
export function refreshMoodle(options = {}) {
  return chrome.runtime.sendMessage({ action: "refreshMoodle", ...options }).catch(() => null);
}

// "Tallenna kurssin kaikki tiedostot": taustaskripti tallentaa kurssin kaikki tallentamattomat tiedostot.
// Kesken olevat tallennukset muistetaan, jotta painike näkyy "Tallennetaan…"-tilassa.
export const savingCourses = new Set();

export async function saveCourseFiles(moodleId, onChange = () => {}) {
  savingCourses.add(Number(moodleId));
  onChange();
  try {
    const result = await ask("saveCourseFiles", { moodleId });
    if (result.failed.length) {
      const list = result.failed.map(f => `${f.name} (${f.where}): ${f.reason}`).join("; ");
      return { kind: "error", text: `Tallennettiin ${result.done}/${result.total} tiedostoa. Jäi tallentamatta: ${list}.` };
    }
    return { kind: "ok", text: savedMessage(result.done, result.total) };
  } finally {
    savingCourses.delete(Number(moodleId));
  }
}

// Painikkeen teksti: "Tallenna kurssin puuttuvat tiedostot (3)" (sama kuin Moodle-palkissa, shared/barState.js)
export function saveCourseLabel(summary, moodleId) {
  if (savingCourses.has(Number(moodleId))) return "Tallennetaan kurssin tiedostoja…";
  return saveCourseText(summary);
}

export function openPage(hash = "") {
  chrome.tabs.create({ url: chrome.runtime.getURL(`library.html${hash ? "#" + hash : ""}`) });
}

// Obsidian-linkki: obsidian://open?vault=Holvi&file=Opinnot/Kurssi/Sisalto
export function obsidianUrl(settings, relativePath) {
  const o = settings.obsidian || {};
  if (!o.enabled || !o.vault || settings.storage !== "folder") return null;
  const file = [o.prefix, relativePath].filter(Boolean).join("/").replace(/\.md$/, "");
  return `obsidian://open?vault=${encodeURIComponent(o.vault)}&file=${encodeURIComponent(file)}`;
}

// Lähettää pyynnön taustaskriptille ja heittää virheen, jos se epäonnistui
export async function ask(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...payload });
  if (!response || !response.ok) throw new Error((response && response.error) || "Tuntematon virhe");
  return response.result;
}
