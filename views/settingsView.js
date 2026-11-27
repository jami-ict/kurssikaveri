// settingsView.js – Asetukset.
//
// Asetukset ovat kansiopinona samaan tapaan kuin Kalenteri-sivun merkinnät (samat .fold-luokat):
// jokainen osio (Tallennus, Moodle, Ulkoasu, Obsidian, Tiedot) on oma kansionsa, ja yksi on kerrallaan auki.
// Suljetun kansion etulevyssä on yhteenveto nykyisistä arvoista, joten tilan näkee avaamatta.
// Muutokset tallentuvat heti (ei Tallenna-painiketta). Tekstikenttä tallentuu, kun kentästä poistutaan.

import { updateData, withLock, loadAll, save, saveSettings, newId, DEFAULT_SETTINGS, MOODLE_URL } from "../shared/store.js";
import { escapeHtml, grantFolderPermission, grantNote, choice, ORGANIZE_LABELS, obsidianUrl } from "../shared/ui.js";
import { icon } from "../shared/icons.js";
import * as folder from "../shared/fsstore.js";
import { BACKUP_PATH, BACKUP_OLD_PATH } from "../shared/backup.js";
import { DEFAULT_SKIN, TONES, allSkins, customSkins, cleanSkin, getSkin, skinPreview, previewStyle, skinIssues } from "../shared/skins.js";
import { prepareObsidian, obsidianInstructions } from "../shared/obsidian.js";

let permission = "unknown"; // haetaan näkymän avautuessa
let confirmClear = false;   // "Poista tiedot…" painettu, varmistus näkyvissä
let savedFlash = false;     // "Tallennettu" hetken muutoksen jälkeen
let flashTimer = null;
let editor = null;          // oman värimaailman muokkain auki: { id | null, name, base, accent, warn, tone, confirmDelete }
let openFold = null; // Säilytä avoin kansio, kun asetusten muutos piirtää sivun uudelleen.
let vaultFolder = { name: "", present: null, error: "" };
let preparingObsidian = false;
let guideOpen = false;       // Obsidian-ohje auki (heti holvin valmistelun jälkeen)

// ---------- rakennuspalat ----------

function row(title, desc, control, forId = "") {
  const t = forId ? `<label class="rt" for="${forId}">${title}</label>` : `<span class="rt">${title}</span>`;
  const kind = control.includes('class="sw"') ? " srow-sw" : !control ? " srow-text" : "";
  return `<div class="srow${kind}"><div>${t}${desc ? `<div class="rd">${desc}</div>` : ""}</div><div class="rc">${control}</div></div>`;
}

function toggle(id, checked) {
  return `<input class="sw" type="checkbox" id="${id}" role="switch" ${checked ? "checked" : ""}>`;
}

// Värimaailman valinta: kortti jokaisesta vaihtoehdosta (pieni esikatselu + nimi), omissa lisäksi Muokkaa
function skinChoice(settings) {
  const current = getSkin(settings).id;
  const cards = allSkins(settings).map(skin => {
    const light = skinPreview(skin, false);
    const dark = skinPreview(skin, true);
    const own = !skin.builtin && customSkins(settings).some(c => c.id === skin.id);
    return `
    <label class="skin"><input class="sr-only" type="radio" name="set-skin" value="${skin.id}" ${skin.id === current ? "checked" : ""}>
      <span class="skin-pre" aria-hidden="true" style="--sample-bar:light-dark(${light.bar},${dark.bar});--sample-bg:light-dark(${light.bg},${dark.bg});--sample-warn:light-dark(${light.warn},${dark.warn})">
        <span class="skin-bar"></span><span class="skin-dots"><i></i><i></i><i></i><b></b></span>
      </span>
      <span class="skin-name">${escapeHtml(skin.name)}${icon("check")}</span>
      ${own ? `<button class="link skin-edit" type="button" data-action="skin-edit" data-id="${skin.id}">Muokkaa</button>` : ""}
    </label>`;
  }).join("");
  return `<div class="skins" role="radiogroup" aria-label="Värimaailma">${cards}
    <button class="skin skin-new" type="button" data-action="skin-new">${icon("plus")}Tee oma</button></div>`;
}

// ---------- oman värimaailman muokkain ----------

function draftSkin() {
  return { id: editor.id || "uusi", name: editor.name, base: editor.base, accent: editor.accent, warn: editor.warn, tone: editor.tone };
}

function colorRow(field, title, desc) {
  return `<div class="ske-row">
    <input class="ske-color" type="color" id="ske-${field}" value="${editor[field]}">
    <div><label class="rt" for="ske-${field}">${title}</label><div class="rd">${desc}</div></div>
    <code class="ske-hex" data-hex="${field}">${editor[field].toUpperCase()}</code>
  </div>`;
}

// Esikatselu: pieni pala käyttöliittymää. Värit tulevat esikatselun omista muuttujista (style-attribuutti),
// joten sama HTML näyttää sekä vaalean että tumman teeman.
function skinPreviewBox(dark) {
  const dot = n => `<i style="background:var(--k${n}-dot)"></i>`;
  const courses = [1, 2, 3, 4, 5, 6, 7].map(n => `<span style="background:var(--k${n}-bg);color:var(--k${n}-ink)">${dot(n)}Kurssi ${n}</span>`).join("");
  return `<div class="skp" data-skp="${dark ? "dark" : "light"}" aria-hidden="true" style="${previewStyle(draftSkin(), dark)}">
    <div class="skp-top"><b>Kurssikaveri</b><span class="skp-tabs"><span class="on">Tänään</span><span>Kalenteri</span><span>Kurssit</span></span></div>
    <div class="skp-body">
      <div class="skp-next"><small>Seuraava määräaika</small><strong>5 tuntia</strong>
        <span class="skp-task">${dot(5)}Kurssi 5: Harjoitus 4</span><span class="skp-btn">Avaa Moodlessa</span></div>
      <div class="skp-list"><small>Muut</small>
        <span class="skp-item"><span>${dot(1)}Laboraatio 3</span><small>3 pv</small></span>
        <span class="skp-item"><span>${dot(3)}Sivuston runko</span><small>6 pv</small></span>
        <span class="skp-link">Näytä 7 seuraavaa</span></div>
    </div>
    <div class="skp-courses">${courses}</div>
    ${dark ? "" : `<div class="skp-moodle" style="background:var(--k5-bg);color:var(--k5-ink)"><b>Moodle-palkki</b><span class="skp-new">Uusi</span><span class="skp-soon">Tänään</span><span class="skp-btn">Tallenna tämän välilehden (3)</span></div>`}
  </div>`;
}

function renderEditor() {
  const issues = skinIssues(draftSkin());
  const status = issues.length === 0
    ? `<div class="ske-status ok" role="status">${icon("check")}<div><b>Luettavuus kunnossa.</b> Teksti erottuu kaikista taustoista vaaleassa ja tummassa teemassa.</div></div>`
    : issues.map(issue => `<div class="ske-status warn" role="alert">${icon("warning")}<div><b>${issue.text}</b>
        ${issue.fix ? `<div class="ske-fix"><button class="btn2" type="button" data-action="ske-fix" data-field="${issue.field}" data-value="${issue.fix}">${issue.action}</button></div>` : ""}</div></div>`).join("");
  return `
    <div class="set-page ske-page">
      <button class="link ske-back" type="button" data-action="ske-cancel">‹ Asetukset</button>
      <div class="set-head"><h1>${editor.id ? "Muokkaa värimaailmaa" : "Oma värimaailma"}</h1></div>
      <p class="ske-lead">Valitse kolme väriä ja kurssivärien sävy. Kurssikaveri laskee loput värit ja tumman teeman niistä.</p>
      <div class="ske">
        <div class="ske-form">
          <div class="ske-name"><label class="rt" for="ske-name">Nimi</label>
            <input class="input" id="ske-name" type="text" maxlength="30" autocomplete="off" value="${escapeHtml(editor.name)}"></div>
          ${colorRow("base", "Pohja", "Sivun tausta. Kortit, viivat ja tekstin väri lasketaan tästä.")}
          ${colorRow("accent", "Pääväri", "Yläpalkki, painikkeet, linkit ja valinnat.")}
          ${colorRow("warn", "Huomioväri", "Määräaika tänään.")}
          <div class="ske-tone"><span class="rt">Kurssivärit</span>
            <div class="rd">Seitsemän väriä pysyy samoina kursseilla. Valitse niiden sävy.</div>
            ${choice("ske-tone", TONES, editor.tone, "Kurssivärien sävy")}</div>
          ${status}
          <div class="ske-acts">
            <button class="btn2 primary" type="button" data-action="ske-save" ${issues.length ? "disabled" : ""}>Tallenna</button>
            <button class="btn2" type="button" data-action="ske-cancel">Peruuta</button>
            ${editor.id ? (editor.confirmDelete
              ? `<span class="confirm" role="alert">Poistetaanko värimaailma?</span>
                 <button class="btn2 danger solid" type="button" data-action="ske-delete-yes">Poista</button>
                 <button class="btn2" type="button" data-action="ske-delete-no">Älä poista</button>`
              : `<button class="btn2 danger ske-del" type="button" data-action="ske-delete">Poista…</button>`) : ""}
          </div>
          ${issues.length ? `<p class="ske-note">Tallenna-painike on käytössä, kun luettavuus on kunnossa.</p>` : ""}
        </div>
        <div class="ske-previews">
          <h2 class="set-sub">Esikatselu · vaalea</h2>${skinPreviewBox(false)}
          <h2 class="set-sub">Esikatselu · tumma (lasketaan automaattisesti)</h2>${skinPreviewBox(true)}
        </div>
      </div>
    </div>`;
}

// Esikatselu päivitetään paikallaan värin valinnan aikana (sivua ei piirretä uudelleen, jotta värinvalitsin pysyy auki)
function updatePreview(root) {
  root.querySelectorAll("[data-skp]").forEach(box => box.setAttribute("style", previewStyle(draftSkin(), box.dataset.skp === "dark")));
  root.querySelectorAll("[data-hex]").forEach(code => { code.textContent = editor[code.dataset.hex].toUpperCase(); });
}

function folderBox(name, sub) {
  return `<div class="foldbox">${icon("folder", { className: "fic" })}<div><b>${escapeHtml(name)}</b><small>${escapeHtml(sub)}</small></div></div>`;
}

// ---------- näkymä ----------

const THEME_LABELS = { system: "Järjestelmän mukaan", light: "Vaalea", dark: "Tumma" };

function hostOf(url) {
  try { return new URL(url).host; } catch (e) { return url || "–"; }
}

function obsidianSummary(s) {
  const o = s.obsidian;
  if (s.storage !== "folder") return "Tarvitsee oman opintokansion";
  if (!o.enabled) return "Ei käytössä";
  if (!o.vault) return "Käyttöönotto kesken";
  if (o.prefix || o.path) return `Aiempi holvikytkentä · ${o.vault}`;
  if (vaultFolder.present === false) return "Holvi puuttuu · valmistele uudelleen";
  return `Holvi valmisteltu · ${o.vault}`;
}

const OBS_BUTTONS_DESC = "Näyttää Avaa Obsidianissa -painikkeet kurssisivulla ja tallennetuissa teksteissä. Pois kytkeminen piilottaa ne; holvi ja tiedostot säilyvät.";

function obsidianSettings(s) {
  const o = s.obsidian;
  if (s.storage !== "folder") return row("Obsidian tarvitsee oman opintokansion",
    "Latauskansiotilassa Kurssikaveri ei voi valmistella holvia. Voit silti lukea tallennettuja Markdown-tiedostoja muilla ohjelmilla.", "");
  if (o.vault && (o.prefix || o.path)) {
    return row("Aiempi holvikytkentä", `Holvi ${escapeHtml(o.vault)}. Aiemmin määritetty kytkentä säilyy toimivana; opintokansiota ei siirretä eikä sen sisälle luoda toista holvia.`, "")
      + (o.enabled
        ? row("Avaa Obsidianissa -painikkeet", OBS_BUTTONS_DESC, toggle("obs-enabled", true), "obs-enabled")
        : row("Obsidian ei ole käytössä", "", `<button class="btn2 primary" type="button" data-action="obs-setup">Ota Obsidian käyttöön</button>`));
  }
  const configured = Boolean(o.vault) && !o.prefix && !o.path;
  const ready = o.enabled && configured && vaultFolder.present !== false;
  const action = o.enabled && configured ? "Valmistele holvi uudelleen" : "Ota Obsidian käyttöön";
  const folderName = s.folderName || vaultFolder.name || "Opintokansio";
  let html;
  if (ready) {
    // Valmis holvi: kansio ja kokeilupainike samalla rivillä. Kansion nimi näkyy jo kansiolaatikossa.
    html = `<div class="srow srow-wide">
      <div><span class="rt">Opintokansio on Obsidian-holvi</span>
        <div class="rd">Kurssit ja tallennetut tekstit pysyvät samoissa kansioissa. Holvin nimi on kansion nimi.</div></div>
      <div class="rc obs-ready">${folderBox(folderName, "Opintokansio")}
        <a class="btn2" href="${escapeHtml(obsidianUrl(s, "Opinnot.md"))}">Kokeile: avaa Opinnot.md</a></div>
    </div>`;
  } else {
    html = `<div class="srow srow-wide">
      <div><span class="rt">${escapeHtml(obsidianSummary(s))}</span>
        <div class="rd">Nykyinen opintokansiosi toimii Obsidian-holvin juurena. Kurssit ja tallennetut tekstit pysyvät samoissa kansioissa.</div></div>
      ${folderBox(folderName, "Opintokansio")}
      <div class="rc"><button class="btn2 primary" type="button" data-action="obs-setup" ${preparingObsidian ? "disabled" : ""}>${preparingObsidian ? "Valmistellaan holvia…" : action}</button></div>
      <div class="rd">Valmistelee nykyisen kansion holviksi ja määrittää avauspainikkeet. Obsidian-sovellus täytyy olla asennettuna tietokoneelle.</div>
    </div>`;
  }
  if (vaultFolder.error) html += `<div class="notice error" role="alert">Holvia ei voitu tarkistaa: ${escapeHtml(vaultFolder.error)}</div>`;
  if (o.enabled && configured) {
    // Kertaluonteinen ohje avattavana; auki heti valmistelun jälkeen, kun se on seuraava vaihe.
    html += `<details class="srow srow-wide obs-guide"${guideOpen ? " open" : ""}><summary class="rt">Ohje: avaa kansio Obsidianissa</summary>
      ${obsidianInstructions(o.vault, { compact: true })}
      <p class="rd">Vinkki: PowerPointit ja Excelit saa näkyviin Obsidianin tiedostolistaan Obsidianin asetuksesta <i>Files and links › Detect all file extensions</i>.</p>
    </details>`;
  }
  if (o.enabled) {
    html += row("Avaa Obsidianissa -painikkeet", OBS_BUTTONS_DESC, toggle("obs-enabled", true), "obs-enabled");
    if (configured) html += row("Näytä videot upotettuina", "Kurssille tallennetut YouTube-videot näkyvät Kurssin tiedot.md:ssä soittimena.", toggle("obs-embed", o.embedVideos), "obs-embed");
  }
  return html;
}

async function setupObsidian(ctx) {
  if (preparingObsidian) return;
  preparingObsidian = true;
  ctx.render();
  try {
    if (await folder.requestPermission() !== "granted") throw new Error("Kurssikaveri tarvitsee luvan opintokansioon. Anna lupa ja yritä uudelleen.");
    await withLock(async () => {
      const { settings } = await loadAll();
      const obsidian = await prepareObsidian(folder, settings);
      await save({ settings: { ...settings, obsidian } });
      vaultFolder = { name: obsidian.vault, present: obsidian.prefix || obsidian.path ? null : true, error: "" };
      permission = "granted";
      guideOpen = true;
    });
    await ctx.refresh();
    ctx.showMessage("ok", ctx.data.settings.obsidian.prefix || ctx.data.settings.obsidian.path
      ? "Aiemman holvin Obsidian-painikkeet otettu käyttöön. Tallennuspaikka säilyi ennallaan."
      : "Holvi on valmisteltu. Avaa nykyinen opintokansiosi vielä Obsidianissa alla olevan ohjeen mukaan.");
  } finally {
    preparingObsidian = false;
    ctx.render();
  }
}

// Kieleke ja kansi ovat sama painike. Kansion sisällä olevat asetukset toimivat erikseen.
function fold(id, name, iconName, summary, body, index) {
  const open = openFold === id;
  return `
    <section class="fold sfold${index === 0 ? " first" : ""}${open ? " open" : ""}" aria-labelledby="sf-title-${id}">
      <span class="back" aria-hidden="true"></span>
      <button class="sf-cover" type="button" id="sf-${id}" data-action="fold" data-id="${id}"
        aria-labelledby="sf-title-${id}" aria-describedby="sf-summary-${id}" aria-expanded="${open}" aria-controls="sf-body-${id}">
        <span class="ftab">${icon(iconName)}<span id="sf-title-${id}">${name}</span></span>
        <span class="sf-face"><span id="sf-summary-${id}">${escapeHtml(summary)}</span>${icon("chevron")}</span>
      </button>
      <div class="fbody" id="sf-body-${id}"${open ? "" : " hidden"}>${open ? body : ""}</div>
    </section>`;
}

export function render(ctx) {
  if (editor) return renderEditor();
  const s = ctx.data.settings;
  const o = s.obsidian;
  const inFolder = s.storage === "folder";

  // Ennen käyttöönottoa (myös tietojen poiston jälkeen) asetuksissa on vain oletusarvot, ei valittua paikkaa.
  const chosen = Boolean(s.onboarded);
  const storageControl = !chosen
    ? `<button class="btn2 primary" type="button" data-action="onboarding">Avaa aloitusopas</button>`
    : inFolder
    ? `${folderBox(s.folderName || "–", o.enabled && o.vault ? "Oma kansio · Obsidian-holvi" : "Oma kansio")}
       ${permission === "granted"
         ? `<span class="okpill">${icon("check")}Lupa voimassa</span>`
         : permission === "unknown" ? "" : `<button class="btn2" type="button" data-action="grant">Anna lupa</button>`}`
    : `${folderBox(`Downloads/${s.rootFolder}`, "Latauskansio")}`;

  const tallennus = `
    ${chosen
      ? row("Tallennuspaikka", `Kaikki kurssien tiedostot tallentuvat tähän kansioon. Tallennuspaikkaa ei voi vaihtaa käyttöönoton jälkeen.${inFolder
          ? " Näkyvissä on valitsemasi kansion nimi. Chrome ei näytä lisäosalle koko polkua." : ""}`, storageControl)
      : row("Tallennuspaikkaa ei ole valittu", "Valitse aloitusoppaassa kansio, johon Kurssikaveri tallentaa kurssien tiedostot.", storageControl)}
    ${row("Materiaalien järjestys kurssin kansiossa",
      `Valinta koskee kaikkien kurssien uusia tallennuksia. Aiemmat tiedostot säilyvät nykyisissä kansioissaan.`,
      choice("set-organize", Object.entries(ORGANIZE_LABELS), s.organizeBy, "Materiaalien järjestys"))}
    ${row("Ilmoitus Moodlen tavallisista latauksista", "Kun lataat tiedoston Moodlesta ilman Kurssikaverin Tallenna-painiketta, Kurssikaveri siirtää sen kurssikansioon. Windowsin ilmoitus kertoo, minne tiedosto meni.", toggle("set-notify", s.notifications), "set-notify")}`;

  const moodle = `
    ${row("Moodlen osoite", `Kurssikaveri hakee kurssit ja määräajat osoitteesta <span class="path">${escapeHtml(MOODLE_URL)}</span>.`, "")}
    ${row("Kurssikaveri-palkki Moodlessa", "Näyttää Tallenna-painikkeet ja uusien merkit Moodlen kurssisivuilla.", toggle("set-buttons", s.moodleButtons !== false), "set-buttons")}`;

  const ulkoasu = `
    ${row("Teema", "Yläpalkin kuu/aurinko vaihtaa nopeasti vaalean ja tumman välillä.",
      choice("set-theme", [["system", "Järjestelmän mukaan"], ["light", "Vaalea"], ["dark", "Tumma"]], s.theme, "Teema"))}
    <div class="srow srow-wide"><div><span class="rt">Värimaailma</span>
      <div class="rd">Sama värimaailma näkyy myös Moodlen Kurssikaveri-palkissa.</div></div>
      <div class="rc">${skinChoice(s)}</div></div>
    ${row("Näytä pikkukalenteri Tänään-sivulla", "Kuukauden kalenteri määräaikojen vieressä. Määräaikojen päivät on merkitty, ja kalenteria painamalla avautuu Kalenteri-sivu.",
      toggle("set-home-calendar", s.showHomeCalendar), "set-home-calendar")}
    ${row("Näytä ponnahdusikkunassa ensin", "Kumpi näkyy ponnahdusikkunassa ylempänä. Molemmat näkyvät, kun ne ovat käytettävissä.",
      choice("set-popup-first", [["deadline", "Määräaika"], ["save", "Tallennus"]], s.popupFirst === "save" ? "save" : "deadline", "Ponnahdusikkunan ensimmäinen osio"))}`;

  const obsidian = obsidianSettings(s);

  const tiedot = `
    ${row("Missä tiedot ovat", inFolder
      ? `Kurssit, omat merkinnät ja asetukset ovat tämän selaimen muistissa, ja ne kopioidaan talteen opintokansioon (<span class="path">${BACKUP_PATH}</span>). Kurssikaveri ottaa yhteyttä ainoastaan Moodleen.`
      : "Kurssit, omat merkinnät ja asetukset ovat vain tämän selaimen muistissa. Kurssikaveri ottaa yhteyttä ainoastaan Moodleen.", "")}
    ${row("Palauta oletusasetukset", "Ulkoasu, materiaalien järjestys, ilmoitukset ja Moodle-palkki palaavat oletuksiin. Tallennuspaikka, Obsidian-holvi, kurssit ja omat värimaailmat säilyvät.", `<button class="btn2" type="button" data-action="defaults">Palauta</button>`)}
    ${row("Poista kaikki Kurssikaverin tiedot", "Kurssit, omat merkinnät ja asetukset poistetaan, myös opintokansioon talteen kirjoitetut. Tallennetut tiedostot jäävät koneellesi.",
      confirmClear
        ? `<span class="confirm" role="alert">Poistetaanko varmasti?</span>
           <button class="btn2 danger solid" type="button" data-action="clear-yes">Poista pysyvästi</button>
           <button class="btn2" type="button" data-action="clear-no">Peruuta</button>`
        : `<button class="btn2 danger" type="button" data-action="clear">Poista tiedot…</button>`)}`;

  const place = !chosen ? "Ei valittu" : inFolder ? (s.folderName || "–") : `Downloads/${s.rootFolder}`;
  const folds = [
    ["tallennus", "Tallennus", "folder", [place, ORGANIZE_LABELS[s.organizeBy] || ORGANIZE_LABELS.topic].join(" · "), tallennus],
    ["moodle", "Moodle", "link", `${hostOf(MOODLE_URL)} · palkki ${s.moodleButtons !== false ? "päällä" : "pois"}`, moodle],
    ["ulkoasu", "Ulkoasu", "sun", `${THEME_LABELS[s.theme] || THEME_LABELS.system} · ${getSkin(s).name}`, ulkoasu],
    ["obsidian", "Obsidian", "page", obsidianSummary(s), obsidian],
    ["tiedot", "Tiedot", "file", "Oletusasetukset ja tietojen poisto", tiedot]
  ];

  return `
    <div class="set-page">
      <div class="set-head">
        <h1>Asetukset</h1>
        <span class="saved" role="status">${icon("check")}${savedFlash ? "Tallennettu" : "Muutokset tallentuvat heti"}</span>
      </div>
      ${ctx.state.message ? `<div class="notice ${ctx.state.message.kind}">${escapeHtml(ctx.state.message.text)}</div>` : ""}

      <div class="pile spile">
        ${folds.map((fields, i) => fold(...fields, i)).join("")}
      </div>
    </div>`;
}

async function change(ctx, changes) {
  await saveSettings(changes);
  savedFlash = true;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { savedFlash = false; if (ctx.state.view === "settings") ctx.render(); }, 2000);
}

function clearData() {
  return withLock(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.clear();
    const unconfirmed = [];
    if (settings?.storage === "folder") {
      for (const path of [BACKUP_PATH, BACKUP_OLD_PATH]) {
        try { await folder.removeFile(path); }
        catch (error) { if (error.name !== "NotFoundError") unconfirmed.push(path); }
      }
    }
    return unconfirmed;
  });
}

export function bind(root, ctx) {
  // Obsidian-ohjeen auki/kiinni-tila säilyy, kun asetusten muutos piirtää sivun uudelleen
  // (toggle-tapahtuma ei kupli, joten se otetaan kiinni sieppausvaiheessa)
  root.addEventListener("toggle", event => {
    if (event.target.classList?.contains("obs-guide")) guideOpen = event.target.open;
  }, true);
  // Luvan tila haetaan erikseen (asynkroninen), ja näkymä piirretään uudelleen, jos se muuttui
  if (!editor && ctx.data.settings.storage === "folder") {
    (async () => {
      const state = await folder.permissionState();
      let next = { name: "", present: null, error: "" };
      if (state === "granted") {
        try {
          const handle = await folder.getStudyRoot();
          next = { name: handle.name, present: await folder.isObsidianVault(handle), error: "" };
        } catch (error) { next.error = error.message; }
      }
      const changed = state !== permission || JSON.stringify(next) !== JSON.stringify(vaultFolder);
      permission = state;
      vaultFolder = next;
      if (changed && ctx.state.view === "settings") ctx.render();
    })().catch(error => ctx.showMessage("error", error.message));
  }

  // Muokkain: nimi ja värit päivittyvät kirjoittaessa ja väriä valitessa
  root.addEventListener("input", event => {
    const t = event.target;
    if (!editor) return;
    if (t.id === "ske-name") editor.name = t.value;
    else if (t.classList.contains("ske-color")) { editor[t.id.replace("ske-", "")] = t.value; updatePreview(root); }
  });

  root.addEventListener("change", async event => {
    const t = event.target;
    const { checked, value } = t;
    try {
      switch (t.id || t.name) {
        case "set-notify": await change(ctx, { notifications: t.checked }); break;
        case "set-buttons": await change(ctx, { moodleButtons: t.checked }); break;
        case "set-organize": await change(ctx, { organizeBy: t.value }); break;
        case "set-home-calendar": await change(ctx, { showHomeCalendar: checked }); break;
        case "set-popup-first": await change(ctx, { popupFirst: value === "save" ? "save" : "deadline" }); break;
        case "set-theme": await change(ctx, { theme: t.value }); break;
        case "set-skin": await change(ctx, s => ({ skin: getSkin({ ...s, skin: value }).id })); break;
        // Muokkain: kun värinvalitsin suljetaan tai sävy vaihtuu, piirretään uudelleen (luettavuus ja painikkeet)
        case "ske-base": case "ske-accent": case "ske-warn": if (editor) ctx.render(); break;
        case "ske-tone": if (editor) { editor.tone = t.value; ctx.render(); } break;
        case "obs-enabled":
          await change(ctx, s => ({ obsidian: { ...s.obsidian, enabled: checked } }));
          if (!checked) ctx.showMessage("ok", "Obsidian-painikkeet poistettu käytöstä. Holvi, kurssit ja tallennetut tiedostot säilyvät.");
          break;
        case "obs-embed": await change(ctx, s => ({ obsidian: { ...s.obsidian, embedVideos: checked } })); break;
      }
    } catch (error) {
      ctx.showMessage("error", error.message);
    }
  });

  root.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    try {
      switch (button.dataset.action) {
        case "obs-setup": await setupObsidian(ctx); break;
        case "fold": {
          // Sama kansio sulkee, toinen avaa (edellinen sulkeutuu). Kohdistus pysyy kansion rivillä.
          const id = button.dataset.id;
          openFold = openFold === id ? null : id;
          confirmClear = false;
          ctx.render();
          const head = document.getElementById(`sf-${id}`);
          if (head) head.focus({ preventScroll: true });
          break;
        }
        case "grant": {
          const note = grantNote(await grantFolderPermission());
          permission = "granted";
          ctx.showMessage(note.kind, note.text);
          break;
        }
        case "onboarding": chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }); break;
        case "defaults": {
          await updateData("settings", ({ settings: s }) => ({
            settings: { ...DEFAULT_SETTINGS, onboarded: true, storage: s.storage, folderName: s.folderName,
              rootFolder: s.rootFolder, obsidian: s.obsidian, backupId: s.backupId, customSkins: customSkins(s) }
          }));
          ctx.showMessage("ok", "Oletusasetukset palautettu. Tallennuspaikka ja Obsidian-holvi säilyivät.");
          break;
        }
        case "skin-new": {
          const from = getSkin(ctx.data.settings); // lähtöarvoiksi nykyinen värimaailma
          editor = { id: null, name: "Oma värimaailma", base: from.base, accent: from.accent, warn: from.warn, tone: from.tone, confirmDelete: false };
          ctx.render(); window.scrollTo(0, 0);
          break;
        }
        case "skin-edit": {
          const skin = customSkins(ctx.data.settings).find(c => c.id === button.dataset.id);
          if (skin) { editor = { ...skin, original: skin, confirmDelete: false }; ctx.render(); window.scrollTo(0, 0); }
          break;
        }
        case "ske-cancel": editor = null; ctx.render(); break;
        case "ske-fix": editor[button.dataset.field] = button.dataset.value; ctx.render(); break;
        case "ske-save": {
          const draft = editor;
          const skin = cleanSkin({ ...draftSkin(), id: editor.id || newId("oma-") });
          if (!skin || skinIssues(skin).length > 0) break;
          await change(ctx, s => {
            const list = customSkins(s);
            if (draft.original) {
              const current = list.find(c => c.id === skin.id);
              if (!current) throw new Error("Värimaailma on jo poistettu.");
              if (Object.keys(current).some(key => current[key] !== draft.original[key])) {
                throw new Error("Värimaailma muuttui toisessa välilehdessä. Avaa se uudelleen ennen tallennusta.");
              }
            }
            const next = draft.original ? list.map(c => c.id === skin.id ? skin : c) : [...list, skin];
            return { customSkins: next, skin: skin.id };
          });
          if (editor === draft) { editor = null; ctx.render(); }
          break;
        }
        case "ske-delete": editor.confirmDelete = true; ctx.render(); break;
        case "ske-delete-no": editor.confirmDelete = false; ctx.render(); break;
        case "ske-delete-yes": {
          const id = editor.id;
          editor = null;
          await change(ctx, s => ({ customSkins: customSkins(s).filter(c => c.id !== id),
            ...(s.skin === id ? { skin: DEFAULT_SKIN } : {}) }));
          break;
        }
        case "clear": confirmClear = true; ctx.render(); break;
        case "clear-no": confirmClear = false; ctx.render(); break;
        case "clear-yes": {
          confirmClear = false;
          button.disabled = true;
          if (ctx.data.settings.storage === "folder") {
            try { await folder.requestPermission(); } catch (error) { /* poistoyritys tarkistaa luvan uudelleen */ }
          }
          const unconfirmed = await clearData();
          if (unconfirmed.length) {
            ctx.showMessage("error", `Tiedot poistettiin selaimesta. Kaikkien varmuuskopioiden poistoa ei voitu vahvistaa. Tarkista opintokansiosta ${unconfirmed.join(" ja ")} ja poista mahdollisesti jäljellä olevat varmuuskopiot käsin. Tallennetut kurssitiedostot jäivät koneellesi.`);
          } else {
            ctx.showMessage("ok", "Tiedot poistettu. Tallennetut tiedostot jäivät koneellesi. Aloita uudelleen aloitusoppaasta.");
          }
          break;
        }
      }
    } catch (error) {
      ctx.showMessage("error", error.message);
    }
  });
}
