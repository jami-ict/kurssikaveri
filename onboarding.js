// onboarding.js – tallennuspaikan valinta ja Kurssikaverin avaaminen.

import { loadAll, save, withLock } from "./shared/store.js";
import { escapeHtml, choice, ORGANIZE_LABELS } from "./shared/ui.js";
import { icon } from "./shared/icons.js";
import * as folder from "./shared/fsstore.js";
import { BACKUP_PATH, parseBackup, isEmpty, backupSummary, backupDay, backupFingerprint, restoreChanges } from "./shared/backup.js";
import { prepareObsidian, obsidianInstructions } from "./shared/obsidian.js";

const STEPS = ["folder", "ready"];
const NO_OBSIDIAN = { enabled: false, vault: "", prefix: "", path: "" };

let step = 0;
let data = null;
let settings = null;
let message = null;                 // { kind: "ok" | "error", text }
let chosen = null;                  // onko tallennuspaikka valittu (null = selvitetään ensimmäisellä piirrolla)
let selectedFolder = null;          // opintokansio ja siinä käyttäjälle näytetyt palautustiedot
const canPick = typeof window.showDirectoryPicker === "function";

async function render() {
  data = await loadAll();
  settings = data.settings;
  if (chosen === null) {
    const hasFolder = settings.storage === "folder" && Boolean(settings.folderName);
    chosen = settings.onboarded || hasFolder;
    if (hasFolder && !locationLocked(data)) await lookInFolder();
  }
  document.getElementById("count").textContent = `Vaihe ${step + 1} / ${STEPS.length}`;
  document.getElementById("steps").innerHTML = STEPS.map((_, i) => `<div class="step-dot ${i <= step ? "done" : ""}"></div>`).join("");
  const box = document.getElementById("step");
  box.inert = false;
  box.innerHTML = VIEWS[STEPS[step]]();
  box.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(Number(b.dataset.go))));
  BINDS[STEPS[step]](box);
}

async function go(delta) {
  step = Math.max(0, Math.min(STEPS.length - 1, step + delta));
  message = null;
  await render();
}

function nextButton(disabled = false) {
  return `
    <div class="wz-nav">
      <span></span>
      <button class="savebtn" type="button" data-go="1" ${disabled ? "disabled" : ""}>Jatka${icon("arrow")}</button>
    </div>`;
}

function notice() {
  return message ? `<div class="notice ${message.kind}">${escapeHtml(message.text)}</div>` : "";
}

function folderBox(name, sub) {
  return `<div class="foldbox">${icon("folder", { className: "fic" })}<div><b>${escapeHtml(name)}</b><small>${escapeHtml(sub)}</small></div></div>`;
}

async function inspectFolder() {
  const { handle, hasEntries, text } = await folder.inspectStudyFolder(BACKUP_PATH);
  const backup = text === null ? null : parseBackup(text);
  if (text !== null && !backup) throw new Error("Kansion Kurssikaveri-varmuuskopiota ei voitu lukea. Tarkista tiedosto tai valitse toinen kansio.");
  return { handle, hasEntries, backup };
}

async function lookInFolder() {
  selectedFolder = null;
  try {
    selectedFolder = await inspectFolder();
  } catch (error) {
    message = { kind: "error", text: error.message };
  }
}

function folderNote() {
  if (!selectedFolder) return "";
  const { backup, hasEntries } = selectedFolder;
  if (backup) {
    const day = backupDay(backup);
    return `<div class="notice info"><strong>Kansiosta löytyi Kurssikaverin varmuuskopio${day ? ` (${day})` : ""}.</strong>
      <p>${escapeHtml(backupSummary(backup))}. Tiedot palautetaan, kun avaat Kurssikaverin. Kurssimateriaalit säilyvät kansiossa.</p></div>`;
  }
  return hasEntries ? `<div class="notice info">Kansiossa on ennestään tiedostoja tai kansioita. Ne säilyvät paikoillaan.</div>` : "";
}

function obsidianRow() {
  const o = settings.obsidian;
  if (o.vault) {
    return `<div class="srow srow-wide"><div class="rd">Opintokansio on Obsidian-holvin juuri.</div>${obsidianInstructions(o.vault)}</div>`;
  }
  return `<div class="srow srow-wide"><div class="rd">Obsidian on valinnainen. Voit ottaa sen käyttöön myös myöhemmin Asetuksissa.</div>
    <div class="rc"><button class="btn2" type="button" id="make-vault">Ota Obsidian käyttöön</button></div></div>`;
}

function organizationRow() {
  const backup = selectedFolder?.backup;
  const value = backup?.settings.organizeBy || settings.organizeBy;
  if (backup) {
    return `<p>Varmuuskopiosta palautettava materiaalien järjestys: <strong>${ORGANIZE_LABELS[value] || ORGANIZE_LABELS.topic}</strong>.</p>`;
  }
  return `<div class="srow"><div><span class="rt">Materiaalien järjestys kurssikansiossa</span>
    <div class="rd">Esimerkiksi <span class="path">Data-analytiikka/Datan siivoaminen/</span> tai <span class="path">Data-analytiikka/Luennot/</span>.</div></div>
    <div class="rc">${choice("organize", Object.entries(ORGANIZE_LABELS), value, "Materiaalien järjestys kurssikansiossa")}</div></div>`;
}

function folderStep() {
  const isFolder = settings.storage === "folder" && Boolean(settings.folderName);
  if (locationLocked(data)) {
    return `<h1>Tallennuspaikka</h1>
      ${notice()}
      ${folderBox(isFolder ? settings.folderName : `Downloads/${settings.rootFolder}`, "Käytössä oleva tallennuspaikka")}
      <p>Tallennuspaikkaa ei voi vaihtaa käyttöönoton tai tietojen palautuksen jälkeen. Näin tallennettujen tiedostojen linkit säilyvät toimivina.</p>
      ${isFolder ? `<p>Kansion käyttöluvan voit antaa <a href="library.html#settings">asetuksissa</a>.</p>` : ""}
      ${nextButton()}`;
  }
  let html = `
    <h1>Mihin opintosi tallennetaan?</h1>
    <p class="wz-lead">Valitse opintomateriaaleille kansio, esimerkiksi <span class="path">Dokumentit/Opinnot</span>.</p>
    ${notice()}`;

  if (chosen && isFolder) {
    const { vault } = settings.obsidian;
    const folderType = vault ? "Obsidian-holvi" : "Valittu kansio";
    html += `
      <div class="wz-box">
        <div class="wz-chosen">
          ${folderBox(settings.folderName, folderType)}
          <button class="btn2" type="button" id="pick">Vaihda kansio</button>
        </div>
        ${obsidianRow()}
        ${selectedFolder ? organizationRow() : ""}
      </div>
      ${folderNote()}
      <p class="muted small">Kun Chrome myöhemmin kysyy lupaa kansioon uudelleen, valitse <strong>"Salli joka kerta"</strong>
        (Allow on every visit), niin Kurssikaveri toimii myös taustalla.</p>`;
  } else if (chosen) {
    html += `
      <div class="wz-box">
        <div class="wz-chosen">
          ${folderBox(`Downloads/${settings.rootFolder}`, "Selaimen latauskansio")}
          ${canPick ? `<button class="btn2" type="button" id="pick">Valitse oma kansio</button>` : ""}
        </div>
        ${organizationRow()}
      </div>
      <p class="muted small">Latauskansiossa tallennettua tiedostoa ei voi siirtää.</p>`;
  } else {
    html += `
      ${canPick ? "" : `<div class="notice error">Tämä selain ei tue kansion valintaa. Käytä latauskansiota.</div>`}
      <button class="savebtn wz-pick" type="button" id="pick" ${canPick ? "" : "disabled"}>${icon("folder")}Valitse kansio</button>
      <p class="muted small">Chrome kysyy luvan muokata kansiota. Kurssikaveri käsittelee vain tätä kansiota.
        Jos käytät Obsidiania, voit valita holvisi kansion – Kurssikaveri tunnistaa sen.</p>`;
  }

  if (!chosen || isFolder) {
    html += `
      <details class="wz-more" ${canPick ? "" : "open"}>
        <summary>Muita vaihtoehtoja</summary>
        <p class="muted small">Tiedostot voi tallentaa myös selaimen latauskansioon (<span class="path">Downloads/${escapeHtml(settings.rootFolder)}</span>).
          Se toimii kaikissa selaimissa, mutta tallennettua tiedostoa ei voi siirtää.</p>
        <button class="btn2" type="button" id="use-downloads">Käytä latauskansiota</button>
      </details>`;
  }
  return html + nextButton(!chosen || (isFolder && !selectedFolder));
}

const VIEWS = {
  folder: folderStep,
  ready: () => `
    <h1>Kaikki valmista</h1>
    ${notice()}
    ${folderBox(settings.storage === "folder" ? settings.folderName : `Downloads/${settings.rootFolder}`, "Opintojen tallennuspaikka")}
    <p>${selectedFolder?.backup?.courses?.length
      ? "Tänään-sivu avautuu ja tarkistaa kurssit ja määräajat Moodlesta."
      : "Seuraavaksi Kurssikaveri hakee kurssisi Moodlesta, ja valitset tuotavat kurssit."}</p>
    ${settings.obsidian.enabled && settings.obsidian.vault && !settings.obsidian.prefix && !settings.obsidian.path ? obsidianInstructions(settings.obsidian.vault) : ""}
    <div class="wz-nav">
      <button class="btn2" type="button" data-go="-1">Takaisin</button>
      <button class="savebtn" type="button" id="library">Avaa Kurssikaveri${icon("arrow")}</button>
    </div>`
};

async function pickFolder() {
  try {
    return await window.showDirectoryPicker({ id: "studyhub", mode: "readwrite", startIn: "documents" });
  } catch (error) {
    if (error.name !== "AbortError") message = { kind: "error", text: `Kansiota ei voitu valita: ${error.message}` };
    return null;
  }
}

// Käyttäjä valitsi kansion: holvi tunnistetaan itsestään, muuten kansio otetaan käyttöön sellaisenaan
async function handlePicked(handle) {
  await requireUnlockedLocation(); // tarkistetaan uudelleen myös kansionvalintaikkunan sulkeuduttua
  const isVault = await folder.isObsidianVault(handle);
  await changeLocation(async current => {
    await folder.setRoot(handle);
    await save({ settings: { ...current.settings, storage: "folder", folderName: handle.name,
      obsidian: isVault ? { ...NO_OBSIDIAN, enabled: true, vault: handle.name } : { ...NO_OBSIDIAN } } });
  });
  message = null;
  chosen = true;
  await lookInFolder();
}

// Palauta tiedot ja päätä käyttöönotto samalla tallennuksella ennen taustapäivitystä.
async function finish() {
  const selected = selectedFolder;
  const storage = settings.storage;
  try {
    await withLock(async () => {
      const current = await loadAll();
      if (current.settings.onboarded) return;
      let changes = { settings: current.settings };
      if (selected?.backup && !isEmpty(current)) throw new Error("Kurssikaveriin on jo lisätty tietoja toisessa välilehdessä. Käytetään selaimessa olevia tietoja.");
      if (isEmpty(current)) {
        if (storage !== current.settings.storage) throw new Error("Tallennuspaikka vaihtui. Tarkista valittu kansio.");
        if (storage === "folder") {
          const latest = await inspectFolder();
          if (!selected || !(await latest.handle.isSameEntry(selected.handle)) ||
              backupFingerprint(latest.backup || {}) !== backupFingerprint(selected.backup || {})) {
            throw new Error("Kansio tai sen varmuuskopio vaihtui. Tarkista valinta uudelleen.");
          }
          if (latest.backup) changes = restoreChanges(latest.backup, current.settings);
        }
      }
      await save({ ...changes, settings: { ...changes.settings, onboarded: true } });
    });
    location.replace(chrome.runtime.getURL("library.html#start"));
  } catch (error) {
    step = 0;
    chosen = null;
    selectedFolder = null;
    message = { kind: "error", text: error.message };
    await render();
  }
}

async function makeVault() {
  if ((await folder.requestPermission()) !== "granted") throw new Error("Kurssikaveri tarvitsee luvan kansioon.");
  await changeLocation(async current => {
    const obsidian = await prepareObsidian(folder, current.settings);
    await save({ settings: { ...current.settings, obsidian } });
  });
  message = { kind: "ok", text: "Holvi on valmisteltu. Avaa opintokansio vielä Obsidianissa alla olevan ohjeen mukaan." };
  await lookInFolder();
}

function locationLocked(current) {
  return current.settings.onboarded || !isEmpty(current);
}

async function requireUnlockedLocation() {
  const current = await loadAll();
  if (locationLocked(current)) {
    throw new Error("Tallennuspaikkaa ei voi vaihtaa käyttöönoton tai tietojen palautuksen jälkeen.");
  }
  return current;
}

function changeLocation(task) {
  return withLock(async () => task(await requireUnlockedLocation()));
}

// Kansiovaiheen toiminnot tarkistavat tuoreen tilan myös toisessa välilehdessä tehdyn käyttöönoton varalta.
async function act(task) {
  document.getElementById("step").inert = true;
  try { await requireUnlockedLocation(); await task(); } catch (error) { message = { kind: "error", text: error.message }; }
  render();
}

const BINDS = {
  folder: box => {
    const pick = box.querySelector("#pick");
    if (pick) pick.addEventListener("click", () => act(async () => {
      const handle = await pickFolder();
      if (handle) await handlePicked(handle);
    }));

    box.querySelectorAll('input[name="organize"]').forEach(input => {
      input.addEventListener("change", () => act(async () => {
        await changeLocation(({ settings }) => save({ settings: { ...settings, organizeBy: input.value } }));
      }));
    });
    const create = box.querySelector("#make-vault");
    if (create) create.addEventListener("click", () => act(makeVault));

    const downloads = box.querySelector("#use-downloads");
    if (downloads) downloads.addEventListener("click", () => act(async () => {
      await changeLocation(({ settings }) => save({ settings: { ...settings, storage: "downloads" } }));
      chosen = true;
      selectedFolder = null;
      message = null;
    }));
  },

  ready: box => {
    box.querySelector("#library").addEventListener("click", () => {
      box.inert = true;
      finish();
    });
  }
};

render();
