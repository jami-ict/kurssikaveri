// library.js – Kurssikaverin pääsivun runko: navigaatio ja näkymien vaihto.
//
// Näkymät:
//   Tänään    (views/homeView.js)    mitä on uutta, mitä pitää tehdä, mikä vaatii huomiota
//   Kalenteri (views/calendarView.js) määräajat ja omat merkinnät kuukausinäkymässä
//   Kurssit   (views/coursesView.js) kurssilista, haku, tuonti Moodlesta
//   Kurssi    (views/courseView.js)  yhden kurssin tiedostot, linkit, videot ja määräajat
//   Asetukset (views/settingsView.js)
//
// Periaate:
//   1. data muuttuu (tallennustila päivittyy)
//   2. render() piirtää valitun näkymän uudelleen
// Jokaisella näkymällä on kaksi funktiota:
//   render(ctx) → palauttaa HTML:n
//   bind(root, ctx) → liittää painikkeisiin toiminnot

import { loadAll, saveSettings } from "./shared/store.js";
import { attentionCount, existsMap, refreshMoodle } from "./shared/ui.js";
import * as homeView from "./views/homeView.js";
import * as coursesView from "./views/coursesView.js";
import * as courseView from "./views/courseView.js";
import * as settingsView from "./views/settingsView.js";
import * as calendarView from "./views/calendarView.js";
import { icon } from "./shared/icons.js";

const VIEWS = { home: homeView, calendar: calendarView, courses: coursesView, "courses-unsaved": coursesView, "courses-unchecked": coursesView, course: courseView, settings: settingsView };
const NAV_OF = { home: "home", calendar: "calendar", courses: "courses", "courses-unsaved": "courses", "courses-unchecked": "courses", course: "courses", settings: "settings" };

// Sivun tila, joka ei tallennu (häviää, kun sivu suljetaan)
const state = {
  view: "home",
  courseId: null,       // avoin kurssi (Kurssi-näkymä)
  fixId: null,          // tiedosto, joka korostetaan Vaatii huomiota -osiossa
  search: "",           // Kurssit-näkymän haku
  courseTab: "active",
  itemFilter: "all",    // kurssisivulla: all | files | links
  drafts: {},           // käyttäjän keskeneräiset valinnat korteissa
  importRows: null,     // Moodle-tuonnin esikatselu
  importError: "",
  importBusy: false,
  addCourseOpen: false,
  message: null         // { kind: "ok" | "error", text }
};

let data = null;
let exists = {};

// Kun kenttä, jossa kohdistus on, poistetaan sivulta uudelleenpiirrossa, selain lähettää sille change- ja
// blur-tapahtumat. Ne eivät ole käyttäjän tekemiä, joten ne pysäytetään ennen kuin näkymät ehtivät käsitellä niitä
// (muuten esim. kesken oleva Moodlen osoite tallentuisi puolivalmiina).
let replacing = false;
for (const type of ["change", "blur", "focusout"]) {
  window.addEventListener(type, event => { if (replacing) event.stopImmediatePropagation(); }, true);
}

const ctx = {
  state,
  get data() { return data; },
  get exists() { return exists; },
  refresh,                           // hae data uudelleen ja piirrä
  render,                            // piirrä nykyisellä datalla
  setView(view, extra = {}) {
    Object.assign(state, { view, message: null }, extra);
    const hash = view === "course" ? `course=${state.courseId}` : view;
    history.pushState(null, "", `#${hash}`);
    render();
    window.scrollTo(0, 0);
  },
  openCourse(courseId) { ctx.setView("course", { courseId, itemFilter: "all" }); },
  showMessage(kind, text) { state.message = { kind, text }; render(); }
};

async function refresh() {
  data = await loadAll();
  exists = await existsMap();
  render();
}

function render() {
  if (!data) return;
  document.querySelectorAll(".navtab").forEach(button => {
    const on = button.dataset.view === NAV_OF[state.view];
    button.classList.toggle("active", on);
    if (on) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  updateThemeToggle();
  const count = attentionCount(data, exists);
  const badge = document.getElementById("attention-count");
  badge.textContent = count;
  badge.style.display = count > 0 ? "" : "none";
  badge.title = `${count} vaatii huomiota`;

  // Muistetaan, missä kentässä kursori oli, jotta kirjoittaminen ei keskeydy päivityksessä
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const caret = focusId && typeof active.selectionStart === "number" ? active.selectionStart : null;
  // Kesken oleva kirjoitus: kentän teksti on muuttunut edellisen piirron jälkeen. Se palautetaan piirron jälkeen,
  // jotta taustalla tapahtuva päivitys (esim. määräaikojen haku) ei hävitä kirjoitettua.
  const typed = focusId && "defaultValue" in active && active.value !== active.defaultValue ? active.value : null;

  // Uusi <main>-elementti joka piirrolla: vanhan tapahtumankuuntelijat eivät kerry
  const view = VIEWS[state.view] || homeView;
  const oldMain = document.getElementById("main");
  const main = oldMain.cloneNode(false);
  main.innerHTML = view.render(ctx);
  replacing = true;
  try { oldMain.replaceWith(main); } finally { replacing = false; }
  view.bind(main, ctx);

  // Tallennusikkunan linkki vie suoraan kurssin Omiin tallennuksiin.
  if (state.openSavedTexts) {
    state.openSavedTexts = false;
    const heading = main.querySelector('#course-saved-texts');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }

  if (focusId) {
    const again = document.getElementById(focusId);
    if (again) {
      if (typed !== null && again.tagName === active.tagName && again.value !== typed) {
        again.value = typed;
        // Selain ei pidä ohjelmallisesti palautettua tekstiä käyttäjän muutoksena. Jos käyttäjä poistuu kentästä
        // kirjoittamatta lisää, change-tapahtuma lähetetään itse, jotta muutos tallentuu.
        let changed = false;
        again.addEventListener("change", () => { changed = true; }, { once: true });
        again.addEventListener("blur", () => {
          if (!changed && again.isConnected) again.dispatchEvent(new Event("change", { bubbles: true }));
        }, { once: true });
      }
      again.focus();
      if (caret !== null && typeof again.setSelectionRange === "function") {
        try { again.setSelectionRange(caret, caret); } catch (e) { /* esim. select-kenttä */ }
      }
    }
  }
}

// Osoitteen #-osa kertoo, mikä näkymä avataan: #home, #calendar, #calendar=2026-11-12, #courses, #course=abc, #import, #fix=123
function readHash() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("fix=")) {
    state.view = "home";
    state.fixId = hash.slice(4);
  } else if (hash.startsWith("calendar=")) {
    state.view = "calendar";
    state.calDate = /^\d{4}-\d{2}-\d{2}$/.test(hash.slice(9)) ? hash.slice(9) : null;
  } else if (hash.startsWith("course-saved=")) {
    state.view = "course";
    state.courseId = decodeURIComponent(hash.slice(13));
    state.itemFilter = "all";
    state.openSavedTexts = true;
  } else if (hash.startsWith("course=")) {
    state.view = "course";
    state.courseId = decodeURIComponent(hash.slice(7));
    state.itemFilter = "all";
  } else if (hash === "import") {
    state.view = "courses";
    state.autoImport = true;
  } else if (["library", "attention"].includes(hash)) {
    state.view = "home";       // versio 0.3:n osoitteet
  } else if (hash === "links") {
    state.view = "courses";
  } else if (VIEWS[hash]) {
    if (hash === "courses" && ["courses-unsaved", "courses-unchecked"].includes(state.view)) state.search = "";
    state.view = hash;
  }
}

document.querySelectorAll(".navtab").forEach(button => {
  button.addEventListener("click", () => ctx.setView(button.dataset.view));
});

// Teemapainike yläpalkissa: vaihtaa vaalean ja tumman välillä ja tallentaa valinnan asetuksiin.
// ("Järjestelmän mukaan" valitaan Asetuksista.) Kuu = vaihda tummaan, aurinko = vaihda vaaleaan.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function currentTheme() {
  return document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");
}
function updateThemeToggle() {
  const button = document.getElementById("theme-toggle");
  const dark = currentTheme() === "dark";
  const label = dark ? "Vaihda vaaleaan teemaan" : "Vaihda tummaan teemaan";
  button.innerHTML = icon(dark ? "sun" : "moon");
  button.title = label;
  button.setAttribute("aria-label", label);
}
document.getElementById("theme-toggle").addEventListener("click", async () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;   // heti näkyviin, tallennus perässä
  updateThemeToggle();
  await saveSettings({ theme: next });
});
darkQuery.addEventListener("change", updateThemeToggle);
// theme.js voi vaihtaa teeman myöhemmin (esim. Asetuksista valittu "Järjestelmän mukaan")
new MutationObserver(updateThemeToggle).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
updateThemeToggle();

window.addEventListener("popstate", () => { state.message = null; readHash(); render(); });
window.addEventListener("hashchange", () => { state.message = null; readHash(); render(); });

// Kun taustaskripti tallentaa uuden tiedoston tai määräajat päivittyvät, piirretään uudelleen.
// Muutokset, jotka eivät näy sivuilla (Moodle-sivujen selaushistoria), eivät piirrä sivua uudelleen.
const SILENT_KEYS = ["pageCourses", "lastMoodle", "sync"];
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (Object.keys(changes).every(key => SILENT_KEYS.includes(key))) return;
  refresh();
});

// Aloitusoppaan jälkeen (#start): ilman kursseja suoraan Moodle-tuonnin esikatseluun,
// varmuuskopiosta palautetuilla kursseilla Tänään-sivulle.
const afterSetup = location.hash === "#start";
if (afterSetup) {
  const { courses } = await loadAll();
  history.replaceState(null, "", courses.length === 0 ? "#import" : "#home");
}
readHash();
refresh();
refreshMoodle({ force: afterSetup });
