// Aja: node --test tests/obsidian.test.mjs (ei asennettavia riippuvuuksia).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as ui from "../shared/ui.js";
import * as skins from "../shared/skins.js";
import { icon } from "../shared/icons.js";
import { DEFAULT_SETTINGS, MOODLE_URL } from "../shared/store.js";
import { makeVault, isObsidianVault } from "../shared/fsstore.js";
import { prepareObsidian, obsidianInstructions } from "../shared/obsidian.js";
import * as backup from "../shared/backup.js";

function directory(name, initial = {}) {
  const entries = new Map(Object.entries(initial));
  const missing = () => Object.assign(new Error("Puuttuu"), { name: "NotFoundError" });
  return { name, entries,
    getDirectoryHandle: async (name, options = {}) => {
      if (!entries.has(name)) { if (!options.create) throw missing(); entries.set(name, directory(name)); }
      const value = entries.get(name);
      if (typeof value === "string") throw Object.assign(new Error("Tiedosto on kansion paikalla"), { name: "TypeMismatchError" });
      return value;
    },
    getFileHandle: async (name, options = {}) => {
      if (!entries.has(name)) { if (!options.create) throw missing(); entries.set(name, ""); }
      return { createWritable: async () => ({ write: async text => entries.set(name, text), close: async () => {} }) };
    }
  };
}

const settings = () => structuredClone({ ...DEFAULT_SETTINGS, onboarded: true, storage: "folder", folderName: "Testiopinnot" });
function filesystem(root = directory("Testiopinnot")) {
  let permission = "granted";
  return { root, makeVault, isObsidianVault, getStudyRoot: async () => root,
    permissionState: async () => permission, requestPermission: async () => permission,
    setPermission: value => { permission = value; } };
}

test("käyttöönotto tekee nykyisestä opintokansiosta holvin juuren vaihtamatta tallennuspaikkaa", async () => {
  const fs = filesystem(directory("Testiopinnot", { "Kurssi.md": "Oma aineisto" }));
  const before = settings();
  const result = await prepareObsidian(fs, before);
  assert.equal(result.enabled, true);
  assert.equal(result.vault, "Testiopinnot");
  assert.equal(result.prefix, ""); assert.equal(result.path, "");
  assert.deepEqual(before, settings());
  assert.equal(fs.root.entries.get("Kurssi.md"), "Oma aineisto");
  const config = fs.root.entries.get(".obsidian");
  assert.equal(JSON.parse(config.entries.get("app.json")).showUnsupportedFiles, true);
  assert.equal(fs.root.entries.size, 2);
});

test("olemassa olevan holvin asetukset säilyvät myös uudelleen käyttöönotossa", async () => {
  const original = '{"theme":"obsidian","showUnsupportedFiles":false,"custom":123}';
  const config = directory(".obsidian", { "app.json": original, "appearance.json": "omat tyylit" });
  const fs = filesystem(directory("Testiopinnot", { ".obsidian": config }));
  await prepareObsidian(fs, settings());
  await prepareObsidian(fs, settings());
  assert.equal(config.entries.get("app.json"), original);
  assert.equal(config.entries.get("appearance.json"), "omat tyylit");
});

test("puuttuvan .obsidian-kansion voi luoda uudelleen koskematta materiaaleihin", async () => {
  const fs = filesystem(directory("Testiopinnot", { "Opinnot.md": "kurssit", "Data.pdf": "aineisto" }));
  assert.equal(await isObsidianVault(fs.root), false);
  await prepareObsidian(fs, settings());
  assert.equal(await isObsidianVault(fs.root), true);
  assert.equal(fs.root.entries.get("Opinnot.md"), "kurssit");
  assert.equal(fs.root.entries.get("Data.pdf"), "aineisto");
});

test("asetustiedoston lukuvirhe ei ylikirjoita olemassa olevia asetuksia", async () => {
  let written = false;
  const fs = filesystem({ name: "Testiopinnot", getDirectoryHandle: async () => ({ getFileHandle: async (_name, options) => {
    if (options?.create) written = true;
    throw Object.assign(new Error("Ei lukuoikeutta"), { name: "NotAllowedError" });
  } }) });
  await assert.rejects(prepareObsidian(fs, settings()), /Ei lukuoikeutta/);
  assert.equal(written, false);
});

test("latauskansioon ei voi valmistella holvia", async () => {
  let read = false;
  await assert.rejects(prepareObsidian({ getStudyRoot: async () => { read = true; } }, { storage: "downloads" }), /oman opintokansion/);
  assert.equal(read, false);
});

test("aiempi holvikytkentä säilyy eikä opintokansion sisälle luoda sisäkkäistä holvia", async () => {
  const s = settings(); s.obsidian = { enabled: false, vault: "Vanha holvi", prefix: "Opinnot", path: "", embedVideos: true };
  const fs = filesystem();
  const result = await prepareObsidian(fs, s);
  assert.deepEqual(result, { ...s.obsidian, enabled: true });
  assert.equal(fs.root.entries.size, 0);
});

test("avausohje näyttää oikean kansion ja tulostaa sen nimen turvallisesti", () => {
  const html = obsidianInstructions('<script>alert(1)</script>');
  assert.ok(html.includes("Open folder as vault"));
  assert.ok(html.includes("obsidian://choose-vault"));
  assert.ok(html.includes("Jos tiedostot eivät näy Obsidianissa"));
  assert.ok(html.includes("Reload app without saving"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

const viewSource = await readFile(new URL("../views/settingsView.js", import.meta.url), "utf8");
function view(fs = filesystem()) {
  let stored = { settings: settings() };
  const events = {};
  const ctx = { get data() { return stored; }, state: { view: "settings", message: null },
    render: () => { ctx.html = sandbox.render(ctx); }, refresh: async () => ctx.render(),
    showMessage: (kind, text) => { ctx.state.message = { kind, text }; ctx.render(); } };
  const sandbox = vm.createContext({ ...ui, ...skins, ...backup, icon, DEFAULT_SETTINGS, MOODLE_URL, folder: fs, prepareObsidian, obsidianInstructions,
    newId: () => "test", withLock: async task => task(), loadAll: async () => structuredClone(stored),
    save: async changes => { stored = { ...stored, ...changes }; },
    saveSettings: async changes => { const patch = typeof changes === "function" ? changes(stored.settings) : changes; stored.settings = { ...stored.settings, ...patch }; },
    setTimeout: () => 0, clearTimeout: () => {}, document: { getElementById: () => ({ focus: () => {} }) }
  });
  vm.runInContext(viewSource.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), sandbox);
  const root = { addEventListener: (name, listener) => { events[name] = listener; } };
  sandbox.bind(root, ctx);
  const click = async action => events.click({ target: { closest: () => ({ dataset: { action, id: "obsidian" } }) } });
  return { ctx, fs, click, get stored() { return stored; },
    toggleOff: () => events.change({ target: { id: "obs-enabled", checked: false } }),
    setSettings: patch => { stored.settings = { ...stored.settings, ...patch }; } };
}

test("asetussivu näyttää käyttöönoton ja ohjeet ilman holvin nimi- tai polkukenttää", async () => {
  const v = view(); await v.click("fold");
  assert.ok(v.ctx.html.includes('data-action="obs-setup"'));
  assert.ok(!v.ctx.html.includes('id="obs-prefix"'));
  assert.ok(!v.ctx.html.includes('id="obs-vault"'));
  await v.click("obs-setup");
  assert.equal(v.stored.settings.obsidian.vault, "Testiopinnot");
  assert.ok(v.ctx.html.includes("Open folder as vault"));
  assert.ok(v.ctx.html.includes("Holvi on valmisteltu"));
  assert.ok(v.ctx.html.includes("Kokeile: avaa Opinnot.md"));
});

test("pois kytkeminen piilottaa avauspainikkeet ja säilyttää holvin, tiedostot ja asetukset", async () => {
  const v = view(); await v.click("fold"); await v.click("obs-setup");
  const config = v.fs.root.entries.get(".obsidian");
  const original = JSON.stringify([...config.entries]);
  await v.toggleOff();
  assert.equal(v.stored.settings.obsidian.enabled, false);
  assert.equal(v.stored.settings.obsidian.vault, "Testiopinnot");
  assert.equal(JSON.stringify([...config.entries]), original);
  assert.ok(v.ctx.html.includes("Holvi, kurssit ja tallennetut tiedostot säilyvät"));
  assert.equal(ui.obsidianUrl(v.stored.settings, "Opinnot.md"), null);
  await v.click("obs-setup");
  assert.equal(v.stored.settings.obsidian.enabled, true);
  assert.equal(JSON.stringify([...config.entries]), original);
});

test("puuttuva lupa tai kirjoitusvirhe näyttää virheen eikä merkitse käyttöönottoa onnistuneeksi", async () => {
  for (const failure of ["permission", "write"]) {
    const fs = filesystem();
    if (failure === "permission") fs.setPermission("denied");
    else fs.makeVault = async () => { throw new Error("Kirjoitus epäonnistui"); };
    const v = view(fs); await v.click("fold"); await v.click("obs-setup");
    assert.equal(v.stored.settings.obsidian.enabled, false);
    assert.equal(v.ctx.state.message.kind, "error");
    assert.ok(v.ctx.html.includes('data-action="obs-setup"'));
    assert.ok(!v.ctx.html.includes("Holvi on valmisteltu"));
  }
});

test("vanha päällä oleva valitsin ilman holvin nimeä näkyy keskeneräisenä", async () => {
  const v = view(); v.setSettings({ obsidian: { enabled: true, vault: "", prefix: "", path: "" } });
  await v.click("fold");
  assert.ok(v.ctx.html.includes("Käyttöönotto kesken"));
  assert.ok(v.ctx.html.includes("Ota Obsidian käyttöön"));
});

const onboardingSource = await readFile(new URL("../onboarding.js", import.meta.url), "utf8");
test("aloitusopas käyttää myös ennestään sisältöä omaavan holvin juurta", async () => {
  let stored = { settings: { ...settings(), onboarded: false }, courses: [], bookmarks: [], savedTexts: [], downloads: {}, ownEntries: [] };
  const fs = filesystem(directory("Opintoholvi", { ".obsidian": directory(".obsidian"), "Vanha.md": "Omaa aineistoa" }));
  const roots = [];
  fs.setRoot = async (...args) => roots.push(args);
  fs.inspectStudyFolder = async () => ({ handle: fs.root, hasEntries: true, text: null });
  const sandbox = vm.createContext({ ...ui, ...backup, icon, folder: fs, prepareObsidian, obsidianInstructions,
    window: {}, loadAll: async () => structuredClone(stored), withLock: async task => task(), save: async changes => { stored = { ...stored, ...changes }; } });
  vm.runInContext(onboardingSource.replace(/^import .*;\r?\n/gm, "").replace(/render\(\);\s*$/, ""), sandbox);
  await sandbox.handlePicked(fs.root);
  assert.equal(roots.length, 1); assert.equal(roots[0].length, 1); assert.equal(roots[0][0], fs.root);
  assert.equal(stored.settings.obsidian.vault, "Opintoholvi");
  assert.equal(stored.settings.obsidian.prefix, "");
  assert.equal(stored.settings.folderName, "Opintoholvi");
  assert.ok(!fs.root.entries.has("Opinnot"));
  assert.equal(fs.root.entries.get("Vanha.md"), "Omaa aineistoa");
});
