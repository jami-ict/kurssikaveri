// rules.js – nimeämis- ja kansiosäännöt.
//
// Tätä tiedostoa käyttävät sekä taustaskripti että sivut.

import { pickColor } from "./colors.js";
//
// Kansiorakenne (oletus: Moodlen välilehtien mukaan):
//   <opintokansio>/                      oma kansio TAI Downloads/Kurssikaveri
//     Työyhteisöosaaminen/
//       Kurssin tiedot.md                perustiedot, omat linkit ja materiaalien sisällysluettelo
//       Työhyvinvointi/Luento_Tyoterveyshuolto.pptx
//       Tulos ja epävarmuus/ZeroError kuvat/ZEMB.png
//       Omat tallennukset/              (syntyy tekstiä tallennettaessa)
//
// Polut pidetään lyhyinä Windowsin 260 merkin rajan vuoksi:
// kansionimet ≤ 40 merkkiä, tiedostonimet ≤ 60 merkkiä + pääte, koko polku ≤ 150 merkkiä.

// Materiaalityypit. words = sanat, joista tyyppi tunnistetaan nimestä.
// folder = kansio, jos materiaalit järjestetään tyypin mukaan (asetus).
export const TYPES = {
  lecture:    { label: "Luento",         prefix: "Luento",    folder: "Luennot",        words: ["lecture", "luento", "luennon", "luennot", "luentotallenne", "luentokalvot", "slides", "kalvot", "lect"] },
  exercise:   { label: "Harjoitus",      prefix: "Harjoitus", folder: "Harjoitukset",   words: ["exercise", "harjoitus", "harjoitukset", "demo", "ex", "harj"] },
  assignment: { label: "Tehtävänanto",   prefix: "Tehtava",   folder: "Tehtävänannot",  words: ["assignment", "tehtava", "tehtavananto", "task"] },
  reading:    { label: "Lukumateriaali", prefix: "Luku",      folder: "Lukumateriaali", words: ["reading", "luku", "artikkeli", "article", "chapter"] },
  other:      { label: "Muu",            prefix: "",          folder: "Muut",           words: [] }
};

// Kurssin yhteenvetotiedosto. Nimi kertoo sisällön; kurssin nimi on Obsidianissa aliaksena (aliases), jotta
// haku löytää tiedoston kurssin nimellä. Ennen 2026-11-22 nimi oli Kurssi.md (OLD_COURSE_FILE), ja se siirretään
// uuteen nimeen seuraavassa päivityksessä (shared/coursefile.js).
export const COURSE_FILE = "Kurssin tiedot.md";
export const OLD_COURSE_FILE = "Kurssi.md";
export const LEGACY_CONTENTS_FILE = "Sisalto.md";
// Kurssikaverin ylläpitämän kurssitiedoston tunniste tiedoston ominaisuuksissa (frontmatter). Ilman tunnistetta tiedosto
// voi olla käyttäjän oma, joten se arkistoidaan ennen ylikirjoitusta (shared/coursefile.js).
// Ennen 2026-11-22 tunniste oli tekstissä HTML-kommenttina, joka näkyi Obsidianin muokkausnäkymässä; se tunnistetaan yhä.
export const COURSE_PAGE_PROPERTY = "kurssikaveri: kurssisivu";
export const LEGACY_COURSE_PAGE_MARKER = "<!-- Kurssikaveri: kurssisivu -->";
export function isCoursePage(text) {
  const raw = String(text || "");
  const source = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw; // tavujärjestysmerkki pois
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return Boolean(frontmatter && /^kurssikaveri:\s*["']?kurssisivu["']?\s*$/m.test(frontmatter[1])) || source.includes(LEGACY_COURSE_PAGE_MARKER);
}
export const UNSORTED_FOLDER = "_Järjestämättä";
export const INCOMING_FOLDER = "Kurssikaveri-saapuvat"; // oman kansion tilassa latauskansion välikansio (ennen StudyHub-saapuvat)

const MAX_FOLDER = 40;
const MAX_FILE = 60;
const MAX_PATH = 150;

const NOISE_WORDS = new Set(["final", "copy", "kopio", "draft", "uusi", "new", "versio", "version", "v"]);

// ä → a, ö → o jne. Nimetyissä tiedostoissa käytetään vain ASCII-merkkejä; kansioiden nimissä ä/ö säilyvät.
export function asciiFold(text) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

// Poistaa merkit, joita Windows ei salli nimissä (toimii siksi kaikilla alustoilla).
export function cleanName(text) {
  return String(text || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
}

// Lyhentää nimen sanan rajalta: "Toimiva työyhteisö ja tiimityö …" → enintään max merkkiä
export function shorten(text, max) {
  const name = cleanName(text);
  if (name.length <= max) return name;
  const cut = name.slice(0, max);
  const space = cut.search(/[\s_-][^\s_-]*$/);
  return (space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s._-]+$/, "");
}

export function splitExtension(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || fileName.length - dot > 6) return { stem: fileName, ext: "" };
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot).toLowerCase() };
}

// Tiedostonimen lyhennys: pääte säilyy aina
export function shortenFile(fileName, max = MAX_FILE) {
  const { stem, ext } = splitExtension(cleanName(fileName));
  return (shorten(stem, max) || "tiedosto") + ext;
}

function nameWords(stem) {
  return asciiFold(stem).match(/[A-Za-z]+|\d+/g) || [];
}

// Ehdottaa tyypin ja uuden nimen.
// "lecture7_final(2).pdf" → { type: "lecture", fileName: "Luento-07.pdf" }
// Moodle-sivulta tallennettaessa nimenä käytetään aktiviteetin nimeä, joka on yleensä kuvaavampi.
//   sourceFileName = opettajan alkuperäinen tiedostonimi, section = Moodlen välilehti/osio
// Jos nimestä jää pelkkä tyyppi ("Luentokalvot" → "Luento"), erotteleva osa otetaan alkuperäisestä
// tiedostonimestä tai välilehden nimestä, ettei samaan kansioon synny nimiä Luento (2), Luento (3) …
export function suggestName(originalName, sourceFileName = "", section = "") {
  const { stem, ext } = splitExtension(originalName);
  const words = nameWords(stem);
  const lower = words.map(w => w.toLowerCase());
  const used = new Set();

  let type = null, number = null, typeWord = null;
  for (let i = 0; i < lower.length; i++) {
    const key = Object.keys(TYPES).find(k => TYPES[k].words.includes(lower[i]));
    if (key) {
      type = key;
      typeWord = words[i];
      used.add(i);
      if (i + 1 < lower.length && /^\d+$/.test(lower[i + 1]) && lower[i + 1].length <= 3) {
        number = parseInt(lower[i + 1], 10);
        used.add(i + 1);
      }
      break;
    }
  }

  // Opettajan tiedostonimessä voi olla luentonumero, vaikka Moodle-otsikko on pelkkä "Luentokalvot".
  if (type && number === null && sourceFileName) {
    const source = nameWords(splitExtension(sourceFileName).stem);
    const index = source.findIndex((word, i) =>
      TYPES[type].words.includes(word.toLowerCase()) && /^\d{1,3}$/.test(source[i + 1]));
    if (index >= 0) number = Number(source[index + 1]);
  }

  const titleWords = [];
  lower.forEach((word, i) => {
    if (used.has(i) || NOISE_WORDS.has(word)) return;
    if (/^\d+$/.test(word) && i > 0 && NOISE_WORDS.has(lower[i - 1])) return;
    titleWords.push(words[i]);
  });
  let title = titleWords.join("-");
  if (type && number === null && !title) title = distinguishingTitle(sourceFileName) || distinguishingTitle(section, false);
  title = title.charAt(0).toUpperCase() + title.slice(1);

  let name;
  if (type) {
    name = TYPES[type].prefix;
    if (number !== null) name += "-" + String(number).padStart(2, "0");
    if (title) name += "_" + title;
  } else {
    type = "other";
    name = title || cleanName(stem) || "tiedosto";
  }

  return {
    type,
    fileName: shortenFile(name + ext),
    reason: typeWord ? `tyyppi sanasta "${typeWord}"` : "tyyppiä ei tunnistettu nimestä"
  };
}

// Erotteleva osa nimeen: sanat ilman tyyppisanoja, täytesanoja ja numeroita, enintään 5 sanaa.
//   "kalvot_pivot-taulukot.pdf" → "pivot-taulukot", "Yhteenvetojen teko (Pivot-taulukot & ryhmittely)" → "Yhteenvetojen-teko-Pivot-taulukot-ryhmittely"
function distinguishingTitle(text, isFile = true) {
  const stem = isFile ? splitExtension(String(text || "")).stem : String(text || "");
  const typeWords = new Set(Object.values(TYPES).flatMap(t => t.words));
  return nameWords(stem)
    .filter(w => /^[A-Za-z]{2,}$/.test(w) && !typeWords.has(w.toLowerCase()) && !NOISE_WORDS.has(w.toLowerCase()))
    .slice(0, 5).join("-");
}

// Kun käyttäjä vaihtaa tyyppiä: Luento-07.pdf → Harjoitus-07.pdf
export function swapPrefix(fileName, oldType, newType) {
  const oldPrefix = TYPES[oldType] ? TYPES[oldType].prefix : "";
  const newPrefix = TYPES[newType] ? TYPES[newType].prefix : "";
  if (oldPrefix && fileName.startsWith(oldPrefix)) return newPrefix + fileName.slice(oldPrefix.length);
  if (!oldPrefix && newPrefix) return `${newPrefix}_${fileName}`;
  return fileName;
}

// ---------- Kansiot ----------

// Opintokansion juuri: omassa kansiossa polut alkavat suoraan, latauskansiossa asetuksen rootFolder-kansiosta
export function rootPrefix(settings) {
  return settings.storage === "folder" ? "" : (cleanName(settings.rootFolder) || "Kurssikaveri") + "/";
}

// Vertaa nimiä myös kirjainkoosta ja Unicode-merkkien esitystavasta riippumatta.
function folderKey(name) {
  return name.normalize("NFC").toLowerCase();
}

// Valitse vapaa nimi: ensin kurssin nimi, sitten lukuvuosi ja tarvittaessa järjestysnumero.
export function assignCourseFolder(course, courses) {
  const base = shorten(course.name, MAX_FOLDER) || "Kurssi";
  const used = new Set(courses.filter(c => c.id !== course.id)
    .map(c => folderKey(c.folder || shorten(c.name, MAX_FOLDER))));
  if (!used.has(folderKey(base))) return base;

  const semester = shorten(course.semester, 9); // YYYY-YYYY
  const term = semester ? ` ${semester}` : "";
  let folder = base + term;
  for (let n = 2; used.has(folderKey(folder)); n++) {
    const suffix = `${term} (${n})`;
    folder = shorten(base, MAX_FOLDER + 10 - suffix.length) + suffix;
  }
  return folder;
}

export function courseFolder(settings, course) {
  return rootPrefix(settings) + (course.folder || shorten(course.name, MAX_FOLDER));
}

// Chrome voi antaa latauskansioon tallennetulle kurssisivulle vapaan nimen.
export function coursePagePath(data, course) {
  const meta = data.contentsMeta?.[course.moodleId || `course-${course.id}`];
  return data.settings.storage === "downloads" && meta?.courseFile === COURSE_FILE && meta.path
    ? meta.path : `${courseFolder(data.settings, course)}/${COURSE_FILE}`;
}

// "General" on Moodlen englanninkielinen oletusnimi.
function sectionFolder(section) {
  const name = cleanName(section);
  return !name || /^(general|yleistä|yleinen)$/i.test(name) ? "Yleistä" : shorten(name, MAX_FOLDER);
}

// Tiedoston koko polku (oman kansion juuresta tai latauskansiosta).
//   where = { type, fileName, section, sectionOrder, folder, subpath }
//   folder = Moodlen kansio-aktiviteetin nimi, subpath = alikansiot sen sisällä ("Mittaukset/")
export function materialPath(settings, course, where) {
  const parts = [courseFolder(settings, course)];
  if (settings.organizeBy === "type") {
    parts.push((TYPES[where.type] || TYPES.other).folder);
  } else if (where.section) {
    parts.push(sectionFolder(where.section));
  }
  if (where.folder) parts.push(shorten(where.folder, MAX_FOLDER));
  for (const sub of String(where.subpath || "").split("/").filter(Boolean)) parts.push(shorten(sub, 30));
  parts.push(shortenFile(where.fileName));
  return fitPath(parts);
}

// Jos polku on liian pitkä, lyhennetään ensin tiedostonimeä ja sitten kansioita
function fitPath(parts) {
  let path = parts.join("/");
  if (path.length <= MAX_PATH) return path;
  const last = parts.length - 1;
  parts[last] = shortenFile(parts[last], 35);
  for (let i = last - 1; i >= 1 && parts.join("/").length > MAX_PATH; i--) parts[i] = shorten(parts[i], 20);
  path = parts.join("/");
  if (path.length > MAX_PATH) parts[last] = shortenFile(parts[last], 20);
  return parts.join("/");
}

export function unsortedPath(settings, fileName) {
  return `${rootPrefix(settings)}${UNSORTED_FOLDER}/${shortenFile(fileName)}`;
}

// Oman kansion tilassa Chromen tavallinen lataus menee ensin tänne, ja lisäosa kopioi sen opintokansioon
export function incomingPath(fileName) {
  return `${INCOMING_FOLDER}/${shortenFile(fileName)}`;
}

// ---------- Tagit (Omat tallennukset, Obsidian) ----------
// Käyttäjän kirjoittamat tagit Obsidianin muotoon: "tentti, #oma idea, luento/3" → ["tentti", "oma-idea", "luento/3"].
// Erotin on pilkku; myös "#a #b" erotetaan. # pois, välilyönnit väliviivoiksi, sallittu: kirjaimet, numerot, _ - /.
// Pelkistä numeroista koostuva tagi ei kelpaa Obsidianissa, joten se jätetään pois.
export const MAX_TAGS = 10;

export function parseTags(text) {
  const tags = [];
  const seen = new Set();
  const parts = String(text || "").split(",").flatMap(part => part.split(/\s+(?=#)/));
  for (const part of parts) {
    const tag = part.trim().replace(/^#+/, "").replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}_\-/]/gu, "").replace(/-{2,}/g, "-").replace(/\/{2,}/g, "/")
      .replace(/^[-/]+|[-/]+$/g, "").slice(0, 50);
    if (!tag || /^[\p{N}/]+$/u.test(tag) || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

// Aiemmin käytetyt tagit ehdotuksiksi: useimmin käytetyt ensin, tasatilanteessa viimeksi käytetty.
export function usedTags(savedTexts) {
  const stats = new Map();
  for (const t of savedTexts) {
    for (const tag of t.tags || []) {
      const key = tag.toLowerCase();
      const s = stats.get(key) || { tag, count: 0, last: 0 };
      s.count++;
      s.last = Math.max(s.last, t.saved || 0);
      stats.set(key, s);
    }
  }
  return [...stats.values()].sort((a, b) => b.count - a.count || b.last - a.last).map(s => s.tag);
}

// ---------- Moodle ----------

// "ABC24SP: Esimerkkikurssi 1 XY123456"      → ryhmä ABC24SP, nimi "Esimerkkikurssi 1", koodi XY123456
// "Esimerkkikurssi XY220201-3008"            → nimi "Esimerkkikurssi", koodi XY220201, toteutus 3008
// Koodi: 2 kirjainta + 4–8 kirjainta/numeroa, joista vähintään yksi numero.
export function parseMoodleCourseName(fullname, shortname) {
  let rest = String(fullname || "").trim();
  let group = "";
  const groupMatch = rest.match(/^([A-Z0-9]{3,12}):\s+(.+)$/);
  if (groupMatch) { group = groupMatch[1]; rest = groupMatch[2]; }

  const match = rest.match(/^(.*?)[\s,(]+([A-Z]{2}(?=[A-Z0-9]*\d)[A-Z0-9]{4,8})(?:-(\d{3,4}))?\)?\s*$/);
  if (match && match[1].trim()) {
    return { name: match[1].trim(), code: match[2], implementation: match[3] || "", group };
  }
  const code = shortname && shortname !== fullname ? shortname : "";
  return { name: rest, code, implementation: "", group };
}

// Lukuvuosi alkupäivästä: elokuusta alkaen uusi lukuvuosi. Unix-aikaleima sekunteina.
export function semesterFor(startUnix) {
  const date = startUnix ? new Date(startUnix * 1000) : new Date();
  const year = date.getFullYear();
  return date.getMonth() >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export function statusFor(startUnix, endUnix, nowMs = Date.now()) {
  const now = nowMs / 1000;
  if (startUnix && now < startUnix) return "upcoming";
  if (endUnix && now > endUnix) return "completed";
  return "active";
}

// Moodle-kurssin id osoitteesta .../course/view.php?id=1181
export function moodleCourseIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/course/view.php")) {
      const id = Number(parsed.searchParams.get("id"));
      return id > 1 ? id : null;
    }
  } catch (e) { /* ei kelvollinen osoite */ }
  return null;
}

// Aktiviteetin id: .../mod/resource/view.php?id=107367 tai .../mod/folder/download_folder.php?id=85233
export function activityIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (/\/mod\/\w+\/\w+\.php$/.test(parsed.pathname)) return Number(parsed.searchParams.get("id")) || null;
  } catch (e) { /* ei kelvollinen osoite */ }
  return null;
}

// Kurssin perustiedot YAML-ominaisuuksiksi. Merkkijonot lainataan myös kaksoispisteitä sisältäville nimille.
export function courseProperties(course, moodleUrl) {
  const lines = [
    `course: ${JSON.stringify(course.name)}`,
    `code: ${JSON.stringify(course.code || "")}`,
    `semester: ${JSON.stringify(course.semester || "")}`,
    `status: ${JSON.stringify(course.status || "")}`
  ];
  if (course.group) lines.push(`group: ${JSON.stringify(course.group)}`);
  const isoDay = unix => { const d = new Date(unix * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  if (course.start) lines.push(`start: ${isoDay(course.start)}`);
  if (course.end) lines.push(`end: ${isoDay(course.end)}`);
  if (course.moodleId) lines.push(`moodle: ${JSON.stringify(`${moodleUrl}/course/view.php?id=${course.moodleId}`)}`);
  return lines;
}

// Uusi kurssi Moodlen tiedoista
//   dates = { start, end } Moodlen alkamis- ja päättymispäivä (unix-sekunteina), jos tiedossa
export function newCourse(id, fullname, shortname, moodleId, semester, status, courses, dates = {}) {
  const parsed = parseMoodleCourseName(fullname, shortname);
  const course = { id, name: parsed.name, code: parsed.code, group: parsed.group, semester, status, moodleId,
    start: dates.start || 0, end: dates.end || 0 };
  course.folder = assignCourseFolder(course, courses);
  course.color = pickColor(courses); // kurssin väri pysyy samana koko ajan (shared/colors.js)
  return course;
}
