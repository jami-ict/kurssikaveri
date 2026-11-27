// store.js – lisäosan tallennettu data (chrome.storage.local).
//
// Kaikki tieto pysyy käyttäjän omalla koneella selaimen tallennustilassa.
//
//   settings      asetukset (tallennuspaikka, Moodlen osoite, teema, värimaailma, Obsidian ...)
//   courses       [{ id, name, code, group, semester, status, moodleId, folder, start, end, endHandled, color }]
//                 – color = kurssin väri 1–7 (shared/colors.js)
//   moodleMap     { moodleKurssiId: studyHubKurssiId } – mistä latauksen kurssi tunnistetaan
//   downloads     { id: { ...tiedoston tiedot } } – kirjasto (id on merkkijono)
//   courseContent { moodleKurssiId: { title, tabs, sections: { välilehti: { order, items } } } }
//   contentsMeta  { moodleKurssiId: { hash, downloadId } } – milloin Sisalto.md kirjoitettiin
//   pending       [{ ... }] – oman kansion kirjoitukset, jotka odottavat kansion lupaa
//   pageCourses   { sivunOsoite: { moodleId, title, section, sectionOrder, time } }
//   lastMoodle    { moodleId, title, section, sectionOrder, time } – viimeisin avattu kurssisivu
//   deadlines     { fetched, items: [...], error } – palautettavat tehtävät Moodlen Aikajanasta
//   courseDiscovery { base, courses: [{ id, fullname }] } – Moodlen viimeisimmän onnistuneen kurssihaun tulos
//   sync          { courses: aika } – milloin kurssien tiedot (päivämäärät) viimeksi päivitettiin Moodlesta
//   ownEntries    [{ id, title, date: "2026-11-12", time: "14:00" | "", courseId | null, type: "deadline" | "other", note, created }]
//                 – käyttäjän omat kalenterimerkinnät (vain tällä koneella)
//   calendarPrefs { hidden: [kurssiavain], lastCourse } – Kalenteri-sivun piilotetut kurssit ja viimeksi valittu kurssi
//   viewPrefs     { coursesLayout: "cards" | "list", bookmarkCourse } – sivujen näkymävalinnat ja kirjanmerkin viimeksi valittu kurssi
//   bookmarks     [{ id, url, title, courseId, note, created }] – käyttäjän kurssille tallentamat nettisivut ("Omat linkit")
//   savedTexts    [{ id, courseId, url, title, path, saved, note, tags }] – hiiren oikealla tallennetut tekstivalinnat ("Omat tallennukset"); path kurssin kansiosta
//
// Kurssin sisällön kohteilla on firstSeen = milloin kohde löytyi Moodlesta ensimmäisen kerran
// (0 = oli jo ensimmäisellä keruulla). Siitä päätellään "uusi".
//
// Valitun opintokansion "kahva" ei mahdu chrome.storageen, se on IndexedDB:ssä (ks. fsstore.js).

import { DEFAULT_SKIN } from "./skins.js";

// Lisäosa toimii vain SAMKin Moodlessa. Osoite ei ole käyttäjän muutettavissa.
export const MOODLE_URL = "https://moodle5.samk.fi";

export const DEFAULT_SETTINGS = {
  onboarded: false,      // onko aloitusopas käyty läpi
  storage: "downloads",  // "folder" = oma valittu kansio, "downloads" = Downloads/Kurssikaveri
  folderName: "",        // valitun kansion nimi (näytetään käyttäjälle)
  rootFolder: "Kurssikaveri", // latauskansion tilassa kansio latauskansion sisällä (vanhoissa asennuksissa tallessa "StudyHub")
  moodleUrl: MOODLE_URL,
  organizeBy: "topic",   // "topic" = Moodlen välilehtien mukaan, "type" = tyypin mukaan
  showHomeCalendar: true,
  popupFirst: "deadline", // "deadline" = määräaika ensin, "save" = avoimen sivun tallennus ensin
  theme: "system",       // "system" | "light" | "dark"
  skin: DEFAULT_SKIN,
  customSkins: [],       // käyttäjän omat värimaailmat: [{ id, name, base, accent, warn, tone }]
  backupId: "",          // tämän asennuksen tunniste opintokansion tiedostossa .kurssikaveri/tiedot.json (shared/backup.js)
  moodleButtons: true,   // Tallenna-painikkeet Moodlen kurssisivuille
  notifications: true,
  obsidian: { enabled: false, vault: "", prefix: "", path: "", embedVideos: false } // opintokansio = holvin juuri; prefix/path luetaan vain vanhojen kytkentöjen yhteensopivuutta varten
};

const KEYS = ["settings", "courses", "moodleMap", "downloads", "courseContent", "contentsMeta", "pending", "pageCourses", "lastMoodle", "deadlines", "courseDiscovery", "sync", "ownEntries", "calendarPrefs", "viewPrefs", "bookmarks", "savedTexts"];

export function loadAll() {
  return loadData(KEYS);
}

async function loadData(keys) {
  const data = await chrome.storage.local.get(keys);
  const stored = data.settings || {};
  return {
    settings: { ...DEFAULT_SETTINGS, ...stored, obsidian: { ...DEFAULT_SETTINGS.obsidian, ...(stored.obsidian || {}) } },
    courses: data.courses || [],
    moodleMap: data.moodleMap || {},
    downloads: data.downloads || {},
    courseContent: data.courseContent || {},
    contentsMeta: data.contentsMeta || {},
    pending: data.pending || [],
    pageCourses: data.pageCourses || {},
    lastMoodle: data.lastMoodle || null,
    deadlines: data.deadlines || { fetched: 0, items: [], error: "" },
    courseDiscovery: data.courseDiscovery || null,
    sync: data.sync || {},
    ownEntries: data.ownEntries || [],
    calendarPrefs: { hidden: [], lastCourse: null, ...(data.calendarPrefs || {}) },
    viewPrefs: { coursesLayout: "cards", ...(data.viewPrefs || {}) },
    bookmarks: data.bookmarks || [],
    savedTexts: data.savedTexts || []
  };
}

export async function save(partial) {
  await chrome.storage.local.set(partial);
}

// Sama lukko kaikilla lisäosan sivuilla ja taustaskriptissä. Lue, muuta ja tallenna
// lukon sisällä. Taustaskriptille lähetettävät pyynnöt tehdään lukon vapauttamisen jälkeen.
export function withLock(task) {
  return navigator.locks.request("kurssikaveri-storage-local", task);
}

export function updateData(keys, change) {
  return withLock(async () => {
    const partial = change(await loadData(keys));
    if (!partial) return false;
    await save(partial);
    return true;
  });
}

export function saveSettings(changes) {
  return updateData("settings", ({ settings }) => {
    const patch = typeof changes === "function" ? changes(settings) : changes;
    return { settings: { ...settings, ...patch } };
  });
}

export function newId(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10);
}

// Moodlen osoite ilman loppukauttaviivaa. Tallennettua asetusta ei käytetä: osoite on aina SAMKin Moodle.
export function moodleBase() {
  return MOODLE_URL;
}
