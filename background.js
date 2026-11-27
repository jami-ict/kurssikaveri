// background.js – lisäosan taustaskripti (Chromen "service worker").
//
// Tehtävät:
//  1. Kun Chrome aloittaa latauksen: päätellään kurssi, välilehti ja nimi → tallennuspaikka.
//  2. Kun lataus valmistuu: kirjasto, Kurssin tiedot.md ja ilmoitus.
//  3. Moodle-sivun (content.js) viestit: sivun sisältö, linkkien kohteet, "Tallenna Kurssikaveriin".
//  4. Sivujen pyynnöt: "järjestä kurssille", "poista kaksoiskappale" ...
//  5. Moodlesta haettavat tiedot: määräajat ja kurssien päivämäärät (shared/moodle.js)
//  6. Opinnot.md: koko opintokansion yhteenveto
//  7. .kurssikaveri/tiedot.json: tiedot talteen opintokansioon (shared/backup.js)
//  8. Päivitetyt tiedostot: opettaja vaihtoi tallennetun tiedoston Moodlessa (checkUpdates, saveUpdate)
//  9. Palautetut tehtävät: palautustehtävän tila tehtävän sivulta (withSubmissions)
//
// Kaksi tallennustilaa (asetus settings.storage):
//  - "folder"    = oma opintokansio. Lisäosa hakee tiedoston itse ja kirjoittaa sen suoraan
//                  kansioon (shared/fsstore.js). Chromen tavallinen lataus kopioidaan kansioon
//                  ja poistetaan latauskansiosta.
//  - "downloads" = Chromen latauskansio (Downloads/Kurssikaveri/...; vanhoissa asennuksissa StudyHub). Jo tallennettua tiedostoa ei voi
//                  siirtää, joten "järjestä" lataa sen uudelleen oikeaan paikkaan.

import { loadAll, save, withLock, moodleBase, newId } from "./shared/store.js";
import {
  TYPES, COURSE_FILE, suggestName, splitExtension, shortenFile, materialPath, unsortedPath,
  incomingPath, parseTags, cleanName, shorten, courseFolder, semesterFor, newCourse, moodleCourseIdFromUrl, activityIdFromUrl
} from "./shared/rules.js";
import { kindOf, contentsMarkdown, relativeToCourse, fileKey, videoInfo, cleanPageTitle } from "./shared/contents.js";
import { savedEntries, isNew, courseDeadlines, fileCounts, isPresent, existsMap, unreadTabsOf } from "./shared/status.js";
import { colorForCourse, ensureColors } from "./shared/colors.js";
import { overviewMarkdown, indexPath } from "./shared/overview.js";
import { fetchDeadlines, calendarAssignments, fetchMoodleCourses, fetchMoodlePastIds, isMoodleDeadline, moodleReachable } from "./shared/moodle.js";
import * as folder from "./shared/fsstore.js";
import { writeCoursePage } from "./shared/coursefile.js";
import { BACKUP_PATH, BACKUP_OLD_PATH, backupObject, backupFingerprint, parseBackup } from "./shared/backup.js";

const RECENT_MOODLE_MS = 15 * 60 * 1000; // "äsken avattu kurssisivu" = 15 min

const isFolderMode = settings => settings.storage === "folder";

function baseName(path) {
  return String(path || "").split(/[\\/]/).pop();
}

// Lisäosan omat Chrome-lataukset: osoite → { filename, conflictAction }
const expectedNames = new Map();

async function downloadOwn(url, filename, conflictAction = "uniquify") {
  expectedNames.set(url, { filename, conflictAction });
  return chrome.downloads.download({ url, filename, conflictAction, saveAs: false });
}

// ---------- Moodlen uudelleenohjaukset ----------
// Moodle ohjaa aktiviteetin (mod/resource/view.php?id=107390) tiedostoon (pluginfile.php/…).
// Muistetaan, mikä tiedosto kuului mihinkin aktiviteettiin. Vain kuunnellaan, mitään ei muuteta.

const fileUrlKey = url => String(url || "").split("?")[0];

chrome.webRequest.onBeforeRedirect.addListener(details => {
  const cmid = activityIdFromUrl(details.url);
  if (!cmid || !/pluginfile\.php/.test(details.redirectUrl)) return;
  chrome.storage.session.get("fileActivities").then(({ fileActivities = {} }) => {
    fileActivities[fileUrlKey(details.redirectUrl)] = cmid;
    const keys = Object.keys(fileActivities);
    for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete fileActivities[old];
    chrome.storage.session.set({ fileActivities });
  });
}, { urls: ["https://moodle5.samk.fi/*"] });

async function activityForFile(url) {
  const { fileActivities = {} } = await chrome.storage.session.get("fileActivities");
  return fileActivities[fileUrlKey(url)] || null;
}

// ---------- Kerätyn sisällön haku ----------

function findActivity(data, cmid) {
  if (!cmid) return null;
  for (const [moodleId, content] of Object.entries(data.courseContent)) {
    for (const [section, info] of Object.entries(content.sections || {})) {
      const item = info.items.find(i => i.cmid === cmid && !i.embedded);
      if (item) return { ...item, moodleId: Number(moodleId), section, sectionOrder: info.order, title: content.title };
    }
  }
  return null;
}

// Kansion tiedosto osoitteen perusteella (käyttäjä klikkasi tiedostoa kansiopuussa)
function findFolderFile(data, url) {
  const key = fileUrlKey(url);
  for (const [moodleId, content] of Object.entries(data.courseContent)) {
    for (const [section, info] of Object.entries(content.sections || {})) {
      for (const item of info.items) {
        const file = (item.files || []).find(f => fileUrlKey(f.url) === key);
        if (file) return { item, file, moodleId: Number(moodleId), section, sectionOrder: info.order, title: content.title };
      }
    }
  }
  return null;
}

function mappedCourse(data, moodleId) {
  const courseId = moodleId ? data.moodleMap[moodleId] : null;
  return courseId ? data.courses.find(c => c.id === courseId) : null;
}

// ---------- 1. Chrome aloittaa latauksen ----------

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // Lisäosan omat lataukset: polku on sovittu etukäteen
  if (item.byExtensionId === chrome.runtime.id) {
    const expected = expectedNames.get(item.url);
    expectedNames.delete(item.url);
    if (expected) suggest(expected); else suggest();
    return false;
  }
  withLock(() => planDownload(item))
    .then(result => (result ? suggest(result) : suggest()))
    .catch(error => {
      console.error("Kurssikaveri: latauksen käsittely epäonnistui", error);
      suggest();
    });
  return true;
});

async function planDownload(item) {
  const data = await loadAll();
  const { settings } = data;
  const base = moodleBase(settings);
  const fromMoodle = [item.url, item.finalUrl, item.referrer].some(u => u && base && u.startsWith(base));
  if (!fromMoodle) return null; // Kurssikaveri käsittelee vain Moodlen lataukset; muut Chrome hoitaa normaalisti

  const url = item.finalUrl || item.url;
  const originalName = baseName(item.filename) || "tiedosto";

  // Mikä aktiviteetti? Latauksen osoite, lähdesivu, uudelleenohjaus tai kansion tiedosto
  const folderFile = findFolderFile(data, url);
  const cmid = activityIdFromUrl(item.url) || activityIdFromUrl(item.referrer)
    || await activityForFile(url) || await activityForFile(item.referrer);
  const activity = folderFile ? null : findActivity(data, cmid);
  const moodle = resolveMoodleCourse(item, data, activity, folderFile);
  const course = mappedCourse(data, moodle && moodle.id);

  // Nimi: kansion tiedosto säilyttää nimensä, muuten aktiviteetin nimi (kuvaavampi) tai tiedostonimi
  let where;
  if (folderFile) {
    where = {
      type: suggestName(folderFile.file.name).type, fileName: folderFile.file.name,
      section: folderFile.section, sectionOrder: folderFile.sectionOrder,
      folder: folderFile.item.name, subpath: folderFile.file.subpath
    };
  } else {
    const name = activity && activity.kind !== "folder"
      ? suggestName(activity.name + splitExtension(originalName).ext, originalName, activity.section)
      : suggestName(originalName, "", activity ? activity.section : moodle && moodle.section);
    where = {
      type: name.type, fileName: name.fileName,
      section: activity ? activity.section : moodle && moodle.section,
      sectionOrder: activity ? activity.sectionOrder : moodle && moodle.sectionOrder
    };
  }

  const entry = {
    id: String(item.id),
    downloadId: item.id,
    url,
    originalName,
    cmid: folderFile ? folderFile.item.cmid : (activity ? activity.cmid : null),
    fileKey: folderFile ? fileKey(folderFile.item.cmid, folderFile.file.subpath, folderFile.file.name)
      : (activity && activity.kind === "file" ? fileKey(activity.cmid) : null),
    moodleId: moodle ? moodle.id : null,
    moodleTitle: moodle ? moodle.title || "" : "",
    type: where.type,
    fileName: where.fileName,
    section: where.section || null,
    sectionOrder: Number.isInteger(where.sectionOrder) ? where.sectionOrder : null,
    folder: where.folder || null,
    subpath: where.subpath || "",
    duplicateOf: await findDuplicateByUrl(item, data),
    state: "in_progress",
    fullPath: "",
    time: Date.now()
  };

  if (course) {
    Object.assign(entry, {
      status: "filed",
      courseId: course.id,
      confidence: moodle.how === "recent" ? "medium" : "high",
      reason: moodle.how === "recent"
        ? "Arvattu viimeksi avatun kurssisivun perusteella"
        : `Ladattu kurssin ${course.name} Moodle-sivulta${entry.section ? ` (${entry.section})` : ""}`,
      targetPath: materialPath(settings, course, where)
    });
  } else {
    Object.assign(entry, {
      status: "unsorted",
      courseId: null,
      confidence: "none",
      reason: moodle ? `Moodle-kurssia "${moodle.title || moodle.id}" ei ole lisätty Kurssikaveriin` : "Kurssia ei tunnistettu",
      targetPath: unsortedPath(settings, originalName)
    });
  }

  // Oma kansio: Chrome tallentaa välikansioon, ja valmistuttua tiedosto kopioidaan opintokansioon
  if (isFolderMode(settings)) {
    entry.stored = "folder";
    entry.transfer = true;
    entry.path = "";
    data.downloads[entry.id] = entry;
    await save({ downloads: data.downloads });
    return { filename: incomingPath(originalName), conflictAction: "uniquify" };
  }

  entry.stored = "downloads";
  entry.path = entry.targetPath;
  data.downloads[entry.id] = entry;
  await save({ downloads: data.downloads });
  return { filename: entry.path, conflictAction: "uniquify" };
}

// Mistä Moodle-kurssista lataus tuli?
function resolveMoodleCourse(item, data, activity, folderFile) {
  const referrer = item.referrer || "";
  if (folderFile) return { id: folderFile.moodleId, title: folderFile.title, how: "activity" };
  if (activity) return { id: activity.moodleId, title: activity.title, section: activity.section, sectionOrder: activity.sectionOrder, how: "activity" };

  const page = data.pageCourses[referrer];
  const fromUrl = moodleCourseIdFromUrl(referrer);
  if (fromUrl) return { id: fromUrl, title: page ? page.title : "", section: page ? page.section : null, sectionOrder: page ? page.sectionOrder : null, how: "referrer" };
  if (page) return { id: page.moodleId, title: page.title, section: page.section, sectionOrder: page.sectionOrder, how: "page" };
  if (data.lastMoodle && Date.now() - data.lastMoodle.time < RECENT_MOODLE_MS) {
    const last = data.lastMoodle;
    return { id: last.moodleId, title: last.title, section: last.section, sectionOrder: last.sectionOrder, how: "recent" };
  }
  return null;
}

// Latauskansion tilassa: sama osoite ladattu aiemmin, ja tiedosto on yhä tallessa → kaksoiskappale
async function findDuplicateByUrl(item, data) {
  const url = item.finalUrl || item.url;
  const earlier = await chrome.downloads.search({ url, state: "complete" });
  const match = earlier.find(d => d.id !== item.id && d.exists && data.downloads[String(d.id)]);
  return match ? String(match.id) : null;
}

// ---------- 2. Chrome-lataus valmistuu ----------

chrome.downloads.onChanged.addListener(delta => {
  if (!delta.state || (delta.state.current !== "complete" && delta.state.current !== "interrupted")) return;
  withLock(() => finishDownload(delta.id, delta.state.current)).catch(console.error);
});

async function finishDownload(downloadId, state) {
  const data = await loadAll();
  const entry = Object.values(data.downloads).find(d => d.downloadId === downloadId);
  if (!entry) return;

  const [item] = await chrome.downloads.search({ id: downloadId });
  entry.state = state;
  entry.fullPath = item ? item.filename : "";

  // Uudelleenjärjestys latauskansiossa: uusi kopio valmis → poistetaan vanha
  if (entry.replaces) {
    const old = data.downloads[entry.replaces];
    delete entry.replaces;
    if (state === "complete") {
      if (old) { await removeDownload(old.downloadId); delete data.downloads[old.id]; }
      await save({ downloads: data.downloads });
      notify(entry, "Siirretty", `${courseName(entry, data)} / ${baseName(entry.fullPath)}`);
    } else {
      delete data.downloads[entry.id];
      if (old) delete old.movingTo;
      await save({ downloads: data.downloads });
      notify(entry, "Siirto epäonnistui", "Tiedosto on edelleen vanhassa paikassa. Yritä uudelleen kirjastosta.");
    }
    if (entry.moodleId) scheduleContents(entry.moodleId);
    return;
  }

  if (state === "complete" && entry.transfer) {
    await transferToFolder(entry, data);
  }
  await save({ downloads: data.downloads });
  if (entry.moodleId) scheduleContents(entry.moodleId);

  if (state === "interrupted") {
    if (entry.fromPage) notify(entry, "Tallennus epäonnistui", `${entry.fileName}: lataus keskeytyi. Oletko yhä kirjautunut Moodleen?`);
    return;
  }
  if (!data.settings.notifications || entry.state !== "complete") return;
  notifyResult(entry, data);
}

// Oman kansion tila: Chromen lataama tiedosto kopioidaan opintokansioon ja poistetaan latauskansiosta.
// Tiedostoa ei voi lukea latauskansiosta, joten se haetaan uudelleen samasta osoitteesta.
async function transferToFolder(entry, data) {
  try {
    const blob = await fetchFile(entry.url);
    await storeInFolder(entry, blob, data);
    await removeDownload(entry.downloadId);
    entry.downloadId = null;
    delete entry.transfer;
  } catch (error) {
    if (error.code === "permission" || error.code === "missing") {
      entry.state = "pending";
      entry.note = "Odottaa lupaa opintokansioon";
      data.pending.push({ type: "transfer", id: entry.id });
      await save({ pending: data.pending });
    } else {
      // Ei onnistunut: tiedosto jää latauskansion välikansioon (INCOMING_FOLDER), josta sen voi avata
      entry.stored = "downloads";
      entry.path = incomingPath(entry.originalName);
      entry.note = `Jäi latauskansioon (${error.message})`;
      delete entry.transfer;
    }
  }
}

// Kirjoittaa tiedoston opintokansioon. Sama sisältö (SHA-256) aiemmin tallennettuna → kaksoiskappale.
//   exists = existsMap()-funktion tulos, jos se on jo haettu: levyltä poistettu tiedosto ei ole alkuperäinen
async function storeInFolder(entry, blob, data, exists = null) {
  entry.hash = await folder.sha256(blob);
  const remote = blobRemote.get(blob);
  if (remote) entry.remote = remote;
  const earlier = Object.values(data.downloads).find(d =>
    d.id !== entry.id && d.hash === entry.hash && d.stored === "folder" && d.state === "complete" && isPresent(d, exists));
  if (earlier) entry.duplicateOf = earlier.id;
  const target = await folder.uniquePath(entry.targetPath);
  await folder.writeFile(target, blob);
  entry.path = target;
  entry.fullPath = target;
  entry.stored = "folder";
  entry.state = "complete";
  delete entry.note;
}

// Hakee tiedoston Moodlesta. Virheviestit kertovat käyttäjälle, miksi tiedostoa ei saatu.
async function fetchFile(url) {
  // Moodle sallii selaimen välimuistin 6 tuntia: ilman tätä päivitetyn tiedoston tilalle tallentuisi vanha versio
  const response = await moodleFetch(url, { cache: "no-store" });
  if (response.status === 404) throw new Error("Moodle ei löytänyt tiedostoa (404)");
  if (response.status === 403) throw new Error("ei käyttöoikeutta tiedostoon (403)");
  if (!response.ok) throw new Error(`Moodle vastasi virheellä ${response.status}`);
  if (/\/login\//.test(response.url)) throw new Error(LOGIN_ERROR);
  const type = response.headers.get("content-type") || "";
  const remote = remoteInfo(response.headers);
  if (!type.includes("text/html")) return withRemote(await response.blob(), remote);

  // HTML voi olla oikea tiedosto (esim. Web-sivut-kurssin esimerkkisivu) tai Moodlen oma sivu tiedoston sijaan.
  // Moodlen omissa sivuissa on M.cfg-asetus; kirjautumissivulla lisäksi logintoken-kenttä.
  const text = await response.text();
  if (/name="logintoken"|id="page-login-index"/.test(text)) throw new Error(LOGIN_ERROR);
  if (/M\.cfg\s*=/.test(text)) throw new Error("Moodle näytti oman sivunsa tiedoston sijaan");
  return withRemote(new Blob([text], { type }), remote);
}

// ---------- Tiedoston tunnistetiedot ----------
// Moodle kertoo tiedoston mukana sen sisällön tunnisteen (Etag, sisällön SHA-1), muokkausajan ja koon.
// Ne tallennetaan tallennuksen yhteydessä (entry.remote), ja checkUpdates vertaa niitä myöhemmin:
// jos ne muuttuvat, opettaja on vaihtanut tiedoston, ja tallennettu versio on vanha.
const blobRemote = new WeakMap(); // haettu tiedosto → sen tunnistetiedot (fetchFile → storeInFolder)

function withRemote(blob, remote) {
  if (remote) blobRemote.set(blob, remote);
  return blob;
}

// { etag, modified, size } tai null, jos vastauksessa ei ole tunnistetta eikä muokkausaikaa
function remoteInfo(headers) {
  // Palvelimen pakkaus voi lisätä tunnisteeseen päätteen (-gzip), joten se poistetaan vertailua varten
  const etag = (headers.get("etag") || "").replace(/^W\//, "").replace(/"/g, "").replace(/-(gzip|br|deflate)$/, "");
  const modified = headers.get("last-modified") || "";
  if (!etag && !modified) return null;
  return { etag, modified, size: Number(headers.get("content-length") || 0) || 0 };
}

// Onko tiedosto muuttunut? Ensisijaisesti sisällön tunniste, muuten muokkausaika
function remoteChanged(before, now) {
  if (before.etag && now.etag) return before.etag !== now.etag;
  if (before.modified && now.modified) return before.modified !== now.modified;
  return false;
}

const LOGIN_ERROR = "Moodle pyysi kirjautumista. Kirjaudu Moodleen ja yritä uudelleen";

// fetch Moodleen. Jos haku katkeaa, katsotaan, vastaako Moodle: jos vastaa, istunto on vanhentunut ja Moodle ohjasi
// koulun kertakirjautumiseen (ks. shared/moodle.js: moodleReachable).
async function moodleFetch(url, options = {}) {
  try {
    return await fetch(url, { credentials: "include", ...options });
  } catch (error) {
    if (await moodleReachable(new URL(url).origin)) throw new Error(LOGIN_ERROR);
    throw new Error("yhteys Moodleen katkesi");
  }
}

// Selaimen yleinen verkkovirhe suomeksi
function failReason(error) {
  return error instanceof TypeError && /fetch/i.test(error.message) ? "yhteys Moodleen katkesi" : error.message;
}

async function removeDownload(downloadId) {
  if (downloadId === null || downloadId === undefined) return;
  try { await chrome.downloads.removeFile(downloadId); } catch (e) { /* tiedosto jo poistettu */ }
  try { await chrome.downloads.erase({ id: downloadId }); } catch (e) { /* ei historiassa */ }
}

function courseName(entry, data) {
  const course = data.courses.find(c => c.id === entry.courseId);
  return course ? course.name : "";
}

// ---------- Ilmoitukset ----------

function buttonsFor(entry) {
  const show = entry.stored === "downloads" ? ["show", "Näytä kansiossa"] : ["library", "Näytä Kurssikaverissa"];
  if (entry.duplicateOf) return [["removeCopy", "Poista uusi kopio"], show];
  if (entry.status === "unsorted") return [["fix", "Valitse kurssi"]];
  if (entry.confidence === "medium") return [["fix", "Vaihda kurssi"], show];
  return [show];
}

function notifyResult(entry, data) {
  const file = baseName(entry.path || entry.fullPath);
  const where = [courseName(entry, data), entry.section, entry.folder].filter(Boolean).join(" / ");
  if (entry.duplicateOf) notify(entry, "Tämä tiedosto on jo tallessa", `${file} – sama tiedosto on tallennettu aiemmin.`);
  else if (entry.status === "filed") notify(entry, entry.confidence === "high" ? "Tallennettu" : "Tallennettu (tarkista kurssi)", `${where} / ${file}`);
  else notify(entry, "Kurssia ei tunnistettu", `${file} tallennettiin kansioon _Järjestämättä.`);
}

function notify(entry, title, message) {
  chrome.notifications.create(`dl-${entry.id}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Kurssikaveri: ${title}`,
    message,
    buttons: buttonsFor(entry).map(([, label]) => ({ title: label }))
  });
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, index) => {
  const id = notificationId.replace("dl-", "");
  const { downloads } = await loadAll();
  const entry = downloads[id];
  if (!entry) return;
  const [action] = buttonsFor(entry)[index] || [];
  if (action === "show" && entry.downloadId !== null) chrome.downloads.show(entry.downloadId);
  if (action === "library") openPage("library.html#home");
  if (action === "fix") openPage(`library.html#fix=${id}`);
  if (action === "removeCopy") withLock(() => removeCopy(id));
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onClicked.addListener(notificationId => {
  openPage("library.html");
  chrome.notifications.clear(notificationId);
});

function openPage(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

// ---------- 3. Moodle-sivun sisältö ----------

async function pageContent({ moodleId, title, url, isCurrent, section, sectionOrder, tabs, dimTabs, sections }) {
  const data = await loadAll();

  if (isCurrent) {
    const info = { moodleId, title, section, sectionOrder, time: Date.now() };
    data.pageCourses[url] = info;
    const urls = Object.keys(data.pageCourses).sort((a, b) => data.pageCourses[b].time - data.pageCourses[a].time);
    for (const old of urls.slice(200)) delete data.pageCourses[old];
    data.lastMoodle = info;
  }

  const hadContent = Boolean(data.courseContent[moodleId]);
  const content = data.courseContent[moodleId] || { title, tabs: [], sections: {} };
  const oldTabs = content.tabs || [];
  const now = Date.now();
  content.title = title;
  // Kaikki aiemmin kerätyt kohteet: kohde voi siirtyä välilehdeltä toiselle tai välilehti saada uuden nimen
  const elsewhere = {};
  for (const info of Object.values(content.sections)) for (const item of info.items) elsewhere[item.key || item.cmid] = item;
  if (tabs && tabs.length) {
    content.tabs = tabs;
    content.dimTabs = (dimTabs || []).filter(name => tabs.includes(name)); // himmennetyt: eivät jää "puuttuviksi"
    // Opettaja on nimennyt välilehden uudelleen tai poistanut sen: vanha pois sisällysluettelosta
    for (const name of Object.keys(content.sections)) if (!tabs.includes(name)) delete content.sections[name];
  }
  for (const s of sections || []) {
    const previous = content.sections[s.name];
    // Ensimmäinen keruu = lähtötilanne, ei "uutta". Uusi välilehti jo kerätyllä kurssilla = uutta.
    const baseline = !previous && (!hadContent || oldTabs.includes(s.name));
    const known = {};
    if (previous) for (const item of previous.items) known[item.key || item.cmid] = item;
    content.sections[s.name] = {
      order: s.order,
      updated: now,
      items: s.items.map(item => {
        const before = known[item.key || item.cmid] || elsewhere[item.key || item.cmid] || null;
        const merged = { ...item, kind: item.kind || kindOf(item.modtype, item.icon, item.name) };
        merged.firstSeen = before ? (before.firstSeen || 0) : (baseline ? 0 : now);
        if (before) {
          if (!merged.target && before.target) { merged.target = before.target; merged.kind = before.kind; merged.service = before.service; }
          if (!merged.files && before.files) merged.files = before.files; // kansion sisältö haettu aiemmin
        }
        if (merged.files) merged.files = mergeFolderFiles(merged.files, before, merged.firstSeen, now);
        return merged;
      })
    };
  }
  content.updated = Date.now();
  data.courseContent[moodleId] = content;
  await save({ courseContent: data.courseContent, pageCourses: data.pageCourses, lastMoodle: data.lastMoodle });
  scheduleContents(moodleId);
  if (isCurrent) scheduleUpdateCheck(moodleId); // onko tallennettuja tiedostoja vaihdettu Moodlessa (enintään 4 h välein)

  const missingTargets = (sections || []).flatMap(s => content.sections[s.name].items)
    .filter(i => i.modtype === "url" && !i.target).map(i => i.cmid);
  return { missingTargets };
}

// Kansion tiedostot: uudet tiedostot merkitään uusiksi, jos kansion sisältö tunnettiin jo aiemmin
function mergeFolderFiles(files, before, itemFirstSeen, now) {
  const old = {};
  for (const f of (before && before.files) || []) old[`${f.subpath}${f.name}`] = f;
  const knewBefore = Boolean(before && before.files);
  return files.map(f => {
    const was = old[`${f.subpath}${f.name}`];
    return { ...f, firstSeen: was ? (was.firstSeen || 0) : (knewBefore ? now : itemFirstSeen) };
  });
}

function youtubeId(url) {
  const match = String(url).match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return match ? match[1] : null;
}

async function linkTargets({ moodleId, targets }) {
  const data = await loadAll();
  const content = data.courseContent[moodleId];
  if (!content) return;
  for (const info of Object.values(content.sections)) {
    for (const item of info.items) {
      if (!targets[item.cmid] || item.embedded) continue;
      item.target = targets[item.cmid];
      // Linkki YouTubeen on video
      const id = youtubeId(item.target);
      if (id) { item.kind = "video"; item.service = "YouTube"; item.target = `https://www.youtube.com/watch?v=${id}`; }
    }
  }
  await save({ courseContent: data.courseContent });
  scheduleContents(moodleId);
}

// Kurssisivun palkkia varten: onko kurssi Kurssikaverissa ja mitkä tiedostot on tallennettu
async function pageStatus({ moodleId }) {
  const data = await loadAll();
  const course = mappedCourse(data, moodleId);
  const exists = await existsMap(data.downloads);
  const saved = {};
  const pending = {};
  const updated = {}; // tiedostoavain → tallennuksen tunnus: tiedosto on vaihdettu Moodlessa
  const entries = savedEntries(data, moodleId, exists, true);
  for (const [key, d] of Object.entries(entries)) {
    saved[key] = d.path || d.targetPath;
    if (d.state === "pending") pending[key] = true;
    if (d.update && d.state === "complete") updated[key] = d.id;
  }
  // Uudet kohteet ja kansioihin lisätyt tiedostot (avaimet), sekä määräajat aktiviteeteittain
  const now = Date.now();
  const fresh = {};
  const content = data.courseContent[moodleId];
  for (const info of Object.values((content && content.sections) || {})) {
    for (const item of info.items) {
      const files = (item.files || []).filter(f => isNew(f.firstSeen, now)).length;
      if (isNew(item.firstSeen, now)) fresh[item.key || item.cmid] = "item";
      else if (files) fresh[item.key || item.cmid] = files;
    }
  }
  const deadlines = {};
  for (const d of courseDeadlines(data, moodleId)) if (d.cmid) deadlines[d.cmid] = { time: d.time, label: d.label, overdue: d.overdue, submitted: Boolean(d.submitted) };
  // Koko kurssin tilanne ("Tallenna kurssin kaikki tiedostot")
  const counts = fileCounts(content, entries);
  // Palkin "Kaikki tiedostot koneellasi" vain, kun kaikki välilehdet on luettu ja lataukset ovat valmiit
  const unchecked = !Object.keys((content && content.sections) || {}).length || unreadTabsOf(content).length > 0;
  const downloading = Object.values(entries).filter(d => d.state === "in_progress").length;
  return { mapped: Boolean(course), courseId: course ? course.id : null, courseName: course ? course.name : "", saved, pending, updated, fresh, deadlines,
    color: course ? colorForCourse(data, course) : null,   // Moodle-palkin väri (content.css: .studyhub-k1 … k7)
    course: { unsaved: counts.unsaved, unknownFolders: counts.unknownFolders, total: counts.total, saved: counts.saved,
      saving: courseSaves.has(Number(moodleId)), updated: Object.keys(updated).length, unchecked, downloading } };
}

// "Lisää kurssi Kurssikaveriin" Moodle-sivulta
async function addCourseFromPage({ moodleId, title }) {
  if (!moodleId) throw new Error("Moodle-kurssin tunnus puuttuu.");
  const data = await loadAll();
  const existing = mappedCourse(data, moodleId) || data.courses.find(c => c.moodleId === moodleId);
  if (existing) {
    if (data.moodleMap[moodleId] !== existing.id) await save({ moodleMap: { ...data.moodleMap, [moodleId]: existing.id } });
    return existing.id;
  }
  const course = newCourse(newId(), title, "", moodleId, semesterFor(Date.now() / 1000), "active", data.courses);
  data.courses.push(course);
  data.moodleMap[moodleId] = course.id;
  await save({ courses: data.courses, moodleMap: data.moodleMap });
  await writeCourseFiles(data.settings, course, { deferOnFolderError: true });
  scheduleContents(moodleId);
  setTimeout(() => refreshMoodle({ force: true }).catch(() => {}), 100); // kurssin päivämäärät Moodlesta
  return course.id;
}

// "Tallenna Kurssikaveriin": content.js on selvittänyt tiedoston latausosoitteen
//   keepName = kansion tiedosto säilyttää nimensä, folder/subpath = Moodlen kansio ja sen alikansiot
//   exists = existsMap()-funktion tulos, jos kutsuja on jo hakenut sen (kurssin kaikki tiedostot kerralla)
async function saveFile(request, exists = null) {
  const { moodleId, cmid, name, keepName, folder: folderName, subpath, section, sectionOrder, url } = request;
  const data = await loadAll();
  const course = mappedCourse(data, moodleId);
  if (!course) throw new Error("Lisää kurssi ensin Kurssikaveriin.");
  const key = request.fileKey || (cmid ? fileKey(cmid) : null);

  if (!exists) exists = await existsMap(data.downloads);
  const sameFile = d => key && d.fileKey === key && d.moodleId === moodleId && d.status === "filed" && !d.movingTo;
  const already = Object.values(data.downloads).find(d =>
    sameFile(d) && ["complete", "in_progress", "pending"].includes(d.state) && isPresent(d, exists));
  if (already) return { already: true, path: already.path };
  // Vanha merkintä tiedostosta, joka on poistettu levyltä tai jonka tallennus epäonnistui: uusi tallennus korvaa sen
  for (const d of Object.values(data.downloads)) {
    if (sameFile(d) && (d.state === "failed" || (d.state === "complete" && !isPresent(d, exists)))) delete data.downloads[d.id];
  }

  const urlName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  const ext = splitExtension(urlName).ext;
  const suggestion = keepName
    ? { type: suggestName(name).type, fileName: shortenFile(name) }
    : name ? suggestName(name + ext, urlName, section) : suggestName(urlName, "", section);
  const where = { type: suggestion.type, fileName: suggestion.fileName, section, sectionOrder, folder: folderName, subpath };

  const entry = {
    id: newId("f"), downloadId: null, url, originalName: urlName || name, cmid: cmid || null, fileKey: key, moodleId,
    moodleTitle: data.courseContent[moodleId] ? data.courseContent[moodleId].title : "",
    status: "filed", courseId: course.id, type: suggestion.type, fileName: suggestion.fileName,
    section: section || null, sectionOrder: Number.isInteger(sectionOrder) ? sectionOrder : null,
    folder: folderName || null, subpath: subpath || "",
    targetPath: materialPath(data.settings, course, where), confidence: "high",
    reason: `Tallennettu Moodle-sivulta${section ? ` (${section})` : ""}`,
    duplicateOf: null, state: "in_progress", fullPath: "", time: Date.now(), fromPage: true
  };

  if (isFolderMode(data.settings)) {
    data.downloads[entry.id] = entry;
    try {
      await storeInFolder(entry, await fetchFile(url), data, exists);
    } catch (error) {
      if (error.code !== "permission" && error.code !== "missing") { delete data.downloads[entry.id]; throw error; }
      entry.state = "pending";
      entry.stored = "folder";
      entry.note = "Odottaa lupaa opintokansioon";
      data.pending.push({ type: "save", id: entry.id });
      await save({ downloads: data.downloads, pending: data.pending });
      return { pending: true, path: entry.targetPath };
    }
    await save({ downloads: data.downloads });
    scheduleContents(moodleId);
    return { path: entry.path, duplicate: Boolean(entry.duplicateOf) };
  }

  // Latauskansio: Chrome lataa tiedoston suoraan oikeaan paikkaan
  entry.stored = "downloads";
  entry.path = entry.targetPath;
  entry.downloadId = await downloadOwn(url, entry.path);
  entry.id = String(entry.downloadId);
  data.downloads[entry.id] = entry;
  await save({ downloads: data.downloads });
  return { path: entry.path };
}

// Ponnahdusikkuna: selaimen PDF-katselimessa auki oleva Moodle-tiedosto talteen
async function saveFromTab({ tabId }) {
  const data = await loadAll();
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);
  url.searchParams.set("forcedownload", "1");

  const folderFile = findFolderFile(data, tab.url);
  if (folderFile) {
    return saveFile({
      moodleId: folderFile.moodleId, cmid: folderFile.item.cmid, name: folderFile.file.name, keepName: true,
      fileKey: fileKey(folderFile.item.cmid, folderFile.file.subpath, folderFile.file.name),
      folder: folderFile.item.name, subpath: folderFile.file.subpath,
      section: folderFile.section, sectionOrder: folderFile.sectionOrder, url: url.href
    });
  }
  const cmid = await activityForFile(tab.url);
  const activity = findActivity(data, cmid);
  if (activity) {
    return saveFile({ moodleId: activity.moodleId, cmid: activity.cmid, name: activity.name,
      section: activity.section, sectionOrder: activity.sectionOrder, url: url.href });
  }
  const opener = tab.openerTabId ? await chrome.tabs.get(tab.openerTabId).catch(() => null) : null;
  const page = opener ? data.pageCourses[opener.url] : null;
  const source = page || (data.lastMoodle && Date.now() - data.lastMoodle.time < RECENT_MOODLE_MS ? data.lastMoodle : null);
  if (!source) throw new Error("Kurssia ei tunnistettu. Avaa tiedosto Moodlen kurssisivulta.");
  // Jos aktiviteetti tiedetään mutta sen välilehteä ei ole vielä kerätty, ei arvata välilehteä
  return saveFile({ moodleId: source.moodleId, cmid: cmid || null, name: "", section: cmid ? null : source.section,
    sectionOrder: cmid ? null : source.sectionOrder, url: url.href });
}

// ---------- Kurssin kaikki tiedostot kerralla ----------
// "Tallenna kurssin kaikki tiedostot": Moodle-palkista tai Kurssikaverin kurssisivulta.
// Käy läpi kurssin kerätyn sisällön ja tallentaa jokaisen tallentamattoman tiedoston ja kansion tiedoston.

const courseSaves = new Map(); // moodleId → kesken oleva tallennus

function saveCourseFiles({ moodleId }) {
  moodleId = Number(moodleId);
  if (!courseSaves.has(moodleId)) {
    courseSaves.set(moodleId, doSaveCourseFiles(moodleId).finally(() => courseSaves.delete(moodleId)));
  }
  return courseSaves.get(moodleId);
}

async function doSaveCourseFiles(moodleId) {
  const data = await loadAll();
  if (!mappedCourse(data, moodleId)) throw new Error("Lisää kurssi ensin Kurssikaveriin.");
  const content = data.courseContent[moodleId];
  if (!content) throw new Error("Avaa kurssi kerran Moodlessa, niin sen sisältö tulee näkyviin.");
  const base = moodleBase(data.settings);
  const exists = await existsMap(data.downloads);
  const saved = savedEntries(data, moodleId, exists, true);

  const jobs = [];
  const sections = Object.entries(content.sections).sort((a, b) => a[1].order - b[1].order);
  for (const [section, info] of sections) {
    for (const item of info.items) {
      if (item.kind === "file" && !saved[fileKey(item.cmid)]) {
        jobs.push({ item, section, sectionOrder: info.order });
      } else if (item.kind === "folder") {
        let files = item.files;
        if (!files) files = await loadFolder(base, moodleId, item);
        for (const file of files || []) {
          const key = fileKey(item.cmid, file.subpath, file.name);
          if (!saved[key]) jobs.push({ item, file, key, section, sectionOrder: info.order });
        }
      }
    }
  }

  let done = 0;
  const failed = [];
  for (const job of jobs) {
    try {
      if (job.file) {
        await withLock(() => saveFile({
          moodleId, cmid: job.item.cmid, fileKey: job.key, name: job.file.name, keepName: true,
          folder: job.item.name, subpath: job.file.subpath, section: job.section, sectionOrder: job.sectionOrder, url: job.file.url
        }, exists));
      } else {
        const url = await resolveResourceUrl(base, job.item.cmid);
        await withLock(() => saveFile({
          moodleId, cmid: job.item.cmid, fileKey: fileKey(job.item.cmid), name: job.item.name,
          section: job.section, sectionOrder: job.sectionOrder, url
        }, exists));
      }
      done++;
    } catch (error) {
      // Mikä jäi tallentamatta ja missä se on: Moodle-palkki ja kurssisivu näyttävät listan ja linkin materiaaliin
      failed.push({
        name: job.file ? `${job.file.subpath || ""}${job.file.name}` : job.item.name,
        where: job.file ? `${job.section} › ${job.item.name}` : job.section,
        reason: failReason(error),
        url: job.item.moodleUrl || ""
      });
    }
  }
  return { total: jobs.length, done, failed };
}

// Tiedostoaktiviteetin latausosoite: Moodle ohjaa view.php?id=…&redirect=1 → pluginfile.php/…
async function resolveResourceUrl(base, cmid) {
  let url = null;
  try {
    const head = await fetch(`${base}/mod/resource/view.php?id=${cmid}&redirect=1`, { method: "HEAD", credentials: "include" });
    if (/pluginfile\.php/.test(head.url)) url = head.url;
  } catch (e) { /* kokeillaan alla */ }
  if (!url) {
    const page = await moodleFetch(`${base}/mod/resource/view.php?id=${cmid}`);
    if (/\/login\//.test(page.url)) throw new Error(LOGIN_ERROR);
    if (/pluginfile\.php/.test(page.url)) url = page.url;
    else {
      const match = (await page.text()).match(/https?:[^"'\s<>]*pluginfile\.php[^"'\s<>]+/);
      if (match) url = match[0].replace(/&amp;/g, "&");
    }
  }
  if (!url) throw new Error("tiedostoa ei löytynyt materiaalin sivulta");
  const parsed = new URL(url);
  parsed.searchParams.set("forcedownload", "1");
  return parsed.href;
}

// Omalle sivulleen aukeavan kansion tiedostot (taustaskriptissä ei ole DOMParseria, siksi säännöllinen lauseke)
async function loadFolder(base, moodleId, item) {
  try {
    const response = await moodleFetch(`${base}/mod/folder/view.php?id=${item.cmid}`);
    if (/\/login\//.test(response.url) || new URL(response.url).origin !== new URL(base).origin) throw new Error(LOGIN_ERROR);
    if (!response.ok) throw new Error(`Kansion haku epäonnistui (HTTP ${response.status}).`);
    const html = await response.text();
    if (/name\s*=\s*["']logintoken["']|id\s*=\s*["']page-login-index["']/i.test(html)) throw new Error(LOGIN_ERROR);
    if (!/class\s*=\s*["'][^"']*\bfoldertree\b[^"']*["']/i.test(html)) {
      throw new Error("Kansion tiedostolistaa ei löytynyt. Avaa kansio Moodlessa ja tarkista käyttöoikeus.");
    }
    const files = new Map();
    for (const match of html.matchAll(/href="([^"]*\/mod_folder\/content\/\d+\/[^"]+)"/g)) {
      const href = new URL(match[1].replace(/&amp;/g, "&"), base);
      const parts = href.pathname.replace(/^.*\/mod_folder\/content\/\d+\//, "").split("/").map(decodeURIComponent);
      const name = parts.pop();
      href.search = "";
      href.searchParams.set("forcedownload", "1");
      files.set(href.href, { name, subpath: parts.length ? parts.join("/") + "/" : "", url: href.href, firstSeen: item.firstSeen || 0 });
    }
    const list = [...files.values()];
    // Muistetaan kansion sisältö (Kurssin tiedot.md, kurssisivu)
    await withLock(async () => {
      const fresh = await loadAll();
      for (const info of Object.values((fresh.courseContent[moodleId] || {}).sections || {})) {
        const stored = info.items.find(i => i.cmid === item.cmid && i.kind === "folder");
        if (stored && !stored.files) stored.files = list;
      }
      await save({ courseContent: fresh.courseContent });
    });
    return list;
  } catch (error) {
    throw new Error(`${item.name}: ${failReason(error)}`);
  }
}

// Kurssin perustiedosto: Kurssin tiedot.md. Muut kansiot syntyvät sisältöä tallennettaessa.
async function writeCourseFiles(settings, course, { deferOnFolderError = false } = {}) {
  try {
    const data = await loadAll();
    await writeCourseContents({ ...data, settings }, course, true);
  } catch (error) {
    if (!deferOnFolderError) throw error;
    // processPending yrittää uudelleen luvan antamisen jälkeen.
  }
}

async function createCourseFiles({ courseIds, folderOnly = false }) {
  const data = await loadAll();
  if (folderOnly && !isFolderMode(data.settings)) throw new Error("Oma opintokansio ei ole käytössä.");
  const failed = [];
  for (const course of data.courses.filter(c => courseIds.includes(c.id))) {
    try {
      // Tuonti ottaa yhteisen lukon kurssi kerrallaan; ajastetut päivitykset käyttävät samaa lukkoa.
      await withLock(async () => {
        const fresh = await loadAll();
        if (folderOnly && !isFolderMode(fresh.settings)) throw new Error("Oma opintokansio ei ole käytössä.");
        const current = fresh.courses.find(item => item.id === course.id);
        if (current) await writeCourseFiles(fresh.settings, current);
      });
    } catch (error) {
      failed.push(`${course.name}: ${error.message}`);
      continue;
    }
  }
  if (failed.length) throw new Error(failed.join("; "));
}

// ---------- Kurssin tiedot.md ----------

const contentTimers = {};

function scheduleContents(moodleId) {
  clearTimeout(contentTimers[moodleId]);
  contentTimers[moodleId] = setTimeout(() => withLock(() => writeContents(moodleId)).catch(console.error), 1500);
}

// Sama kurssin mukaan: toimii myös kurssille, jolla ei ole Moodle-kurssia (omat linkit)
function scheduleCourseContents(course) {
  if (course.moodleId) { scheduleContents(course.moodleId); return; }
  const key = contentsKey(course);
  clearTimeout(contentTimers[key]);
  contentTimers[key] = setTimeout(() => withLock(async () => {
    const data = await loadAll();
    const current = data.courses.find(c => c.id === course.id);
    if (current) await writeCourseContents(data, current, false);
  }).catch(console.error), 1500);
}

// Avain, jolla Kurssin tiedot.md:n tila on tallessa (contentsMeta): Moodle-kurssin numero tai "course-<id>"
function contentsKey(course) {
  return course.moodleId || `course-${course.id}`;
}

function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return String(hash);
}

async function writeContents(moodleId, force = false) {
  const data = await loadAll();
  const course = mappedCourse(data, moodleId);
  if (course) await writeCourseContents(data, course, force);
}

// Kirjoittaa yhden kurssisivun: perustiedot, omat linkit, tekstitiedostojen linkit ja Moodlen materiaalit.
async function writeCourseContents(data, course, force) {
  const moodleId = course.moodleId || null;
  const metaKey = contentsKey(course);
  const bookmarks = data.bookmarks.filter(b => b.courseId === course.id);
  const savedTexts = data.savedTexts.filter(t => t.courseId === course.id);
  const collected = moodleId ? data.courseContent[moodleId] : null;
  const content = collected || { tabs: [], sections: {} };

  const dir = courseFolder(data.settings, course);
  const saved = {};
  if (moodleId) {
    const exists = await existsMap(data.downloads);
    for (const [key, d] of Object.entries(savedEntries(data, moodleId, exists))) {
      const relative = relativeToCourse(d.stored === "folder" ? d.path : (d.fullPath || d.path), dir);
      if (relative) saved[key] = d.update ? { path: relative, updated: true } : relative; // vaihdettu Moodlessa
    }
  }

  const o = data.settings.obsidian || {};
  const markdown = contentsMarkdown(course, content, saved, moodleBase(data.settings), Date.now(), bookmarks,
    { embedVideos: Boolean(o.enabled && o.embedVideos), savedTexts });
  const hash = simpleHash(data.settings.storage + markdown.replace(/^updated: .*$/m, ""));
  const meta = data.contentsMeta[metaKey] || {};
  if (meta.hash === hash && meta.courseFile === COURSE_FILE && !force) return;

  if (isFolderMode(data.settings)) {
    await writeCoursePage(folder, dir, markdown);
    data.contentsMeta[metaKey] = { hash, time: Date.now(), courseFile: COURSE_FILE };
  } else {
    const url = "data:text/markdown;charset=utf-8," + encodeURIComponent(markdown);
    // Chrome säilyttää vanhan samannimisen tiedoston nimiristiriidan yhteydessä.
    // Lopullinen nimi muistetaan seuraavia päivityksiä varten.
    const target = meta.courseFile === COURSE_FILE && meta.path ? meta.path : `${dir}/${COURSE_FILE}`;
    const id = await downloadOwn(url, target, meta.courseFile === COURSE_FILE ? "overwrite" : "uniquify");
    const item = await completedDownload(id);
    const actual = relativeToCourse(item.filename, dir);
    if (!actual) throw new Error("Kurssisivun tallennuspolkua ei voitu vahvistaa.");
    if (meta.downloadId) chrome.downloads.erase({ id: meta.downloadId }).catch(() => {});
    data.contentsMeta[metaKey] = { hash, downloadId: id, time: Date.now(), courseFile: COURSE_FILE, path: `${dir}/${actual}` };
  }
  await save({ contentsMeta: data.contentsMeta });
}

// ---------- Omat linkit ----------
// Käyttäjä tallentaa avoimen nettisivun kurssille ponnahdusikkunasta (popup.js): osoite, otsikko ja huomautus.
// Halutessaan myös sivun teksti Markdownina (clip.js poimii sen) kurssin kansioon "Omat tallennukset".
// Linkit näkyvät kurssin sivulla ja Kurssin tiedot.md:ssä kohdassa "Omat linkit".

const CLIP_DIR = "Omat tallennukset";

function clipDocument(bookmark, course, clip) {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let host = "";
  try { host = new URL(bookmark.url).hostname.replace(/^www\./, ""); } catch (e) { /* ei osoite */ }
  const title = bookmark.title || clip.title || host || "Tallennettu sivu";
  // created = päivämäärä (sama nimi kuin Obsidian Web Clipperissä, Obsidianin päivämäärätyyppi), time = kellonaika
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const lines = ["---", `source: ${bookmark.url}`, `title: ${JSON.stringify(title)}`, `created: ${iso}`, `time: ${JSON.stringify(time)}`, `course: ${JSON.stringify(course.name)}`];
  if (clip.selection) lines.push("selection: true");
  lines.push("---", "", `# ${title.replace(/\s+/g, " ")}`, "",
    `Lähde: [${host || "sivu"}](${bookmark.url.replace(/[\s()<>]/g, ch => encodeURIComponent(ch))}) · tallennettu ${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}${clip.selection ? " · valittu osa sivusta" : ""}`,
    "", "---", "");
  // Sivun oma pääotsikko pois, jos se on sama kuin yllä
  const body = String(clip.markdown).trim().split("\n");
  if (/^#\s/.test(body[0] || "") && body[0].replace(/^#\s+/, "").trim() === title.replace(/\s+/g, " ").trim()) body.shift();
  lines.push(body.join("\n").trim(), "");
  return lines.join("\n");
}

// Odottaa Chromen lopullista tiedostonimeä: nimiristiriita voi lisätä nimeen numeron.
// Oma kuuntelija ei käytä taustaskriptin lukkoa, jonka sisällä saveClip suoritetaan.
function completedDownload(id) {
  return new Promise((resolve, reject) => {
    const finish = (error, item) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error); else resolve(item);
    };
    const check = async () => {
      try {
        const [item] = await chrome.downloads.search({ id });
        if (!item) finish(new Error("Tiedoston latausta ei löytynyt."));
        else if (item.state === "interrupted") finish(new Error("Tiedoston lataus keskeytyi."));
        else if (item.state === "complete") finish(null, item);
      } catch (error) { finish(error); }
    };
    const onChanged = delta => { if (delta.id === id) check(); };
    const timer = setTimeout(() => finish(new Error("Tiedoston lataus ei valmistunut ajoissa. Yritä uudelleen.")), 30000);
    chrome.downloads.onChanged.addListener(onChanged);
    check(); // lataus on voinut valmistua ennen kuuntelijan lisäämistä
  });
}

// Kirjoittaa tekstin kurssin kansioon. Sama linkki uudelleen: sama tiedosto päivitetään.
// Kirjoittaa Markdown-tiedoston kurssin kansioon. Palauttaa polun kurssin kansiosta lukien.
//   overwrite = korvataan olemassa oleva tiedosto (muuten vapaa nimi: "Nimi (2).md")
async function writeCourseText(data, course, relative, body, overwrite) {
  const dir = courseFolder(data.settings, course);
  if (isFolderMode(data.settings)) {
    let path = `${dir}/${relative}`;
    try {
      if (!overwrite) path = await folder.uniquePath(path);
      await folder.writeFile(path, body);
    } catch (error) {
      throw new Error("Kurssikaveri tarvitsee luvan opintokansioon (Asetukset › Tallennus).");
    }
    return path.slice(dir.length + 1);
  }
  const id = await downloadOwn("data:text/markdown;charset=utf-8," + encodeURIComponent(body), `${dir}/${relative}`, overwrite ? "overwrite" : "uniquify");
  const item = await completedDownload(id);
  const actualPath = relativeToCourse(item.filename, dir);
  if (!actualPath) throw new Error("Tallennettu teksti ei ole kurssin kansiossa.");
  return actualPath;
}

async function saveClip(data, course, bookmark, clip) {
  const name = shorten(bookmark.title || clip.title || "Tallennettu sivu", 80) || "Tallennettu sivu";
  // Vanhoissa tiedoissa kaksi linkkiä voi viitata samaan polkuun. Älä korvaa toisen tekstiä.
  const sharedPath = bookmark.clipPath && data.bookmarks.some(b => b.id !== bookmark.id
    && b.courseId === bookmark.courseId && b.clipPath === bookmark.clipPath);
  const existingPath = sharedPath ? null : bookmark.clipPath;
  const relative = existingPath || `${CLIP_DIR}/${name}.md`;
  const body = clipDocument(bookmark, course, clip);
  try {
    bookmark.clipPath = await writeCourseText(data, course, relative, body, Boolean(existingPath));
  } catch (error) {
    return { error: isFolderMode(data.settings)
      ? `Linkki tallennettiin, mutta tekstiä ei voitu kirjoittaa: ${error.message}`
      : `Linkki tallennettiin, mutta tekstin tallennusta ei voitu vahvistaa: ${error.message}` };
  }
  bookmark.clipped = Date.now();
  bookmark.clipSelection = Boolean(clip.selection);
  return { path: bookmark.clipPath, selection: bookmark.clipSelection };
}

async function addBookmark({ url, title, courseId, note, clip }) {
  const data = await loadAll();
  const course = data.courses.find(c => c.id === courseId);
  if (!course) throw new Error("Valitse kurssi.");
  const address = String(url || "").trim().slice(0, 2000);
  if (!/^https?:\/\//i.test(address)) throw new Error("Tätä sivua ei voi tallentaa linkkinä.");
  const fields = { title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 200), note: String(note || "").replace(/\s+/g, " ").trim().slice(0, 300) };

  // Sama sivu samalla kurssilla: päivitetään otsikko ja huomautus
  const existing = data.bookmarks.find(b => b.courseId === courseId && b.url === address);
  const before = existing ? { title: existing.title, note: existing.note } : null;
  let bookmark = existing;
  if (existing) Object.assign(existing, fields);
  else { bookmark = { id: newId("b"), url: address, courseId, created: Date.now(), ...fields }; data.bookmarks.push(bookmark); }

  const clipResult = clip && typeof clip.markdown === "string" && clip.markdown.trim()
    ? await saveClip(data, course, bookmark, { ...clip, markdown: clip.markdown.slice(0, 500000) })
    : null;

  await save({ bookmarks: data.bookmarks, viewPrefs: { ...data.viewPrefs, bookmarkCourse: courseId } });
  scheduleCourseContents(course);
  const undoToken = await rememberBookmarkUndo(before, bookmark);
  return { id: bookmark.id, updated: Boolean(existing), course: course.name, clip: clipResult, undoToken };
}

// Kumotaan linkin tiedot, ei tiedostoja. Rinnakkainen muutos estää kumoamisen.
async function rememberBookmarkUndo(before, bookmark) {
  try {
    const { popupBookmarkUndo = [] } = await chrome.storage.session.get("popupBookmarkUndo");
    const token = newId("undo-");
    const records = popupBookmarkUndo.filter(item => item.expires > Date.now()).slice(-9);
    records.push({ token, before, after: structuredClone(bookmark), expires: Date.now() + 10 * 60 * 1000 });
    await chrome.storage.session.set({ popupBookmarkUndo: records });
    return token;
  } catch { return null; }
}

async function undoBookmark({ token }) {
  const { popupBookmarkUndo = [] } = await chrome.storage.session.get("popupBookmarkUndo");
  const record = popupBookmarkUndo.find(item => item.token === token && item.expires > Date.now());
  if (!record) throw new Error("Kumoamisaika päättyi. Linkkiä voi muokata kurssin sivulla.");
  const data = await loadAll();
  const current = data.bookmarks.find(item => item.id === record.after.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(record.after)) throw new Error("Linkki muuttui toisessa näkymässä. Sitä ei kumottu.");
  if (record.before) Object.assign(current, record.before);
  else data.bookmarks = data.bookmarks.filter(item => item.id !== current.id);
  await save({ bookmarks: data.bookmarks });
  await chrome.storage.session.set({ popupBookmarkUndo: popupBookmarkUndo.filter(item => item.token !== token) });
  const course = data.courses.find(item => item.id === current.courseId);
  if (course) scheduleCourseContents(course);
  return { bookmark: record.before ? current : null };
}

async function removeBookmark({ id }) {
  const data = await loadAll();
  const bookmark = data.bookmarks.find(b => b.id === id);
  if (!bookmark) return;
  await save({ bookmarks: data.bookmarks.filter(b => b.id !== id) });
  const course = data.courses.find(c => c.id === bookmark.courseId);
  if (course) scheduleCourseContents(course);
}

// ---------- Valitun tekstin tallennus (hiiren oikea painike) ----------
// Käyttäjä maalaa tekstiä millä tahansa sivulla → oikea painike → "Tallenna valittu teksti Kurssikaveriin".
// Valinta poimitaan clip.js:llä (muotoilu säilyy) tai, jos se ei onnistu (esim. PDF), Chromen antamana pelkkänä tekstinä.
// Valinta odottaa istuntomuistissa (pendingSelection), ja selection.html kysyy kurssin ja huomautuksen.
// Jokainen valinta on oma tiedostonsa kansiossa "Omat tallennukset" ja oma rivinsä listassa savedTexts
// (näkyy Kurssin tiedot.md:n tekstilinkeissä ja kurssin sivun Omissa tallennuksissa). Sivu lisätään kurssin omiin linkkeihin
// vain, jos käyttäjä valitsee sen (addLink).

const SELECTION_MENU = "kurssikaveri-selection";
const pad2 = n => String(n).padStart(2, "0");

function createSelectionMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SELECTION_MENU,
      title: "Tallenna valittu teksti Kurssikaveriin",
      contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_MENU) return;
  openSelectionWindow(info, tab).catch(console.error);
});

async function openSelectionWindow(info, tab) {
  const url = info.frameUrl || info.pageUrl || (tab && tab.url) || "";
  let markdown = "";
  let title = "";
  if (tab && tab.id >= 0) {
    try {
      const target = { tabId: tab.id, frameIds: [info.frameId || 0] };
      // Ponnahdusikkunan koko sivun merkki pois, jos se on jäänyt sivulle: nyt halutaan maalattu osa
      await chrome.scripting.executeScript({ target, func: () => { delete window.__kurssikaveriWholePage; } });
      const [frame] = await chrome.scripting.executeScript({ target, files: ["clip.js"] });
      const result = frame && frame.result;
      if (result && !result.error && result.selection && result.markdown) markdown = result.markdown;
      if (result && result.title) title = result.title;
    } catch (error) { /* sivulle ei voi ajaa skriptiä: käytetään pelkkää tekstiä */ }
  }
  if (!markdown) markdown = String(info.selectionText || "");
  await chrome.storage.session.set({ pendingSelection: {
    url, title: cleanPageTitle(title || (tab && tab.title) || "", url),
    markdown: markdown.slice(0, 500000), text: String(info.selectionText || '').slice(0, 500000), time: Date.now()
  } });
  await chrome.windows.create({ url: chrome.runtime.getURL("selection.html"), type: "popup", width: 420, height: 620 });
}

function selectionDocument(selection, course, saved) {
  let host = "";
  try { host = new URL(selection.url).hostname.replace(/^www\./, ""); } catch (e) { /* ei osoite */ }
  const title = String(selection.title || host || "Tallennettu teksti").replace(/\s+/g, " ");
  const date = `${saved.getFullYear()}-${pad2(saved.getMonth() + 1)}-${pad2(saved.getDate())}`;
  const clock = `${pad2(saved.getHours())}:${pad2(saved.getMinutes())}`;
  const lines = ["---", `source: ${selection.url}`, `title: ${JSON.stringify(title)}`, `created: ${date}`, `time: ${JSON.stringify(clock)}`,
    `course: ${JSON.stringify(course.name)}`];
  if (selection.note) lines.push(`note: ${JSON.stringify(selection.note)}`);
  if (selection.tags.length) lines.push("tags:", ...selection.tags.map(tag => `  - ${JSON.stringify(tag)}`)); // Obsidianin tagit
  lines.push("selection: true", "---", "", `# ${title}`, "",
    `Lähde: [${host || "sivu"}](${selection.url.replace(/[\s()<>]/g, ch => ({ "(": "%28", ")": "%29" })[ch] || encodeURIComponent(ch))}) · tallennettu ${saved.getDate()}.${saved.getMonth() + 1}.${saved.getFullYear()} klo ${saved.getHours()}.${pad2(saved.getMinutes())} · valittu teksti`);
  lines.push("", "---", "", String(selection.markdown).trim(), "");
  return lines.join("\n");
}

async function saveSelection({ url, title, markdown, courseId, note, tags, addLink }) {
  const data = await loadAll();
  const course = data.courses.find(c => c.id === courseId);
  if (!course) throw new Error("Valitse kurssi.");
  const address = String(url || "").trim().slice(0, 2000);
  if (!/^https?:\/\//i.test(address)) throw new Error("Tältä sivulta ei voi tallentaa tekstiä.");
  const text = String(markdown || "").slice(0, 500000);
  if (!text.trim()) throw new Error("Valittua tekstiä ei löytynyt. Maalaa teksti uudelleen ja yritä uudestaan.");
  const selection = {
    url: address, markdown: text,
    title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 200),
    note: String(note || "").replace(/\s+/g, " ").trim().slice(0, 300),
    tags: parseTags(Array.isArray(tags) ? tags.join(",") : tags)
  };

  const saved = new Date();
  const stamp = `${saved.getFullYear()}-${pad2(saved.getMonth() + 1)}-${pad2(saved.getDate())} ${pad2(saved.getHours())}${pad2(saved.getMinutes())}`;
  const name = shorten(selection.title || "Tallennettu teksti", 60) || "Tallennettu teksti";
  const path = await writeCourseText(data, course, `${CLIP_DIR}/${name} - valinta ${stamp}.md`, selectionDocument(selection, course, saved), false);

  data.savedTexts.push({ id: newId("t"), courseId, url: address, title: selection.title, path, saved: saved.getTime(), note: selection.note, tags: selection.tags });
  const changes = { savedTexts: data.savedTexts, viewPrefs: { ...data.viewPrefs, bookmarkCourse: courseId } };

  // Sivu kurssin omiin linkkeihin vain, jos käyttäjä valitsi sen (olemassa olevaa linkkiä ei muuteta)
  let linked = false;
  const alreadyLinked = data.bookmarks.some(b => b.courseId === courseId && b.url === address);
  if (addLink && !alreadyLinked) {
    data.bookmarks.push({ id: newId("b"), url: address, courseId, created: saved.getTime(), title: selection.title, note: "" });
    changes.bookmarks = data.bookmarks;
    linked = true;
  }

  await save(changes);
  scheduleCourseContents(course);
  return { course: course.name, path, linked, alreadyLinked, title: selection.title, note: selection.note, tags: selection.tags };
}

// Poistaa tallennetun tekstin kurssin listalta. Tiedosto jää kansioon.
async function removeSavedText({ id }) {
  const data = await loadAll();
  const text = data.savedTexts.find(t => t.id === id);
  if (!text) return;
  await save({ savedTexts: data.savedTexts.filter(t => t.id !== id) });
  const course = data.courses.find(c => c.id === text.courseId);
  if (course) scheduleCourseContents(course);
}

// Versio e962f7c tallensi valinnat linkin kenttään selections ja lisäsi sivun aina linkkeihin.
// Valinnat siirretään omaan listaansa. Linkki poistetaan, jos se syntyi vain valinnan takia
// (ei huomautusta eikä sivun tekstiä, ja luotu samalla hetkellä kuin ensimmäinen valinta).
async function migrateSelections() {
  const data = await loadAll();
  const old = data.bookmarks.filter(b => Array.isArray(b.selections));
  if (old.length === 0) return;
  const removed = new Set();
  for (const b of old) {
    for (const s of b.selections) {
      data.savedTexts.push({ id: newId("t"), courseId: b.courseId, url: b.url, title: b.title || "", path: s.path, saved: s.saved, note: s.note || "" });
    }
    const first = Math.min(...b.selections.map(s => s.saved));
    if (!b.note && !b.clipPath && b.created === first) removed.add(b.id);
    delete b.selections;
  }
  await save({ savedTexts: data.savedTexts, bookmarks: data.bookmarks.filter(b => !removed.has(b.id)) });
  for (const courseId of new Set(old.map(b => b.courseId))) {
    const course = data.courses.find(c => c.id === courseId);
    if (course) scheduleCourseContents(course);
  }
}

// ---------- Opinnot.md ----------

let indexTimer = null;
function scheduleIndex() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => withLock(writeIndex).catch(console.error), 2500);
}

async function writeIndex() {
  const data = await loadAll();
  if (!data.settings.onboarded || data.courses.length === 0) return;
  const markdown = overviewMarkdown(data, await existsMap(data.downloads));
  const hash = simpleHash(data.settings.storage + markdown.replace(/^updated: .*$/m, ""));
  const meta = data.contentsMeta._index || {};
  if (meta.hash === hash) return;
  const path = indexPath(data.settings);
  if (isFolderMode(data.settings)) {
    try { await folder.writeFile(path, markdown); } catch (error) { return; }
    data.contentsMeta._index = { hash, time: Date.now() };
  } else {
    const id = await downloadOwn("data:text/markdown;charset=utf-8," + encodeURIComponent(markdown), path, "overwrite");
    if (meta.downloadId) chrome.downloads.erase({ id: meta.downloadId }).catch(() => {});
    data.contentsMeta._index = { hash, downloadId: id, time: Date.now() };
  }
  await save({ contentsMeta: data.contentsMeta });
}

// ---------- .kurssikaveri/tiedot.json ----------
// Kurssit, omat merkinnät, värimaailmat ja tieto tallennetuista tiedostoista kirjoitetaan opintokansioon, jotta
// ne voidaan palauttaa, jos lisäosa asennetaan uudelleen (aloitusopas tarjoaa palautusta). Vain oman kansion tilassa.
// Jos kansioon ei ole lupaa, kirjoitus jää väliin ja yritetään uudelleen seuraavan muutoksen yhteydessä.

let backupTimer = null;
function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => withLock(writeBackup).catch(console.error), 3000);
}

async function writeBackup() {
  const data = await loadAll();
  const { settings } = data;
  if (!settings.onboarded || !isFolderMode(settings)) return;
  if ((await folder.permissionState()) !== "granted") return;

  let owner = settings.backupId;
  if (!owner) {
    owner = newId("kk-");
    await save({ settings: { ...settings, backupId: owner } });
  }
  const object = backupObject(data, owner);
  const fingerprint = backupFingerprint(object);
  const hash = `${simpleHash(fingerprint)}-${fingerprint.length}`;
  const meta = data.contentsMeta._backup || {};
  const sameFolder = meta.folder === settings.folderName;
  if (sameFolder && meta.hash === hash) return;

  try {
    // Ensimmäinen kirjoitus tähän kansioon: jos siellä on toisen asennuksen tiedot, ne jätetään talteen toisella nimellä
    if (!sameFolder) {
      const text = await folder.readText(BACKUP_PATH);
      const earlier = text ? parseBackup(text) : null;
      if (text && (!earlier || earlier.owner !== owner)) await folder.writeFile(BACKUP_OLD_PATH, text);
    }
    await folder.writeFile(BACKUP_PATH, JSON.stringify(object, null, 2));
  } catch (error) {
    return;
  }
  const { contentsMeta } = await loadAll();
  contentsMeta._backup = { hash, folder: settings.folderName, time: Date.now() };
  await save({ contentsMeta });
}

// ---------- Kurssien värit ----------
// Jokaisella kurssilla on tallennettu väri. Jos jokin sivu tallentaa kurssin ilman väriä (esim. käsin lisätty
// kurssi tai vanha tallennus), väri lisätään tässä.
async function ensureCourseColors() {
  const { courses } = await loadAll();
  if (ensureColors(courses)) await save({ courses });
}

// Kurssit, määräajat ja tallennukset muuttuvat → yhteenveto päivitetään (sama sisältö = ei kirjoiteta)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.courses && (changes.courses.newValue || []).some(c => !c.color)) withLock(ensureCourseColors).catch(console.error);
  if (changes.courses || changes.deadlines || changes.courseContent || changes.downloads || changes.settings) scheduleIndex();
  if (changes.contentsMeta && Object.entries(changes.contentsMeta.newValue || {}).some(([key, meta]) =>
    meta.path !== changes.contentsMeta.oldValue?.[key]?.path)) scheduleIndex();
  if (changes.courses || changes.moodleMap || changes.ownEntries || changes.bookmarks || changes.savedTexts || changes.downloads || changes.settings
    || changes.calendarPrefs || changes.viewPrefs) scheduleBackup();
  // Perustietojen, tilan tai asetusten muutos päivittää myös kurssisivut.
  if (changes.courses || changes.settings) {
    loadAll().then(data => {
      if (data.settings.onboarded) for (const course of data.courses) scheduleCourseContents(course);
    }).catch(console.error);
  }
});

// ---------- 5. Moodlesta haettavat tiedot ----------
// Määräajat haetaan, kun Moodle-sivu, ponnahdusikkuna tai Tänään-sivu avataan ja edellisestä
// hausta on yli maxAge. Kurssien päivämäärät päivitetään kerran vuorokaudessa.

const DEADLINE_MAX_AGE = 30 * 60 * 1000;
const COURSES_MAX_AGE = 24 * 60 * 60 * 1000;
let moodleRefresh = null;
let forcedRefresh = null;

function refreshMoodle({ maxAge = DEADLINE_MAX_AGE, force = false } = {}) {
  if (forcedRefresh) return forcedRefresh;
  if (force) {
    // Painikkeen pyytämä täysi tarkistus tehdään myös silloin, kun tavallinen haku on jo käynnissä.
    const start = () => doRefreshMoodle(0);
    forcedRefresh = (moodleRefresh ? moodleRefresh.then(start, start) : start())
      .finally(() => { forcedRefresh = null; });
    return forcedRefresh;
  }
  if (!moodleRefresh) {
    moodleRefresh = doRefreshMoodle(maxAge).finally(() => { moodleRefresh = null; });
  }
  return moodleRefresh;
}

async function doRefreshMoodle(maxAge) {
  const data = await loadAll();
  if (!data.settings.onboarded) return { skipped: true };
  const base = moodleBase(data.settings);
  const now = Date.now();
  const result = { deadlines: false, courses: false, error: "" };

  if (now - (data.deadlines.fetched || 0) >= maxAge) {
    try {
      const items = await withSubmissions(base, await fetchDeadlines(base), data.deadlines.items || []);
      let calendarChecked = data.deadlines.calendarChecked || 0;
      if (maxAge === 0 || now - calendarChecked >= DAY_MS) {
        try {
          await addCalendarSubmissions(base, items, now);
          calendarChecked = now;
        } catch (error) {
          result.error = `Palautettujen tehtävien tarkistus jäi kesken. ${error.message}`;
        }
      }
      await withLock(async () => {
        const fresh = await loadAll();
        await save({ deadlines: { fetched: Date.now(), items, calendarChecked, error: result.error } });
        for (const course of fresh.courses) if (course.moodleId) scheduleContents(course.moodleId);
      });
      result.deadlines = true;
    } catch (error) {
      result.error = error.message;
      await withLock(async () => {
        const fresh = await loadAll();
        await save({ deadlines: { ...fresh.deadlines, error: error.code === "login" ? "login" : error.message } });
      });
      if (error.code === "login") return result;
    }
  }

  // Kurssit haetaan uudelleen vuorokauden välein – tai heti, jos menneet-tietoa ei ole vielä haettu (päivitys vanhasta versiosta)
  const pastUnknown = data.courses.some(c => c.moodleId && c.moodlePast === undefined);
  const discoveryMissing = data.courseDiscovery?.base !== base;
  if (maxAge === 0 || discoveryMissing || pastUnknown || now - (data.sync.courses || 0) >= COURSES_MAX_AGE) {
    try {
      const moodleCourses = await fetchMoodleCourses(base);
      // Menneet-tieto on lisä: jos haku epäonnistuu, aiempi tieto jää voimaan
      const pastIds = data.courses.some(c => c.moodleId) ? await fetchMoodlePastIds(base).catch(() => null) : null;
      await withLock(async () => {
        const fresh = await loadAll();
        if (moodleBase(fresh.settings) !== base) return;
        for (const course of fresh.courses) {
          const m = moodleCourses.find(x => x.id === course.moodleId);
          if (m) { course.start = m.startdate || 0; course.end = m.enddate || 0; }
          if (m && pastIds) course.moodlePast = pastIds.has(m.id); // Moodlessa menneissä
        }
        await save({
          courses: fresh.courses, sync: { ...fresh.sync, courses: Date.now() },
          courseDiscovery: { base, courses: moodleCourses.map(({ id, fullname }) => ({ id, fullname })) }
        });
      });
      result.courses = true;
    } catch (error) {
      result.error = error.message;
    }
  }
  return result;
}

// Kun käyttäjä on antanut luvan opintokansioon (sivulla), tehdään odottaneet kirjoitukset
async function processPending() {
  const data = await loadAll();
  const state = await folder.permissionState();
  if (state !== "granted") return { done: 0, waiting: data.pending.length, state };
  let done = 0;
  let failed = 0;
  for (const job of data.pending) {
    const entry = data.downloads[job.id];
    if (!entry) continue;
    try {
      await storeInFolder(entry, await fetchFile(entry.url), data);
      if (job.type === "transfer") await removeDownload(entry.downloadId);
      entry.downloadId = null;
      delete entry.transfer;
      done++;
    } catch (error) {
      failed++;
      if (job.type === "transfer") {
        // Chromen lataama tiedosto on yhä latauskansion välikansiossa (näkyy kohdassa "Jäi latauskansioon")
        entry.state = "complete";
        entry.stored = "downloads";
        entry.path = incomingPath(entry.originalName);
        entry.note = `Jäi latauskansioon (${error.message})`;
        delete entry.transfer;
      } else {
        // Tiedostoa ei ole levyllä: tila "failed" ei näy tallennettuna, ja Moodlen Tallenna-painike palaa näkyviin
        entry.state = "failed";
        entry.note = `Tallennus epäonnistui: ${error.message}`;
      }
    }
  }
  data.pending = [];
  await save({ downloads: data.downloads, pending: [] });
  for (const course of data.courses) await writeCourseFiles(data.settings, course, { deferOnFolderError: true });
  for (const course of data.courses) if (course.moodleId) scheduleContents(course.moodleId);
  scheduleIndex();
  scheduleBackup(); // lupa on nyt voimassa
  return { done, failed, waiting: 0, state };
}

// ---------- 8. Päivitetyt tiedostot ----------
// Kun kurssisivu avataan, tallennetuista tiedostoista kysytään Moodlelta pelkät tunnistetiedot (HEAD-pyyntö, ei
// latausta), enintään 4 tunnin välein. Jos tunniste on muuttunut, tallennus merkitään päivitetyksi (entry.update),
// ja Moodle-palkki, kurssisivu ja Kurssin tiedot.md tarjoavat uutta versiota. Uusi versio tallennetaan vain käyttäjän
// pyynnöstä (saveUpdate). Tiedostolle, jolta tunnistetta ei vielä ole (tallennettu ennen tätä), ensimmäinen
// tarkistus vain kirjaa sen ylös.

const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
const updateChecking = new Set();

function scheduleUpdateCheck(moodleId) {
  if (updateChecking.has(moodleId)) return;
  setTimeout(() => checkUpdates(moodleId).catch(console.error), 3000);
}

// Ajaa tehtävät rinnakkain, enintään limit kerrallaan (Moodlea ei kuormiteta)
async function inParallel(list, limit, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) await task(list[next++]);
  }));
}

// Tiedoston nykyiset tunnistetiedot Moodlelta: { remote, url } tai null, jos niitä ei saatu.
// Tiedostomateriaali kysytään materiaalin sivulta, joka ohjaa nykyiseen tiedostoon (tiedoston nimi voi vaihtua).
// Kansion tiedosto ja muut kysytään tiedoston omasta osoitteesta.
async function currentRemote(base, entry) {
  const isResource = entry.cmid && !entry.folder && entry.fileKey === fileKey(entry.cmid);
  const url = isResource ? `${base}/mod/resource/view.php?id=${entry.cmid}&redirect=1` : entry.url;
  if (!url) return null;
  const response = await moodleFetch(url, { method: "HEAD", cache: "no-store" }); // selaimen välimuisti ohitetaan
  if (/\/login\//.test(response.url)) throw new Error(LOGIN_ERROR);
  if (!response.ok || !/pluginfile\.php/.test(response.url)) return null;
  const remote = remoteInfo(response.headers);
  if (!remote) return null;
  const target = new URL(response.url);
  target.searchParams.set("forcedownload", "1");
  return { remote, url: target.href };
}

async function checkUpdates(moodleId, force = false) {
  moodleId = Number(moodleId);
  if (updateChecking.has(moodleId)) return { busy: true };
  updateChecking.add(moodleId);
  try {
    const data = await loadAll();
    const last = (data.sync.updates || {})[moodleId] || 0;
    if (!force && Date.now() - last < UPDATE_CHECK_MS) return { skipped: true };
    if (!mappedCourse(data, moodleId)) return { skipped: true };
    const base = moodleBase(data.settings);
    const exists = await existsMap(data.downloads);
    const entries = Object.values(savedEntries(data, moodleId, exists)).filter(d => d.url || d.cmid);

    const found = {};
    let stopped = ""; // kirjautuminen vanhentui tai yhteys katkesi: lopetetaan, yritetään seuraavalla kerralla
    await inParallel(entries, 3, async entry => {
      if (stopped) return;
      try {
        const now = await currentRemote(base, entry);
        if (now) found[entry.id] = now;
      } catch (error) {
        stopped = error.message;
      }
    });

    let updated = 0;
    await withLock(async () => {
      const fresh = await loadAll();
      for (const [id, now] of Object.entries(found)) {
        const entry = fresh.downloads[id];
        if (!entry) continue;
        if (!entry.remote) { entry.remote = now.remote; continue; } // ensimmäinen tarkistus: lähtötilanne
        if (remoteChanged(entry.remote, now.remote)) {
          entry.update = { found: (entry.update && entry.update.found) || Date.now(), remote: now.remote, url: now.url };
          updated++;
        } else if (entry.update) {
          delete entry.update; // opettaja palautti alkuperäisen
        }
      }
      const changes = { downloads: fresh.downloads };
      if (!stopped) changes.sync = { ...fresh.sync, updates: { ...(fresh.sync.updates || {}), [moodleId]: Date.now() } };
      await save(changes);
    });
    scheduleContents(moodleId);
    return { checked: Object.keys(found).length, total: entries.length, updated, error: stopped };
  } finally {
    updateChecking.delete(moodleId);
  }
}

// "Luento 3.pdf" → "Luento 3 (vanha 3.11.2026).pdf"
function oldVersionPath(path, ms) {
  const d = new Date(ms);
  const label = `vanha ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1 ? `${path.slice(0, dot)} (${label})${path.slice(dot)}` : `${path} (${label})`;
}

// Tallentaa päivitetyn tiedoston uuden version. Oman kansion tilassa vanha versio nimetään uudelleen samaan kansioon
// ("Nimi (vanha 3.11.2026).pdf") ja uusi saa alkuperäisen nimen. Latauskansiossa vanhaa ei voi nimetä uudelleen,
// joten uusi saa Chromen antaman nimen ("Nimi (1).pdf"). Vanha versio jää kurssin "Muut tallennetut tiedostot" -listaan.
async function saveUpdate({ id }) {
  const data = await loadAll();
  const entry = data.downloads[id];
  if (!entry || !entry.update) return { none: true };
  const update = entry.update;
  const key = entry.fileKey;

  if (entry.stored === "folder" && entry.state === "complete" && entry.path) {
    const modified = Date.parse((entry.remote && entry.remote.modified) || "") || entry.time;
    const oldPath = await folder.uniquePath(oldVersionPath(entry.path, modified));
    await folder.moveFile(entry.path, oldPath);
    entry.path = oldPath;
    entry.fullPath = oldPath;
  }
  entry.fileKey = null;
  entry.oldVersion = true;
  delete entry.update;
  await save({ downloads: data.downloads });

  try {
    return await saveFile({
      moodleId: entry.moodleId, cmid: entry.cmid, fileKey: key, name: entry.fileName, keepName: true,
      folder: entry.folder || null, subpath: entry.subpath || "", section: entry.section, sectionOrder: entry.sectionOrder,
      url: update.url || entry.url
    });
  } catch (error) {
    // Uutta versiota ei saatu: vanha pysyy kurssin tiedostona (uudella nimellään), ja päivitys tarjotaan uudelleen
    const fresh = await loadAll();
    const old = fresh.downloads[id];
    if (old) { old.fileKey = key; old.update = update; delete old.oldVersion; await save({ downloads: fresh.downloads }); }
    throw error;
  }
}

// ---------- 9. Palautetut tehtävät ----------
// Palautustehtävän tila luetaan tehtävän omalta sivulta. Moodle merkitsee tilasolun luokalla submissionstatus<tila>:
// submitted = lähetetty arvioitavaksi, draft = luonnos (ei lähetetty), new = ei palautusta. Luokka on sama kaikilla
// kielillä. (Sivun "Tehty"-merkintään ei voi luottaa: opiskelija voi merkitä tehtävän tehdyksi itse.)

const DAY_MS = 86400 * 1000;
const MAX_STATUS_CHECKS = 25;

async function assignmentStatus(base, cmid) {
  const response = await moodleFetch(`${base}/mod/assign/view.php?id=${cmid}`, { cache: "no-store" });
  if (/\/login\//.test(response.url)) throw new Error(LOGIN_ERROR);
  if (!response.ok) return null;
  const html = await response.text();
  for (const cell of html.matchAll(/<(?:td|div|span)\b[^>]*?\sclass\s*=\s*["']([^"']*)["']/gi)) {
    const match = cell[1].match(/(?:^|\s)submissionstatus(submitted|draft|new|reopened)(?:\s|$)/);
    if (match) return match[1];
  }
  return null;
}

async function addCalendarSubmissions(base, items, now) {
  const candidates = await calendarAssignments(base, now - 60 * DAY_MS, now + 30 * DAY_MS);
  const known = new Set(items.map(d => d.id));
  const missing = candidates.filter(d => !known.has(d.id));
  let failure;
  await inParallel(missing, 3, async d => {
    if (failure) return;
    try {
      if (await assignmentStatus(base, d.cmid) === "submitted") {
        items.push({ ...d, submitted: true, overdue: false });
      }
    } catch (error) { failure = error; }
  });
  items.sort((a, b) => a.time - b.time);
  if (failure) throw failure;
}

// Lisää määräaikoihin tiedon palautuksesta (submitted: true). Palautettu tehtävä, joka on kadonnut Moodlen
// Aikajanalta, pidetään listalla 60 päivää, jotta se näkyy kalenterissa yliviivattuna.
//   previous = edellisellä kerralla tallennetut määräajat
async function withSubmissions(base, items, previous) {
  const now = Date.now();
  const listed = new Set(items.map(i => i.id));
  const before = new Map(previous.map(p => [p.id, p]));
  const isAssign = d => d.module === "assign" && d.cmid && isMoodleDeadline(d);
  const missing = previous.filter(p => isAssign(p) && !listed.has(p.id) && p.time >= now - 60 * DAY_MS);

  // Tarkistetaan: Aikajanan palautustehtävät (tulevat ja viikon sisällä menneet) ja Aikajanalta kadonneet,
  // joiden palautusta ei vielä tiedetä (katosiko palautuksen vai poiston takia?)
  const checks = [...items.filter(d => isAssign(d) && d.time >= now - 7 * DAY_MS),
    ...missing.filter(p => !p.submitted && p.time >= now - 7 * DAY_MS)].slice(0, MAX_STATUS_CHECKS);
  const statuses = new Map();
  let stopped = false;
  await inParallel([...new Set(checks.map(d => d.cmid))], 3, async cmid => {
    if (stopped) return;
    try { statuses.set(cmid, await assignmentStatus(base, cmid)); } catch (error) { stopped = true; }
  });

  for (const item of items) {
    if (!isAssign(item)) continue;
    const status = statuses.get(item.cmid);
    if (status) item.submitted = status === "submitted";
    else if (before.has(item.id)) item.submitted = Boolean(before.get(item.id).submitted); // ei tarkistettu nyt
  }
  const kept = missing
    .filter(p => statuses.has(p.cmid) ? statuses.get(p.cmid) === "submitted" : p.submitted)
    .map(p => ({ ...p, submitted: true, overdue: false }));
  return [...items, ...kept].sort((a, b) => a.time - b.time);
}

// ---------- 4. Sivujen pyynnöt ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "createCourseFiles") {
    // Funktio ottaa withLock-lukon itse kurssi kerrallaan. Ei yleisen withLock(handler)-haaran sisään.
    createCourseFiles(message)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === "saveCourseFiles") { // pitkä: verkkohaut lukon ulkopuolella, jokainen tallennus lukon sisällä
    saveCourseFiles(message)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === "checkUpdates") { // verkkohaut lukon ulkopuolella, tallennus lukon sisällä (checkUpdates)
    checkUpdates(message.moodleId, true)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === "refreshMoodle") {
    refreshMoodle(message)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  const handlers = {
    pageContent: () => pageContent(message),
    linkTargets: () => linkTargets(message),
    pageStatus: () => pageStatus(message),
    addCourseFromPage: () => addCourseFromPage(message),
    saveFile: () => saveFile(message),
    saveFromTab: () => saveFromTab(message),
    refreshContents: () => writeContents(message.moodleId, true),
    saveUpdate: () => saveUpdate(message),
    addBookmark: () => addBookmark(message),
    removeBookmark: () => removeBookmark(message),
    undoBookmark: () => undoBookmark(message),
    saveSelection: () => saveSelection(message),
    removeSavedText: () => removeSavedText(message),
    processPending: () => processPending(),
    refile: () => refile(message),
    removeCopy: () => removeCopy(message.id),
    keepBoth: () => updateEntry(message.id, { duplicateOf: null }),
    confirm: () => updateEntry(message.id, { confidence: "high", reason: "Kurssi vahvistettu" }),
    setCourseStatus: () => setCourseStatus(message),
    // Moodle-palkin Avaa Kurssikaverissa avaa kurssin sivun, muuten Tänään-sivu
    openLibrary: () => openPage(message.courseId ? `library.html#course=${encodeURIComponent(message.courseId)}` : "library.html#home")
  };
  const handler = handlers[message.action];
  if (!handler) return false;
  withLock(handler)
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

// Järjestää tiedoston kurssille. Omassa kansiossa siirto, latauskansiossa uudelleenlataus.
async function refile({ id, courseId, type, fileName, remember }) {
  const data = await loadAll();
  const entry = data.downloads[id];
  const course = data.courses.find(c => c.id === courseId);
  if (!entry) throw new Error("Tiedostoa ei löytynyt.");
  if (!course) throw new Error("Valitse kurssi.");
  if (!TYPES[type]) throw new Error("Valitse tyyppi.");
  const cleaned = cleanName(fileName);
  if (!cleaned) throw new Error("Anna tiedostolle nimi.");

  if (remember && entry.moodleId) {
    data.moodleMap[entry.moodleId] = course.id;
    const linked = data.courses.find(c => c.id === course.id);
    if (!linked.moodleId) linked.moodleId = entry.moodleId;
  }

  // Välilehti säilyy vain, jos kurssi on sama, jolta tiedosto ladattiin
  const sameCourse = data.moodleMap[entry.moodleId] === course.id;
  const where = {
    type, fileName: cleaned,
    section: sameCourse ? entry.section : null, sectionOrder: sameCourse ? entry.sectionOrder : null,
    folder: sameCourse ? entry.folder : null, subpath: sameCourse ? entry.subpath : ""
  };
  const target = materialPath(data.settings, course, where);
  const changes = { status: "filed", courseId: course.id, type, fileName: cleaned, confidence: "high",
    reason: "Kurssi valittu käsin", duplicateOf: null, section: where.section, sectionOrder: where.sectionOrder };

  if (entry.stored === "folder") {
    const finalPath = await folder.uniquePath(target);
    await folder.moveFile(entry.path, finalPath);
    Object.assign(entry, changes, { path: finalPath, fullPath: finalPath, targetPath: target });
    await save({ downloads: data.downloads, moodleMap: data.moodleMap, courses: data.courses });
    if (entry.moodleId) scheduleContents(entry.moodleId);
    return entry.id;
  }

  const downloadId = await downloadOwn(entry.url, target);
  const newEntry = { ...entry, ...changes, id: String(downloadId), downloadId, path: target, targetPath: target,
    state: "in_progress", fullPath: "", time: Date.now(), replaces: entry.id };
  data.downloads[newEntry.id] = newEntry;
  entry.movingTo = newEntry.id;
  await save({ downloads: data.downloads, moodleMap: data.moodleMap, courses: data.courses });
  return newEntry.id;
}

// Poistaa uuden kaksoiskappaleen ja sen merkinnän
async function removeCopy(id) {
  const data = await loadAll();
  const entry = data.downloads[id];
  if (!entry) return;
  if (entry.stored === "folder") {
    try { await folder.removeFile(entry.path); } catch (e) { /* jo poistettu */ }
  } else {
    await removeDownload(entry.downloadId);
  }
  delete data.downloads[id];
  await save({ downloads: data.downloads });
}

async function updateEntry(id, changes) {
  const data = await loadAll();
  if (!data.downloads[id]) throw new Error("Tiedostoa ei löytynyt.");
  Object.assign(data.downloads[id], changes);
  await save({ downloads: data.downloads });
}

// Kurssin tila (Tänään-sivun ehdotus "Kurssi päättyi – siirrä päättyneisiin")
async function setCourseStatus({ courseId, status, endHandled }) {
  const data = await loadAll();
  const course = data.courses.find(c => c.id === courseId);
  if (!course) throw new Error("Kurssia ei löytynyt.");
  if (status) course.status = status;
  if (endHandled !== undefined) course.endHandled = endHandled;
  await save({ courses: data.courses });
}

// Kun taustaskripti käynnistyy: värit kursseille, joilla niitä ei vielä ole (päivitys vanhasta versiosta)
withLock(ensureCourseColors).catch(console.error);
// … vanhan muodon tekstivalinnat omaan listaansa
withLock(migrateSelections).catch(console.error);
// … ja vanhat kaksiosaiset kurssisivut yhdistetään, kun kansion lupa on voimassa.
loadAll().then(data => {
  if (data.settings.onboarded) {
    for (const course of data.courses) scheduleCourseContents(course);
    scheduleIndex();
  }
}).catch(console.error);
// … ja tiedot talteen opintokansioon, jos ne eivät ole siellä vielä ajan tasalla
scheduleBackup();

// Ensimmäisellä asennuksella avataan aloitusopas
chrome.runtime.onInstalled.addListener(details => {
  createSelectionMenu(); // valikko säilyy Chromessa, mutta se luodaan uudelleen asennuksessa ja päivityksessä
  if (details.reason === "install") openPage("onboarding.html");
});
