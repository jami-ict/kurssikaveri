// fsstore.js – oma opintokansio (File System Access API).
//
// Käyttäjä valitsee kansion kerran aloitusoppaassa. Chrome antaa siitä "kahvan", jonka
// avulla lisäosa voi luoda kansioita, kirjoittaa, siirtää ja poistaa tiedostoja – mutta
// vain tuon kansion sisällä. Kahva tallennetaan IndexedDB:hen, jotta sekä taustaskripti
// että sivut voivat käyttää sitä.
//
// Lupa: kun käyttäjä valitsee "Salli joka kerta" (Allow on every visit), lupa säilyy.
// Muuten Chrome kysyy sen uudelleen, ja kysyminen onnistuu vain sivulla painikkeen kautta.

const DB_NAME = "studyhub-folder";
const STORE = "handles";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// handle = käyttäjän valitsema kansio (lupa koskee sitä), subdir = opintokansio sen sisällä.
// Uudet asennukset käyttävät valittua kansiota suoraan. subdir säilytetään vanhojen asennusten lukemista varten.
export async function setRoot(handle, subdir = "") {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ handle, subdir }, "root");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function stored() {
  const db = await openDb();
  const value = await new Promise(resolve => {
    const request = db.transaction(STORE).objectStore(STORE).get("root");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
  if (!value) return null;
  return value.kind ? { handle: value, subdir: "" } : value; // versio 0.3 tallensi pelkän kahvan
}

// Valittu kansio (lupa kysytään tältä)
export async function getRoot() {
  const value = await stored();
  return value ? value.handle : null;
}

// Todellinen opintokansio, myös vanhoissa asennuksissa käytetty alikansio. Ei vaihda tallennuspaikkaa.
export async function getStudyRoot() {
  return writableRoot(false);
}

// Onko kansio Obsidian-holvi? Holvin pääkansiossa on piilotettu .obsidian-kansio.
export async function isObsidianVault(handle) {
  try { await handle.getDirectoryHandle(".obsidian"); return true; }
  catch (error) { if (error.name === "NotFoundError") return false; throw error; }
}

// Holvit kansion sisältä (käyttäjä valitsi holvin yläpuolisen kansion): [{ handle, path }]
export async function findVaults(handle, depth = 2, path = "") {
  const found = [];
  if (depth <= 0) return found;
  for await (const [name, child] of handle.entries()) {
    if (child.kind !== "directory" || name.startsWith(".")) continue;
    const childPath = path ? `${path}/${name}` : name;
    if (await isObsidianVault(child)) found.push({ handle: child, path: childPath });
    else found.push(...await findVaults(child, depth - 1, childPath));
    if (found.length >= 5) break;
  }
  return found;
}

// Kansion sisältö nimiä myöten (piilotetut ja Obsidianin omat ohitetaan)
export async function visibleEntries(handle) {
  const names = [];
  for await (const [name] of handle.entries()) {
    if (name.startsWith(".") || /^(Welcome|Tervetuloa)\.md$/i.test(name)) continue;
    names.push(name);
  }
  return names;
}

// Tarkista juuri se opintokansio, jota lisäosa käyttää (myös holvin alikansio).
export async function inspectStudyFolder(backupPath) {
  const handle = await writableRoot(false);
  let hasEntries = false;
  for await (const name of handle.keys()) {
    if (!name.startsWith(".")) { hasEntries = true; break; }
  }
  return { handle, hasEntries, text: await readFolderText(handle, backupPath) };
}

// Puuttuva tiedosto on tavallinen ensiasennus. Muut lukuvirheet näytetään oppaassa.
export async function readFolderText(handle, path) {
  const parts = split(path);
  const name = parts.pop();
  try {
    const dir = await dirAt(handle, parts, false);
    const file = await dir.getFileHandle(name);
    return await (await file.getFile()).text();
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

// Tekee kansiosta Obsidian-holvin: .obsidian-kansio ja asetus, joka näyttää kaikki tiedostotyypit
// (PowerPointit, Excelit). Olemassa olevaan asetustiedostoon ei kosketa.
export async function makeVault(handle) {
  const config = await handle.getDirectoryHandle(".obsidian", { create: true });
  try {
    await config.getFileHandle("app.json");
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
    const file = await config.getFileHandle("app.json", { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify({ showUnsupportedFiles: true }, null, 2));
    await writable.close();
  }
}

// Opintokansio: valittu kansio tai sen alikansio
async function baseDir(create) {
  const value = await stored();
  if (!value) return null;
  return value.subdir ? dirAt(value.handle, split(value.subdir), create) : value.handle;
}

// "granted" | "prompt" | "denied" | "missing"
export async function permissionState() {
  const root = await getRoot();
  if (!root) return "missing";
  try { return await root.queryPermission({ mode: "readwrite" }); } catch (e) { return "denied"; }
}

// Vain sivulla, käyttäjän painalluksen jälkeen
export async function requestPermission() {
  const root = await getRoot();
  if (!root) return "missing";
  return root.requestPermission({ mode: "readwrite" });
}

async function writableRoot(create = true) {
  const value = await stored();
  if (!value) throw new FolderError("missing", "Opintokansiota ei ole valittu.");
  const state = await value.handle.queryPermission({ mode: "readwrite" });
  if (state !== "granted") throw new FolderError("permission", "Kurssikaveri tarvitsee luvan opintokansioon.");
  return value.subdir ? dirAt(value.handle, split(value.subdir), create) : value.handle;
}

export class FolderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function split(path) {
  return String(path).split("/").filter(Boolean);
}

async function dirAt(root, parts, create) {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

export async function ensureDir(path) {
  const root = await writableRoot();
  return dirAt(root, split(path), true);
}

export async function exists(path) {
  const parts = split(path);
  try {
    const root = await baseDir(false);
    if (!root) return false;
    const dir = await dirAt(root, parts.slice(0, -1), false);
    await dir.getFileHandle(parts[parts.length - 1]);
    return true;
  } catch (e) { return false; }
}

const isMissing = error => Boolean(error) && (error.name === "NotFoundError" || error.name === "TypeMismatchError");

// Mitkä tiedostot ovat yhä opintokansiossa? Palauttaa { polku: true | false }.
// null = ei voida tarkistaa (kansiota ei ole valittu tai lupa puuttuu); silloin tiedostojen oletetaan olevan tallessa.
// Jokainen kansio avataan vain kerran, joten satojen tiedostojen tarkistus on nopea.
export async function existingFiles(paths) {
  let root;
  try {
    const top = await getRoot();
    if (!top || (await top.queryPermission({ mode: "readwrite" })) !== "granted") return null;
    root = await baseDir(false);
  } catch (error) {
    return null;
  }
  if (!root) return null;

  const dirs = new Map(); // kansion polku → kahva; null = kansiota ei ole; undefined = ei saatu selville
  const dirFor = async parts => {
    const key = parts.join("/");
    if (dirs.has(key)) return dirs.get(key);
    let dir = root;
    if (parts.length > 0) {
      const parent = await dirFor(parts.slice(0, -1));
      if (!parent) dir = parent;
      else {
        try { dir = await parent.getDirectoryHandle(parts[parts.length - 1]); }
        catch (error) { dir = isMissing(error) ? null : undefined; }
      }
    }
    dirs.set(key, dir);
    return dir;
  };

  const result = {};
  for (const path of new Set(paths)) {
    const parts = split(path);
    if (parts.length === 0) continue;
    const dir = await dirFor(parts.slice(0, -1));
    if (dir === null) { result[path] = false; continue; }
    if (dir === undefined) continue;
    try { await dir.getFileHandle(parts[parts.length - 1]); result[path] = true; }
    catch (error) { if (isMissing(error)) result[path] = false; }
  }
  return result;
}

// Vapaa nimi: "Luento.pdf" → "Luento (2).pdf", jos sama nimi on jo käytössä
export async function uniquePath(path) {
  if (!(await exists(path))) return path;
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const hasExt = dot > slash + 1;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : "";
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export async function writeFile(path, content, { onlyIfMissing = false } = {}) {
  const root = await writableRoot();
  const parts = split(path);
  const dir = await dirAt(root, parts.slice(0, -1), true);
  const name = parts[parts.length - 1];
  if (onlyIfMissing) {
    try { await dir.getFileHandle(name); return; }
    catch (error) { if (error.name !== "NotFoundError") throw error; }
  }
  await writeInDir(dir, name, content);
}

// Chrome kirjoittaa ensin väliaikaiseen .crswap-tiedostoon ja vaihtaa sen paikalleen close-vaiheessa.
// Jos toinen ohjelma (esim. auki oleva Obsidian tai virustorjunta) lukee juuri luotua tiedostoa,
// vaihto voi hetkellisesti epäonnistua (InvalidStateError tai NoModificationAllowedError).
// Silloin koko kirjoitus yritetään lyhyen tauon jälkeen uudelleen. Sisältö (teksti tai Blob) on käytettävissä uudelleen.
const RETRY_ERRORS = ["InvalidStateError", "NoModificationAllowedError"];
const RETRY_WAITS = [150, 400, 1000];

export async function writeInDir(dir, name, content, { waits = RETRY_WAITS, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    let writable = null;
    try {
      const file = await dir.getFileHandle(name, { create: true });
      writable = await file.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (error) {
      if (writable) { try { await writable.abort(); } catch (e) { /* jo suljettu */ } }
      if (!RETRY_ERRORS.includes(error.name) || attempt >= waits.length) throw error;
      await sleep(waits[attempt]);
    }
  }
}

export async function readFile(path) {
  const root = await writableRoot();
  const parts = split(path);
  const dir = await dirAt(root, parts.slice(0, -1), false);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}

// Tekstitiedoston sisältö tai null, jos tiedostoa ei ole tai kansiota ei voida lukea (ei valittu, lupa puuttuu)
export async function readText(path) {
  try {
    const root = await baseDir(false);
    if (!root) return null;
    return await readFolderText(root, path);
  } catch (error) {
    return null;
  }
}

export async function removeFile(path) {
  const root = await writableRoot(false);
  const parts = split(path);
  const dir = await dirAt(root, parts.slice(0, -1), false);
  const name = parts[parts.length - 1];
  await dir.getFileHandle(name); // removeEntry voisi poistaa myös samannimisen tyhjän kansion
  await dir.removeEntry(name);
}

// Siirto: kirjoitetaan uuteen paikkaan ja poistetaan vanha (toimii kaikissa Chrome-versioissa)
export async function moveFile(from, to) {
  const file = await readFile(from);
  await writeFile(to, file);
  await removeFile(from);
}

// SHA-256-sormenjälki sisällöstä: sama sisältö = sama tiedosto, nimestä riippumatta
export async function sha256(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
