// homeView.js – Tänään-sivu: mikä on seuraavaksi edessä ja mitä on uutta.
//
// Järjestys ylhäältä alas:
//   - päivitys- ja tallennuspainike oikeassa yläkulmassa (Päivitä Moodlesta / Tallenna N uutta)
//   - ilmoitukset: kirjautuminen, kansion lupa, kurssi päättyy / päättyi
//   - Seuraava määräaika isolla (kansio) + kuukauden pikkukalenteri
//   - Muut: seuraavat määräajat, 3 näkyvissä ja 7 lisää avattavissa
//   - Vaatii huomiota (views/attentionView.js) ja Uutta kursseilla, vain kun niissä on jotain
//
// Ison tekstin säännöt:
//   14 pv tai enemmän → täydet viikot, 2–13 pv → päivät, 1 → "Huomenna",
//   tänään → tunnit ja viimeisellä tunnilla minuutit. Viimeisenä päivänä kansio saa huomiovärin (--warn).

import { moodleBase } from "../shared/store.js";
import {
  escapeHtml, courseImportNotice, ask, attentionCount, grantFolderPermission, grantNote,
  saveCourseFiles, saveCourseLabel, savingCourses
} from "../shared/ui.js";
import { courseSummary, formatDay } from "../shared/status.js";
import { KINDS } from "../shared/contents.js";
import { icon } from "../shared/icons.js";
import { colorVars, postIt } from "../shared/colors.js";
import { upcomingEvents, dateKey, eventLabel } from "../shared/agenda.js";
import { renderSync, handleSync } from "../shared/syncbar.js";
import * as folder from "../shared/fsstore.js";
import * as attentionView from "./attentionView.js";

const DAY = 86400 * 1000;
const LIST_VISIBLE = 3;   // Muut-listassa näkyvissä aluksi
const LIST_MAX = 10;      // Muut-listassa enintään

const WEEKDAY_SHORT = ["su", "ma", "ti", "ke", "to", "pe", "la"];
const WEEKDAY_ON = ["sunnuntaina", "maanantaina", "tiistaina", "keskiviikkona", "torstaina", "perjantaina", "lauantaina"];
const MONTHS = ["Tammikuu", "Helmikuu", "Maaliskuu", "Huhtikuu", "Toukokuu", "Kesäkuu",
  "Heinäkuu", "Elokuu", "Syyskuu", "Lokakuu", "Marraskuu", "Joulukuu"];

// Sivun tila, joka ei tallennu
let permission = "unknown";
let showAll = false;       // Muut-lista auki
let ticker = null;         // minuuttipäivitys, kun määräaika on alle vuorokauden päässä

// ---------- apufunktiot ----------

function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayDiff(ms, now) { return Math.round((startOfDay(ms) - startOfDay(now)) / DAY); }
function clock(ms) { const d = new Date(ms); return `${d.getHours()}.${String(d.getMinutes()).padStart(2, "0")}`; }
function shortDate(ms) { return `${WEEKDAY_SHORT[new Date(ms).getDay()]} ${formatDay(ms)}`; }

// Iso teksti ja sen alle tuleva päiväys
function heroTiming(ms, now, allDay = false) {
  const days = dayDiff(ms, now);
  const at = allDay ? "" : ` klo ${clock(ms)}`;
  if (days >= 14) {
    const weeks = Math.floor(days / 7);
    return { big: `${weeks} viikkoa`, when: `${WEEKDAY_ON[new Date(ms).getDay()]} ${formatDay(ms)}${at}` };
  }
  if (days >= 2) return { big: `${days} päivää`, when: `${WEEKDAY_ON[new Date(ms).getDay()]} ${formatDay(ms)}${at}` };
  if (days === 1) return { big: "Huomenna", when: `${WEEKDAY_ON[new Date(ms).getDay()]} ${formatDay(ms)}${at}` };
  const minutes = Math.max(1, Math.floor((ms - now) / 60000));
  const hours = Math.floor(minutes / 60);
  return {
    big: hours >= 1 ? `${hours} ${hours === 1 ? "tunti" : "tuntia"}` : `${minutes} min`,
    when: allDay ? "tänään" : `tänään klo ${clock(ms)}`,
    today: true
  };
}

// Listan oikea sarake: "6 pv", "huomenna", "tänään", "myöhässä"
function leftLabel(ms, now) {
  if (ms < now) return "myöhässä";
  const days = dayDiff(ms, now);
  if (days === 0) return "tänään";
  if (days === 1) return "huomenna";
  return `${days} pv`;
}

function hero(data, now) {
  const next = upcomingEvents(data, now).find(e => e.time >= now);
  if (!next) {
    return `
      <section class="fld hero" aria-labelledby="hero-h">
        <span class="back" aria-hidden="true"></span>
        <span id="hero-h" class="ftab">Seuraava määräaika</span>
        <div class="fld-front">
          <div class="hero-big hero-big-sm">Ei tulossa</div>
          <div class="hero-t">Kursseillasi ei ole tulevia määräaikoja</div>
          <div class="hero-d">${data.deadlines.fetched ? "Voit lisätä puuttuvan päivän kalenteriin" : "Määräaikoja ei ole vielä haettu Moodlesta."}</div>
          <div class="hero-a"><a class="btn-hero" href="#calendar">Avaa kalenteri ${icon("arrow")}</a></div>
        </div>
      </section>`;
  }
  const t = heroTiming(next.time, now, next.allDay);
  const marker = next.source === "own" && !next.course ? postIt("pit") : `<span class="cdot" style="background:${colorVars(next.color).dot}" aria-hidden="true"></span>`;
  const action = next.source === "moodle"
    ? `<a class="btn-hero" href="${escapeHtml(next.url)}" target="_blank" rel="noopener">Avaa Moodlessa ${icon("external")}</a>`
    : `<a class="btn-hero" href="#calendar=${dateKey(next.time)}">Avaa kalenterissa ${icon("arrow")}</a>`;
  return `
    <section class="fld hero${t.today ? " soon" : ""}" aria-labelledby="hero-h">
      <span class="back" aria-hidden="true"></span>
      <span id="hero-h" class="ftab">Seuraava määräaika${t.today ? " · tänään" : ""}</span>
      <div class="fld-front">
        <div class="hero-big">${escapeHtml(t.big)}</div>
        <div class="hero-t">${marker}${escapeHtml(eventLabel(next))}</div>
        <div class="hero-d">${escapeHtml(t.when)}${next.source === "own" ? " · oma merkintä" : ""}</div>
        <div class="hero-a">${action}</div>
      </div>
    </section>`;
}

// Kaikki määräajat (myös menneet ja palautetut) pikkukalenteria varten
function upcomingEventsAll(data) {
  return upcomingEvents(data, 0, true);
}

// Kuukauden pikkukalenteri: päivä värjätään ensimmäisen määräajan kurssin värillä,
// useampi määräaika = +N, osoitin päivän päällä näyttää kaikki. Koko kalenteri on linkki Kalenteriin.
function miniCalendar(data, now) {
  const today = new Date(now);
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));                         // maanantai ennen 1. päivää
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7) - 1));    // sunnuntai kuun jälkeen

  const byDay = {};
  for (const e of upcomingEventsAll(data)) (byDay[startOfDay(e.time)] ||= []).push(e);
  const todayStart = startOfDay(now);

  let cells = "";
  for (let day = new Date(start), col = 0; day <= end; day.setDate(day.getDate() + 1), col = (col + 1) % 7) {
    const key = day.getTime();
    const items = (byDay[key] || []).sort((a, b) => a.time - b.time);
    const classes = ["md"];
    if (day.getMonth() !== today.getMonth()) classes.push("out");
    else if (key < todayStart) classes.push("gone");
    if (col >= 5) classes.push("we");
    if (col >= 4) classes.push("r");                                     // vihje avautuu vasemmalle
    if (key === todayStart) classes.push("today");
    let extra = "";
    if (items.length) {
      classes.push("has");
      if (key < todayStart) classes.push("past");
      if (items.every(e => e.done)) classes.push("done");                // kaikki palautettu: vinoviiva
      extra += items.some(e => e.source === "own") ? postIt("note") : "";
      extra += items.length > 1 ? `<span class="plus">+${items.length - 1}</span>` : "";
      extra += `<span class="tip" aria-hidden="true"><span class="tdh">${shortDate(key)}</span>${items.map(e =>
        `<span class="tr"><span class="cdot" style="background:${colorVars(e.color).dot}"></span><b>${escapeHtml(e.courseName || e.title)}</b> ${e.courseName ? escapeHtml(e.title) : ""}${e.done ? " · palautettu" : ""}${e.source === "own" ? " · oma merkintä" : ""}</span>`).join("")}</span>`;
    }
    const style = items.length ? ` style="background:${colorVars(items[0].color).bg}"` : "";
    cells += `<span class="${classes.join(" ")}"${style}><span class="n">${day.getDate()}</span>${extra}</span>`;
  }
  const month = `${MONTHS[today.getMonth()]}`;
  return `
    <section aria-labelledby="mini-h">
      <a class="minical" href="#calendar" title="Avaa kalenteri" aria-label="Avaa kalenteri, ${month.toLowerCase()} ${today.getFullYear()}">
        <span class="mini-h"><span id="mini-h" class="mini-title">${month}</span></span>
        <span class="mgrid">
          ${["ma", "ti", "ke", "to", "pe", "la", "su"].map(w => `<span class="mwd">${w}</span>`).join("")}
          ${cells}
        </span>
      </a>
    </section>`;
}

function otherDeadlines(data, now) {
  const all = upcomingEvents(data, now);
  const nextIndex = all.findIndex(e => e.time >= now);
  const items = all.filter((e, i) => i !== nextIndex).slice(0, LIST_MAX);
  if (items.length === 0) return "";
  const row = e => `
    <a class="drow" href="#calendar=${dateKey(e.time)}">
      <span class="dr-d">${shortDate(e.time)}</span>
      <span class="dr-c">${e.course || e.source === "moodle" ? `<span class="cdot" style="background:${colorVars(e.color).dot}"></span>${escapeHtml(e.courseName)}` : ""}</span>
      <span class="dr-t">${escapeHtml(e.title)}</span>
      <span class="dr-s">${e.source === "own" ? `<span class="dr-own">${postIt("pit")}Oma merkintä</span>` : `Moodle · klo ${clock(e.time)}`}</span>
      <span class="dr-l${e.time < now ? " late" : ""}">${leftLabel(e.time, now)}</span>
    </a>`;
  const hidden = items.length - LIST_VISIBLE;
  return `
    <section class="dlist" aria-labelledby="list-h">
      <h2 id="list-h">Muut</h2>
      ${items.slice(0, showAll ? LIST_MAX : LIST_VISIBLE).map(row).join("")}
      ${hidden > 0 ? `<button class="more-btn" type="button" data-action="toggle-more" aria-expanded="${showAll}">
        ${showAll ? "Näytä vähemmän" : `Näytä ${hidden} seuraavaa`} ${icon("chevron", { className: showAll ? "flip" : "" })}</button>` : ""}
    </section>`;
}

// Kurssi päättyi (ehdotus päättyneisiin) tai päättyy pian ja tiedostoja on tallentamatta
function endingCards(summaries) {
  let html = "";
  for (const { course, s } of summaries) {
    if (s.ended) {
      html += `
        <div class="card">
          <strong>${s.endedInMoodle ? `Moodle näyttää kurssin ${escapeHtml(course.name)} menneissä kursseissa.` : `${escapeHtml(course.name)} päättyi ${formatDay(course.end * 1000, true)}.`}</strong>
          Siirretäänkö se päättyneisiin?
          ${s.unsaved > 0 ? `<div class="muted">Kurssilla on vielä ${s.unsaved} tallentamatonta tiedostoa.</div>` : ""}
          <div class="actions">
            <button class="btn primary" data-action="complete" data-course="${course.id}">Siirrä päättyneisiin</button>
            <button class="btn" data-action="not-yet" data-course="${course.id}">Ei vielä</button>
            ${s.unsaved > 0 && s.content ? `<button class="btn" data-action="save-course" data-moodle="${course.moodleId}" ${savingCourses.has(course.moodleId) ? "disabled" : ""}>${saveCourseLabel(s, course.moodleId)}</button>` : ""}
          </div>
        </div>`;
    } else if (s.endingSoon && (s.unsaved > 0 || s.unknownFolders > 0)) {
      html += `
        <div class="card warn">
          <strong>${escapeHtml(course.name)} päättyy ${s.daysLeft === 1 ? "huomenna" : `${s.daysLeft} päivän päästä`} (${formatDay(course.end * 1000, true)}).</strong>
          <div>${s.unsaved ? `${s.unsaved} ${s.unsaved === 1 ? "tiedosto" : "tiedostoa"} on vielä tallentamatta. ` : ""}${s.unknownFolders ? "Osa Moodle-kansioista on vielä tarkistamatta. " : ""}Kurssin materiaalit voivat poistua näkyvistä kurssin päätyttyä.</div>
          <div class="actions">
            ${s.content ? `<button class="btn primary" data-action="save-course" data-moodle="${course.moodleId}" ${savingCourses.has(course.moodleId) ? "disabled" : ""}>${saveCourseLabel(s, course.moodleId)}</button>`
              : `<button class="btn primary" data-action="open-course-moodle" data-moodle="${course.moodleId}">Avaa Moodlessa</button>`}
            <button class="btn" data-action="open-course" data-course="${course.id}">Näytä kurssi</button>
          </div>
        </div>`;
    }
  }
  return html;
}

function newSection(summaries) {
  // Uudet kohteet ja Moodlessa vaihdetut (päivitetyt) tiedostot; uusin ensin
  const latest = s => Math.max(s.newItems.length ? s.newItems[0].firstSeen : 0, ...s.updated.map(d => d.update.found));
  const withNew = summaries.filter(x => x.s.newItems.length > 0 || x.s.updated.length > 0)
    .sort((a, b) => latest(b.s) - latest(a.s));
  if (withNew.length === 0) return "";
  return `
    <section class="dlist">
      <h2>Uutta kursseilla</h2>
      <div class="stack">${withNew.map(({ course, s }) => `
        <button class="item-row" data-action="open-course" data-course="${course.id}">
          ${s.newItems.length ? `<span class="tag new">${s.newItems.length} uutta</span>` : ""}
          ${s.updated.length ? `<span class="tag upd">${s.updated.length} päivitetty</span>` : ""}
          <span class="grow">
            <span class="name">${escapeHtml(course.name)}</span>
            <span class="muted small">${s.newItems.slice(0, 3).map(i => `${icon((KINDS[i.kind] || KINDS.activity).icon, { className: "kind" })} ${escapeHtml(i.name)}${i.addedFiles ? ` (+${i.addedFiles.length})` : ""}`).join(" · ")}${s.newItems.length > 3 ? " …" : ""}${s.updated.length
              ? `${s.newItems.length ? " · " : ""}päivitetty: ${s.updated.slice(0, 2).map(d => escapeHtml(d.fileName || "")).join(", ")}${s.updated.length > 2 ? " …" : ""}` : ""}</span>
          </span>
        </button>`).join("")}</div>
    </section>`;
}

// ---------- näkymä ----------

export function render(ctx) {
  const { data, state } = ctx;
  const now = Date.now();
  const summaries = data.courses.map(course => ({ course, s: courseSummary(data, course, ctx.exists, now) }));

  let html = `<h1 class="sr-only">Tänään</h1>`;
  if (data.settings.onboarded) html += `<div class="h-status">${renderSync(ctx, summaries)}</div>`;
  if (state.message) html += `<div class="notice ${state.message.kind}">${escapeHtml(state.message.text)}</div>`;

  if (!data.settings.onboarded) {
    return html + `
      <div class="card">
        <p>Tervetuloa! Valitse ensin, mihin opintosi tallennetaan, ja tuo kurssit Moodlesta.</p>
        <button class="btn primary" data-action="onboarding">Avaa aloitusopas</button>
      </div>`;
  }
  // Moodleen ei ole kirjauduttu → määräajat eivät päivity
  if (data.deadlines.error === "login") {
    html += `
      <div class="notice info">Et ole kirjautunut Moodleen, joten määräaikoja ei voitu päivittää.
        <button class="link" data-action="open-moodle">Avaa Moodle ja kirjaudu</button></div>`;
  } else if (data.deadlines.error) {
    html += `<div class="notice error">Määräaikojen haku epäonnistui: ${escapeHtml(data.deadlines.error)}</div>`;
  }

  const importNotice = courseImportNotice(data);
  if (importNotice) {
    html += `<div class="notice info" role="status">${escapeHtml(importNotice)}
      <button class="link" data-action="import">Tarkista kurssit</button></div>`;
    if (data.courses.length === 0) return html;
  }
  if (data.courses.length === 0) {
    return html + `
      <div class="card">
        <p>Tuo kurssisi Moodlesta. Sen jälkeen Moodlesta tallennetut tiedostot menevät oikeisiin kansioihin itsestään.</p>
        <button class="btn primary" data-action="import">Tuo kurssit Moodlesta</button>
      </div>`;
  }

  // Oma kansio ilman lupaa
  const hasPending = Object.values(data.downloads).some(d => d.state === "pending"); // näkyy Vaatii huomiota -osiossa
  if (data.settings.storage === "folder" && permission !== "granted" && permission !== "unknown" && !hasPending) {
    html += `
      <div class="card warn">
        <strong>Kurssikaveri tarvitsee luvan opintokansioon "${escapeHtml(data.settings.folderName)}"</strong>
        <p class="muted">Ilman lupaa tiedostot jäävät odottamaan. Valitse Chromen kysyessä <strong>"Salli joka kerta"</strong>.</p>
        <button class="btn primary" data-action="grant-home">Anna lupa</button>
      </div>`;
  }

  html += endingCards(summaries);
  html += `<div class="h-top">${hero(data, now)}${data.settings.showHomeCalendar ? miniCalendar(data, now) : ""}</div>`;
  html += otherDeadlines(data, now);

  const attention = attentionView.render(ctx);
  if (attention.trim()) {
    html += `<section class="dlist"><h2>Vaatii huomiota <span class="badge">${attentionCount(data, ctx.exists)}</span></h2>${attention}</section>`;
  }
  html += newSection(summaries);
  return html;
}

export function bind(root, ctx) {
  if (ctx.data.settings.storage === "folder") {
    folder.permissionState().then(state => { if (state !== permission) { permission = state; ctx.render(); } });
  }
  attentionView.bind(root, ctx);

  // Iso teksti päivittyy minuutin välein, kun sivu on auki
  if (!ticker) {
    ticker = setInterval(() => {
      if (ctx.state.view === "home" && !document.hidden && !document.querySelector("#main :focus")) ctx.render();
    }, 60 * 1000);
  }

  root.addEventListener("click", async event => {
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const { data } = ctx;
    try {
      if (await handleSync(el.dataset.action, ctx)) return;
      switch (el.dataset.action) {
        case "toggle-more": showAll = !showAll; ctx.render(); break;
        case "onboarding": chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }); break;
        case "import": ctx.setView("courses", { autoImport: true }); break;
        case "open-moodle": chrome.tabs.create({ url: `${moodleBase(data.settings)}/my/` }); break;
        case "open-course-moodle": chrome.tabs.create({ url: `${moodleBase(data.settings)}/course/view.php?id=${el.dataset.moodle}` }); break;
        case "open-course": ctx.openCourse(el.dataset.course); break;
        case "save-course": {
          const result = await saveCourseFiles(el.dataset.moodle, ctx.render);
          ctx.showMessage(result.kind, result.text);
          break;
        }
        case "complete": await ask("setCourseStatus", { courseId: el.dataset.course, status: "completed", endHandled: true }); break;
        case "not-yet": await ask("setCourseStatus", { courseId: el.dataset.course, endHandled: true }); break;
        case "grant-home": {
          const note = grantNote(await grantFolderPermission());
          permission = "granted";
          ctx.showMessage(note.kind, note.text);
          break;
        }
      }
    } catch (error) {
      ctx.showMessage("error", error.message);
    }
  });
}
