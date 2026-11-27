// Aja: node --test tests/courseView.test.mjs (ei asennettavia riippuvuuksia).
import test from "node:test";
import assert from "node:assert/strict";
import { render, bind } from "../views/courseView.js";
import { DEFAULT_SETTINGS } from "../shared/store.js";

function fixture() {
  const now = Date.now();
  const course = { id: "c1", moodleId: 12, name: "Data-analytiikka", folder: "Data", status: "active" };
  const data = {
    settings: { ...DEFAULT_SETTINGS, storage: "folder", obsidian: { enabled: true, vault: "Opinnot" } },
    courses: [course, { ...course, id: "c2", moodleId: 13, name: "Toinen kurssi" }],
    downloads: {}, contentsMeta: {},
    courseContent: { 12: { tabs: ["Alku"], sections: { Alku: { order: 0, items: [
      { cmid: 10, kind: "file", name: "Luentokalvot", moodleUrl: "https://example.org/file", firstSeen: now },
      { cmid: 11, kind: "link", name: "Moodlen linkki", target: "https://example.org", moodleUrl: "https://example.org/link" }
    ] } } } },
    deadlines: { items: [{ moodleId: 12, name: "Viikkoharjoitus", time: now + 86400000, label: "Määräaika", url: "https://example.org/task" }] },
    bookmarks: [{ id: "b1", courseId: "c1", title: "Oma linkki", url: "https://example.org/own", created: now }],
    savedTexts: [{ id: "t1", courseId: "c1", title: "Oma teksti", url: "https://example.org/text", path: "Omat tallennukset/Oma.md", saved: now, tags: ["tentti"] }]
  };
  const ctx = { data, exists: {}, state: { courseId: "c1", itemFilter: "all" }, renders: 0, render() { this.renders++; } };
  return ctx;
}

function button(html, id) {
  const result = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
  assert.ok(result, `Painike ${id} löytyy`);
  return result[0];
}

function isOpen(html, id) {
  const result = html.match(new RegExp(`<div class="fbody" id="course-body-${id}"([^>]*)>`));
  assert.ok(result, `Kansio ${id} löytyy`);
  return !result[1].includes("hidden");
}

async function click(ctx, dataset) {
  let handler;
  bind({ querySelector: () => null, addEventListener: (type, callback) => { if (type === "click") handler = callback; } }, ctx);
  await handler({ target: { closest: () => ({ dataset, disabled: false }) } });
}

test("oletuksena määräajat ja sisältö auki, omat ja uudet osiot kiinni; ohjaimilla yksilölliset kohteet", () => {
  const ctx = fixture();
  const html = render(ctx);
  for (const id of ["deadlines", "content"]) assert.equal(isOpen(html, id), true);
  for (const id of ["new", "links", "texts"]) assert.equal(isOpen(html, id), false);
  assert.match(button(html, "course-fold-deadlines"), /aria-expanded="true"/);
  assert.match(button(html, "course-saved-texts"), /aria-expanded="false"/);
  const ids = [...html.matchAll(/(?<![\w-])id="([^"]+)"/g)].map(match => match[1]); // ei data-id-attribuutteja
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/aria-controls="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
  assert.match(html, /1 uusi kohde · Luentokalvot/);
  assert.match(html, /1 linkki<\/span>/);
  assert.match(html, /1 teksti<\/span>/);
});

test("useita kansioita voi avata ja sulkea; valinnat säilyvät suodatuksessa ja datan päivityksessä", async () => {
  const ctx = fixture();
  render(ctx);
  await click(ctx, { action: "course-fold", id: "deadlines" });
  await click(ctx, { action: "course-fold", id: "links" });
  await click(ctx, { action: "course-fold", id: "texts" });
  await click(ctx, { action: "filter", filter: "files" });
  ctx.data = structuredClone(ctx.data); // chrome.storage-päivityksen tavoin uusi data, sama sivutila
  const html = render(ctx);
  assert.equal(isOpen(html, "deadlines"), false);
  for (const id of ["links", "texts", "content"]) assert.equal(isOpen(html, id), true);
  assert.match(button(html, "course-filter-files"), /aria-pressed="true"/);
  assert.ok(html.includes("Luentokalvot"));
  assert.ok(!html.includes('data-url="https://example.org/link"'));
  assert.equal(ctx.renders, 4);
});

test("kurssin vaihto käyttää omia avausvalintoja ja paluu palauttaa aiemman kurssin valinnat", async () => {
  const ctx = fixture();
  render(ctx);
  await click(ctx, { action: "course-fold", id: "content" });
  ctx.state.courseId = "c2";
  assert.equal(isOpen(render(ctx), "content"), true);
  ctx.state.courseId = "c1";
  assert.equal(isOpen(render(ctx), "content"), false);
});

test("tallennusikkunan suora siirtymä avaa aiemmin suljetut omat tallennukset ja pitää ne auki jatkopäivityksessä", async () => {
  const ctx = fixture();
  render(ctx);
  assert.equal(isOpen(render(ctx), "texts"), false);
  ctx.state.openSavedTexts = true;
  const html = render(ctx);
  assert.equal(isOpen(html, "texts"), true);
  assert.match(button(html, "course-saved-texts"), /aria-expanded="true"/);
  assert.ok(html.includes("Oma teksti"));
  ctx.state.openSavedTexts = false; // library.js kuittaa siirtymän piirron jälkeen
  assert.equal(isOpen(render(ctx), "texts"), true);
});

test("tyhjiä omia osioita ei synny; Moodlea odottava ja käsin lisätty kurssi säilyttävät tiedostonsa ja toimintonsa", () => {
  const ctx = fixture();
  ctx.state.courseId = "c2";
  ctx.data.downloads.f1 = { id: "f1", courseId: "c2", state: "complete", status: "filed", path: "Data/Oma.pdf", time: Date.now() };
  let html = render(ctx);
  for (const id of ["new", "links", "texts", "deadlines"]) assert.ok(!html.includes(`id="course-body-${id}"`));
  assert.ok(html.includes("Avaa kurssi kerran Moodlessa"));
  assert.ok(html.includes("Oma.pdf"));
  delete ctx.data.courses[1].moodleId;
  html = render(ctx);
  assert.ok(html.includes('id="course-title-content">Tiedostot'));
  assert.ok(html.includes('data-action="open-file" data-id="f1"'));
  assert.ok(html.includes('data-action="ensure-folder"'));
  assert.ok(html.includes('data-action="remove"'));
  ctx.data.downloads = {};
  assert.ok(render(ctx).includes("Ei tallennettuja tiedostoja"));
});

test("puuttuvat osiot näkyvät myös suljetun Sisältö-kansion yhteenvedossa; nimet tulostetaan turvallisesti", async () => {
  const ctx = fixture();
  ctx.data.courseContent[12].tabs.push('Puuttuva <img src=x>');
  ctx.data.courseContent[12].sections.Alku.items[0].name = '<img src=x onerror="alert(1)">';
  ctx.data.bookmarks[0].title = "<script>test</script>";
  render(ctx);
  await click(ctx, { action: "course-fold", id: "content" });
  const html = render(ctx);
  assert.equal(isOpen(html, "content"), false);
  assert.match(html, /id="course-summary-content">[^<]*materiaaleja tarkistamatta/);
  assert.ok(html.includes("Puuttuva &lt;img src=x&gt;"));
  assert.ok(html.includes("1 uusi kohde · &lt;img"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>test"));
});

test("Näytä teksti omassa opintokansiossa, Näytä kansiossa Lataukset-tilassa", () => {
  const ctx = fixture();
  ctx.data.bookmarks[0].clipPath = "Omat tallennukset/Oma linkki.md";
  let html = render(ctx);
  assert.match(html, /data-action="show-text" data-kind="text" data-id="t1">Näytä teksti</);
  assert.match(html, /data-action="show-text" data-kind="clip" data-id="b1">Näytä teksti</);
  ctx.data.settings = { ...ctx.data.settings, storage: "downloads", obsidian: { enabled: false } };
  html = render(ctx);
  assert.match(html, /data-kind="text" data-id="t1">Näytä kansiossa</);
  assert.doesNotMatch(html, /Obsidianissa/);
});
