// Aja: node --test tests/course.test.mjs (ei asennettavia riippuvuuksia).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { COURSE_PAGE_PROPERTY, LEGACY_COURSE_PAGE_MARKER, isCoursePage, COURSE_FILE, courseFolder, coursePagePath } from "../shared/rules.js";
import { contentsMarkdown, relativeToCourse } from "../shared/contents.js";
import { overviewMarkdown } from "../shared/overview.js";
import { writeCoursePage } from "../shared/coursefile.js";

const base = "https://moodle5.samk.fi";
const now = new Date(2026, 10, 21, 12).getTime();
const course = { id: "c1", moodleId: 12, name: 'Data: "perusteet"', folder: "Data", code: "DA1234", group: "ABC24SP", semester: "2026-2027", status: "active", start: 1792454400, end: 1797638400 };
const empty = { tabs: [], sections: {} };
const page = (content = empty, saved = {}, bookmarks = [], options = {}) => contentsMarkdown(course, content, saved, base, now, bookmarks, options);

function data(storage = "folder") {
  return { settings: { storage, rootFolder: "StudyHub", obsidian: {} }, courses: [structuredClone(course)], courseContent: {}, contentsMeta: {}, downloads: {}, bookmarks: [], savedTexts: [], deadlines: { items: [{ moodleId: 12, name: "Ei Markdowniin", time: now + 86400000, url: `${base}/mod/assign/view.php?id=9` }] }, ownEntries: [] };
}

test("yksi kurssisivu sisältää perustiedot ylhäällä, ilman linkkiä erilliseen sisällysluetteloon", () => {
  const text = page();
  const properties = text.split("---")[1];
  for (const key of ["course", "code", "semester", "status", "group", "start", "end", "moodle", "updated"]) assert.match(properties, new RegExp(`^${key}:`, "m"));
  assert.match(properties, /course: "Data: \\"perusteet\\""/);
  assert.ok(properties.includes(`${base}/course/view.php?id=12`));
  assert.equal((text.match(/^# /gm) || []).length, 1);
  assert.ok(properties.includes(COURSE_PAGE_PROPERTY));
  assert.ok(!text.includes("<!--")); // tunniste ei näy tekstissä (Obsidianin muokkausnäkymä)
  assert.ok(!text.includes("Sisalto.md"));
  assert.ok(!text.includes("Määräajat"));
  assert.ok(text.includes("## Kurssimateriaalit"));
});

test("Moodlen osiot ovat oikeassa järjestyksessä ja tallennettujen tiedostojen linkit paikallisia", () => {
  const content = { tabs: ["Alku", "Datan siivoaminen", "Lopetus"], sections: {
    "Datan siivoaminen": { order: 2, items: [{ cmid: 20, kind: "file", name: "Harjoitus", label: "Harjoitukset", firstSeen: now, moodleUrl: `${base}/mod/resource/view.php?id=20` }] },
    "Alku": { order: 1, items: [{ cmid: 10, kind: "file", name: "Ohje", moodleUrl: `${base}/mod/resource/view.php?id=10` }, { cmid: 11, kind: "assignment", name: "Palautustehtävä", moodleUrl: `${base}/mod/assign/view.php?id=11` }] }
  } };
  const text = page(content, { 20: { path: "Datan siivoaminen/Harjoitus 1.pdf", updated: true } });
  assert.ok(text.indexOf("### Alku") < text.indexOf("### Datan siivoaminen"));
  assert.ok(text.includes("#### Harjoitukset"));
  assert.ok(text.includes("(Datan%20siivoaminen/Harjoitus%201.pdf)"));
  assert.ok(text.includes("päivitetty Moodlessa"));
  assert.ok(text.includes("### Uutta (14 päivää)"));
  assert.ok(text.includes(`(${base}/mod/resource/view.php?id=10) – tiedosto, ei tallennettu`));
  assert.ok(text.includes(`(${base}/mod/assign/view.php?id=11) – palautustehtävä`));
  assert.ok(text.includes("Osa kurssista puuttuu vielä (Lopetus)"));
});

test("omat linkit säilyvät ja tekstitiedostojen linkkilista kattaa sekä sivut että valinnat", () => {
  const bookmarks = [{ title: "Artikkeli", url: "https://example.org/a", created: now, note: "Oma huomautus", clipPath: "Omat tallennukset/Artikkeli.md" }];
  const savedTexts = [{ title: "Katkelma", url: "https://example.org/b", saved: now + 1, path: "Omat tallennukset/Katkelma.md" }];
  const text = page(empty, {}, bookmarks, { savedTexts });
  assert.ok(text.includes("## Omat linkit"));
  assert.ok(text.includes("[Artikkeli](https://example.org/a)"));
  assert.ok(text.includes("Oma huomautus"));
  assert.ok(text.includes("## Linkit tallennettuihin teksteihin"));
  assert.ok(!text.includes("## Omat tallennukset"));
  for (const name of ["Artikkeli", "Katkelma"]) assert.equal(text.split(`(Omat%20tallennukset/${name}.md)`).length - 1, 1);
  assert.ok(text.indexOf("## Omat linkit") < text.indexOf("## Linkit tallennettuihin teksteihin"));
  assert.ok(text.indexOf("## Linkit tallennettuihin teksteihin") < text.indexOf("## Kurssimateriaalit"));
});

test("Opinnot.md sisältää yhden linkin kurssiin eikä määräaikoja tai erillistä sisältölinkkiä", () => {
  const text = overviewMarkdown(data(), {}, now);
  assert.equal(text.split("(Data/Kurssin%20tiedot.md)").length - 1, 1);
  assert.ok(!text.includes("sisältö]"));
  assert.ok(!text.includes("määräaikoja"));
  assert.ok(!text.includes("Määräajat"));
  assert.ok(!text.includes("Ei Markdowniin"));
});

test("latauskansion nimiristiriidan lopullinen nimi kulkee Opinnot.md:n linkkiin", () => {
  const d = data("downloads");
  d.contentsMeta[12] = { courseFile: COURSE_FILE, path: "StudyHub/Data/Kurssi (2).md" };
  assert.equal(coursePagePath(d, course), "StudyHub/Data/Kurssi (2).md");
  assert.ok(overviewMarkdown(d, {}, now).includes("(Data/Kurssi%20(2).md)"));
});

function disk(initial = {}, fail = () => false) {
  const files = new Map(Object.entries(initial));
  const writes = [], removed = [];
  const folder = {
    readFile: async path => {
      if (!files.has(path)) throw Object.assign(new Error(path), { name: "NotFoundError" });
      return { text: async () => files.get(path) };
    },
    writeFile: async (path, text) => {
      if (fail(path)) throw new Error("kirjoitusvirhe");
      writes.push(path); files.set(path, text);
    },
    removeFile: async path => { removed.push(path); files.delete(path); },
    uniquePath: async path => {
      for (let n = 2; ; n++) { const next = path.replace(/\.md$/, ` (${n}).md`); if (!files.has(next)) return next; }
    }
  };
  return { folder, files, writes, removed };
}

test("uusi kurssi luo yhden Markdown-tiedoston ilman tyhjiä oletuskansioita", async () => {
  const d = disk();
  await writeCoursePage(d.folder, "Data", page());
  assert.deepEqual([...d.files.keys()], ["Data/Kurssin tiedot.md"]);
});

test("tyhjää tai pelkkiä välilyöntejä sisältävää kurssisivua ei arkistoida", async () => {
  for (const text of ["", " \r\n\t "]) {
    const d = disk({ "Data/Kurssin tiedot.md": text, "Data/Sisalto.md": text });
    await writeCoursePage(d.folder, "Data", page());
    assert.deepEqual([...d.files.keys()], ["Data/Kurssin tiedot.md"]);
    assert.equal(d.files.get("Data/Kurssin tiedot.md"), page());
  }
});

test("kaksi samanaikaista kirjoitusta samaan kurssiin eivät kilpaile tai arkistoi väliaikaista tyhjää tiedostoa", { timeout: 3000 }, async () => {
  const d = disk();
  const originalWrite = d.folder.writeFile;
  let entered, release;
  const firstEntered = new Promise(resolve => { entered = resolve; });
  const finishFirst = new Promise(resolve => { release = resolve; });
  let revision = 0;
  d.folder.writeFile = async (path, text) => {
    if (path !== "Data/Kurssin tiedot.md") return originalWrite(path, text);
    const currentRevision = ++revision;
    if (!d.files.has(path)) d.files.set(path, ""); // getFileHandle({ create: true })
    if (currentRevision === 1) { entered(); await finishFirst; }
    if (revision !== currentRevision) throw Object.assign(new Error("Tiedosto muuttui kirjoituksen aikana"), { name: "InvalidStateError" });
    await originalWrite(path, text);
  };
  const first = writeCoursePage(d.folder, "Data", page());
  await firstEntered;
  const latest = page(empty, {}, [{ title: "Uusi linkki", url: "https://example.org/uusi", created: now }]);
  const both = Promise.all([first, writeCoursePage(d.folder, "Data", latest)]);
  // Toisella kirjoittajalla on tilaisuus yrittää lukea vielä tyhjää tiedostoa.
  await new Promise(resolve => setImmediate(resolve));
  release();
  await both;
  assert.equal(revision, 2);
  assert.equal(d.files.get("Data/Kurssin tiedot.md"), latest);
  assert.deepEqual([...d.files.keys()], ["Data/Kurssin tiedot.md"]);
});

test("vanhojen tiedostojen koko sisältö säilyy arkistossa ennen yhdistämistä", async () => {
  const oldCourse = "---\ncourse: Data\n---\n# Data\nOma lisäys!";
  const oldContents = "# Vanha sisällysluettelo\nLisäys tähänkin";
  const d = disk({ "Data/Kurssin tiedot.md": oldCourse, "Data/Sisalto.md": oldContents });
  await writeCoursePage(d.folder, "Data", page());
  assert.equal(d.files.get(".kurssikaveri/aiemmat-kurssisivut/Data/Kurssin tiedot.md"), oldCourse);
  assert.equal(d.files.get(".kurssikaveri/aiemmat-kurssisivut/Data/Sisalto.md"), oldContents);
  assert.equal(d.files.get("Data/Kurssin tiedot.md"), page());
  assert.ok(!d.files.has("Data/Sisalto.md"));
  assert.deepEqual(d.removed, ["Data/Sisalto.md"]);
  const count = d.files.size;
  await writeCoursePage(d.folder, "Data", page(empty, {}, [{ title: "Uusi", url: "https://example.org", created: now }]));
  assert.equal(d.files.size, count);
  assert.ok(d.files.get("Data/Kurssin tiedot.md").includes("Uusi"));
});

test("arkiston nimiristiriita säilyttää molemmat alkuperäiset versiot", async () => {
  const archive = ".kurssikaveri/aiemmat-kurssisivut/Data/Kurssin tiedot.md";
  const d = disk({ [archive]: "Aiemmin talteen", "Data/Kurssin tiedot.md": "Uudempi oma sisältö" });
  await writeCoursePage(d.folder, "Data", page());
  assert.equal(d.files.get(archive), "Aiemmin talteen");
  assert.equal(d.files.get(archive.replace(".md", " (2).md")), "Uudempi oma sisältö");
});

test("arkiston tai uuden tiedoston kirjoitusvirhe ei poista vanhaa sisällysluetteloa", async () => {
  for (const target of [".kurssikaveri/", "Data/Kurssin tiedot.md"]) {
    const d = disk({ "Data/Kurssin tiedot.md": "Vanha kurssi", "Data/Sisalto.md": "Vanha sisältö" }, path => path.startsWith(target));
    await assert.rejects(writeCoursePage(d.folder, "Data", page()), /kirjoitusvirhe/);
    assert.equal(d.files.get("Data/Kurssin tiedot.md"), "Vanha kurssi");
    assert.equal(d.files.get("Data/Sisalto.md"), "Vanha sisältö");
    assert.equal(d.removed.length, 0);
  }
});

test("source: oma -merkintä kummassa tahansa tiedostossa estää muutoksen", async () => {
  for (const file of [COURSE_FILE, "Sisalto.md"]) {
    const d = disk({ [`Data/${file}`]: '---\r\nsource: "oma"\r\n---\r\nOma teksti' });
    await assert.rejects(writeCoursePage(d.folder, "Data", page()), /source: oma/);
    assert.equal(d.writes.length, 0);
    assert.equal(d.removed.length, 0);
  }
});

test("tiedoston lukuvirhe estää ylikirjoituksen", async () => {
  const d = disk();
  d.folder.readFile = async () => { throw new Error("Luku estetty"); };
  await assert.rejects(writeCoursePage(d.folder, "Data", page()), /Luku estetty/);
  assert.equal(d.writes.length, 0);
});

const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
let backendNumber = 0;
function backend(storage = "folder", options = {}) {
  let stored = data(storage);
  if (options.courses) stored.courses = options.courses;
  const writes = [], requests = [], timers = [];
  const lockName = `test-course-storage-${++backendNumber}`;
  let lockDepth = 0, lockRequests = 0, listener;
  let filename = `C:/Downloads/StudyHub/Data/${COURSE_FILE}`, failure = false;
  const ctx = vm.createContext({ Date, COURSE_FILE, courseFolder, contentsMarkdown, relativeToCourse,
    loadAll: async () => structuredClone(stored), save: async changes => { stored = { ...stored, ...changes }; },
    withLock: task => {
      lockRequests++;
      return navigator.locks.request(lockName, { signal: AbortSignal.timeout(1000) }, async () => {
        lockDepth++;
        try { return await task(); } finally { lockDepth--; }
      });
    },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
    isFolderMode: settings => settings.storage === "folder", moodleBase: () => base,
    contentsKey: course => course.moodleId || `course-${course.id}`, simpleHash: text => text,
    mappedCourse: (data, id) => data.courses.find(c => c.moodleId === Number(id)),
    existsMap: async () => ({}), savedEntries: () => ({}), folder: options.folder || {},
    writeCoursePage: async (folder, dir, text) => {
      if (options.requireLock) assert.equal(lockDepth, 1, "Kurssikirjoitus tarvitsee yhteisen lukon");
      if (failure) throw new Error("Ei lupaa");
      writes.push({ dir, text });
      if (options.folder) await writeCoursePage(folder, dir, text);
    },
    downloadOwn: async (url, path, conflict) => { requests.push({ url, path, conflict }); return requests.length; },
    completedDownload: async () => ({ filename }), chrome: { downloads: { erase: async () => {} }, runtime: { onMessage: { addListener: fn => { listener = fn; } } } }
  });
  vm.runInContext(source.slice(source.indexOf("async function writeCourseFiles("), source.indexOf("// ---------- Omat linkit ----------")), ctx);
  vm.runInContext(source.slice(source.indexOf("chrome.runtime.onMessage.addListener("), source.indexOf("// Järjestää tiedoston kurssille.")), ctx);
  return { run: force => ctx.writeCourseContents(structuredClone(stored), course, force), writes, requests, timers, api: ctx,
    dispatch: message => new Promise(resolve => { assert.equal(listener(message, {}, resolve), true); }),
    get lockRequests() { return lockRequests; },
    get stored() { return stored; }, filename: value => { filename = value; }, fail: () => { failure = true; } };
}

test("kurssituonnin viesti ottaa lukon vain kerran kurssia kohti eikä jää odottamaan itseään", { timeout: 3000 }, async () => {
  const courses = [course, { ...course, id: "c2", moodleId: 13, folder: "Toinen" }];
  const b = backend("folder", { courses, requireLock: true });
  const response = await b.dispatch({ action: "createCourseFiles", courseIds: ["c1", "c2"] });
  assert.equal(response.ok, true, response.error);
  assert.equal(b.lockRequests, 2);
  assert.equal(b.writes.length, 2);
  assert.equal(Object.keys(b.stored.contentsMeta).length, 2);
});

test("yhdeksän kurssin tuonti ja ajastettu kirjoitus voivat käynnistyä yhdessä ilman virhettä tai tyhjää arkistoa", { timeout: 3000 }, async () => {
  const courses = Array.from({ length: 9 }, (_, i) => ({ ...course, id: `c${i}`, moodleId: 12 + i, folder: `Kurssi-${i}` }));
  const d = disk();
  const original = d.folder.writeFile;
  const writing = new Set();
  d.folder.writeFile = async (path, text) => {
    assert.ok(!writing.has(path), `Rinnakkainen kirjoitus: ${path}`);
    writing.add(path);
    try {
      if (!d.files.has(path)) d.files.set(path, "");
      await new Promise(resolve => setImmediate(resolve));
      await original(path, text);
    } finally { writing.delete(path); }
  };
  const b = backend("folder", { courses, folder: d.folder, requireLock: true });
  const importing = b.api.createCourseFiles({ courseIds: courses.map(c => c.id) });
  b.api.scheduleContents(12);
  await Promise.all([importing, b.timers[0]()]);
  assert.equal(Object.keys(b.stored.contentsMeta).length, 9);
  assert.equal(d.files.size, 9);
  assert.ok([...d.files.values()].every(isCoursePage));
  assert.ok([...d.files.keys()].every(path => !path.startsWith(".kurssikaveri/")));
});

test("taustatoiminto kirjoittaa myös tyhjän kurssin perustiedot ja päivittää vasta onnistumisen jälkeen", async () => {
  const b = backend();
  await b.run(false);
  assert.equal(b.writes.length, 1);
  assert.ok(b.writes[0].text.includes("course:"));
  assert.equal(b.stored.contentsMeta[12].courseFile, COURSE_FILE);
  await b.run(false); assert.equal(b.writes.length, 1);
  const failed = backend(); failed.fail();
  await assert.rejects(failed.run(true), /Ei lupaa/);
  assert.equal(Object.keys(failed.stored.contentsMeta).length, 0);
});

test("latauskansiotallennus säilyttää aiemman tiedoston ja päivittää jatkossa Chromen antamaa nimeä", async () => {
  const b = backend("downloads");
  b.filename("C:/Downloads/StudyHub/Data/Kurssi (2).md");
  await b.run(true);
  assert.equal(b.requests[0].path, "StudyHub/Data/Kurssin tiedot.md");
  assert.equal(b.requests[0].conflict, "uniquify");
  assert.equal(b.stored.contentsMeta[12].path, "StudyHub/Data/Kurssi (2).md");
  await b.run(true);
  assert.equal(b.requests[1].path, "StudyHub/Data/Kurssi (2).md");
  assert.equal(b.requests[1].conflict, "overwrite");
});

test("updated-päivä on paikallinen päivä myös heti puolenyön jälkeen", () => {
  const justAfterMidnight = new Date(2026, 10, 22, 0, 19).getTime(); // paikallista aikaa
  assert.match(contentsMarkdown(course, empty, {}, base, justAfterMidnight), /^updated: 2026-11-22$/m);
  assert.match(overviewMarkdown(data(), {}, justAfterMidnight), /^updated: 2026-11-22$/m);
});

// Himmennetty välilehti (esim. aukeaa myöhemmin) ei pidä kurssia tarkistamattomana, mutta lukematon tavallinen pitää
test("himmennetyt välilehdet eivät ole puuttuvia", async () => {
  const { unreadTabsOf } = await import("../shared/status.js");
  const content = { tabs: ["Yleinen", "Caset", "Teknologia", "Turvallisuus"], dimTabs: ["Teknologia", "Turvallisuus"],
    sections: { Yleinen: { order: 0, items: [] } } };
  assert.deepEqual(unreadTabsOf(content), ["Caset"]);
  content.sections.Caset = { order: 1, items: [] };
  assert.deepEqual(unreadTabsOf(content), []);
  assert.doesNotMatch(page(content), /Osa kurssista puuttuu/);
  assert.match(page({ ...content, dimTabs: [] }), /Osa kurssista puuttuu vielä \(Teknologia, Turvallisuus\)/);
});

test("kurssisivun tunniste: uusi ominaisuus ja vanha HTML-kommentti tunnistetaan, käyttäjän tiedosto ei", () => {
  assert.ok(isCoursePage(page()));
  assert.ok(isCoursePage(`---\ncourse: "X"\n---\n\n${LEGACY_COURSE_PAGE_MARKER}\n\n# X\n`));
  assert.ok(isCoursePage(`\uFEFF---\r\nkurssikaveri: "kurssisivu"\r\n---\r\n# X`));
  assert.ok(!isCoursePage("# Omat muistiinpanot\n\nkurssikaveri: kurssisivu"));
  assert.ok(!isCoursePage("---\nsource: oma\n---\n# Oma"));
});

// Kurssi.md → Kurssin tiedot.md (2026-11-22)
test("vanha Kurssikaverin Kurssi.md siirtyy uuteen nimeen ja jää arkistoon", async () => {
  const old = `---\ncourse: "Data"\n---\n\n${LEGACY_COURSE_PAGE_MARKER}\n\n# Data\n`;
  const d = disk({ "Data/Kurssi.md": old });
  await writeCoursePage(d.folder, "Data", page());
  assert.equal(d.files.get("Data/Kurssin tiedot.md"), page());
  assert.equal(d.files.has("Data/Kurssi.md"), false);
  assert.equal(d.files.get(".kurssikaveri/aiemmat-kurssisivut/Data/Kurssi.md"), old);
  assert.deepEqual(d.removed, ["Data/Kurssi.md"]);
});

test("käyttäjän oma Kurssi.md jää ennalleen", async () => {
  for (const own of ["# Omat muistiinpanot", '---\nsource: oma\n---\n<!-- Kurssikaveri: kurssisivu -->']) {
    const d = disk({ "Data/Kurssi.md": own });
    await writeCoursePage(d.folder, "Data", page());
    assert.equal(d.files.get("Data/Kurssi.md"), own);
    assert.equal(d.removed.length, 0);
    assert.ok(d.files.has("Data/Kurssin tiedot.md"));
  }
});

test("kurssin nimi on aliaksena ja tiedostonimi kertoo sisällön", () => {
  assert.equal(COURSE_FILE, "Kurssin tiedot.md");
  const properties = page().split("---")[1];
  assert.match(properties, /^aliases:\n  - "Data: \\"perusteet\\""$/m);
});
