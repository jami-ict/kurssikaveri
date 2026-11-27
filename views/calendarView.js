// calendarView.js – Kalenteri: Moodlen määräajat ja omat merkinnät kuukausinäkymässä.
//
// Osat:
//   - otsikkorivi: edellinen / seuraava kuukausi, kuukauden nimi, päivitys- ja tallennuspainike
//   - "Näytä:" kurssisuodattimet (✓ = kurssin merkinnät näkyvät), valinta muistetaan
//   - kuukausiruudukko viikkonumeroineen; päivän +-painike lisää merkinnän
//   - valitun päivän merkinnät kansiopinona; valittu kansio on auki
//   - Uusi merkintä / Muokkaa merkintää -ponnahdusikkuna
//
// Omat merkinnät tallentuvat vain tälle koneelle (chrome.storage.local, avain ownEntries).

import { escapeHtml } from "../shared/ui.js";
import { formatDay } from "../shared/status.js";
import { newId, updateData } from "../shared/store.js";
import { icon } from "../shared/icons.js";
import { colorVars, colorForCourse, postIt } from "../shared/colors.js";
import { allEvents, dateKey, eventLabel, parseDateKey } from "../shared/agenda.js";
import { renderSync, handleSync } from "../shared/syncbar.js";

const DAY = 86400 * 1000;
const MONTHS = ["Tammikuu", "Helmikuu", "Maaliskuu", "Huhtikuu", "Toukokuu", "Kesäkuu",
  "Heinäkuu", "Elokuu", "Syyskuu", "Lokakuu", "Marraskuu", "Joulukuu"];
const WEEKDAYS = ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"];
const WEEKDAY_SHORT = ["su", "ma", "ti", "ke", "to", "pe", "la"];
const TYPE_LABEL = { deadline: "Määräaika", other: "Muu merkintä" };

// Sivun tila, joka ei tallennu
let month = null;      // näytettävän kuukauden 1. päivä (ms)
let selected = null;   // valittu päivä "2026-11-12"
let openId = null;     // kansiopinossa auki oleva merkintä
let dialog = null;     // { mode, id, date, title, courseId, type, time, note, showNote, error, focus }
let undo = null;       // viimeksi poistettu merkintä (Kumoa)
let undoTimer = null;  // Kumoa-ilmoitus häviää itsestään hetken kuluttua
const UNDO_MS = 12 * 1000;

function clearUndo() {
  undo = null;
  clearTimeout(undoTimer);
  undoTimer = null;
}
let keysBound = false;

// ---------- apufunktiot ----------

function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function firstOfMonth(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function clock(ms) { const d = new Date(ms); return `${d.getHours()}.${String(d.getMinutes()).padStart(2, "0")}`; }
function shortDay(key) { const ms = parseDateKey(key); return `${WEEKDAY_SHORT[new Date(ms).getDay()]} ${formatDay(ms)}`; }

// ISO-viikkonumero (viikko alkaa maanantaina)
function isoWeek(ms) {
  const t = new Date(startOfDay(ms));
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const week1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - week1) / DAY - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function relative(key, now) {
  const days = Math.round((parseDateKey(key) - startOfDay(now)) / DAY);
  if (days === 0) return "tänään";
  if (days === 1) return "huomenna";
  if (days === -1) return "eilen";
  return days > 0 ? `${days} päivän päästä` : `${-days} päivää sitten`;
}

function timeText(e) {
  if (!e.allDay) return `klo ${clock(e.time)}`;
  return e.type === "deadline" ? "päivän loppuun" : "koko päivä";
}

// "14", "14.30", "14:30" → "14:30"; tyhjä → ""; virheellinen → null
function parseTime(text) {
  const t = text.trim();
  if (!t) return "";
  const m = /^(\d{1,2})(?:[.:](\d{2}))?$/.exec(t);
  if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
}

// Kurssit, jotka voi valita omalle merkinnälle: käynnissä olevat (+ muokattavan merkinnän kurssi)
function selectableCourses(data, keepId = null) {
  return data.courses.filter(c => c.status === "active" || c.id === keepId);
}

// Suodatinpainikkeet: käynnissä olevat kurssit + kurssit, joilla on merkintöjä
function filterKeys(data, events) {
  const keys = new Map();
  for (const c of data.courses.filter(c => c.status === "active")) {
    keys.set(c.id, { name: c.name, color: colorForCourse(data, c) });
  }
  for (const e of events) {
    if (e.filterKey && !keys.has(e.filterKey)) keys.set(e.filterKey, { name: e.courseName, color: e.color });
  }
  return keys;
}

// Kelluvan tekstikentän otsikko kirjain kerrallaan (aaltoefekti, uiverse.io / AbanoubMagdy1, MIT)
function waveField(id, label, value, attrs = "") {
  const letters = [...label].map((ch, i) => `<span class="ch" style="--i:${i}">${escapeHtml(ch)}</span>`).join("");
  return `
    <div class="wave">
      <input class="input" id="${id}" type="text" placeholder=" " autocomplete="off" value="${escapeHtml(value || "")}" ${attrs}>
      <span class="bar"></span>
      <label class="label" for="${id}">${letters}</label>
    </div>`;
}

// ---------- osat ----------

function head(ctx, monthMs) {
  const d = new Date(monthMs);
  return `
    <div class="cal-head">
      <button class="iconbtn" type="button" data-action="prev-month" aria-label="Edellinen kuukausi">${icon("left")}</button>
      <button class="iconbtn" type="button" data-action="next-month" aria-label="Seuraava kuukausi">${icon("right")}</button>
      <h1>${MONTHS[d.getMonth()]} ${d.getFullYear()}</h1>
      ${ctx.data.settings.onboarded && ctx.data.courses.length ? renderSync(ctx) : ""}
    </div>`;
}

function filters(keys, hidden) {
  if (keys.size === 0) return "";
  return `
    <div class="filters" role="group" aria-label="Näytä kurssit">
      <span class="flab">Näytä:</span>
      ${[...keys].map(([key, k]) => `
        <button class="lg" type="button" data-action="toggle-filter" data-key="${escapeHtml(key)}" aria-pressed="${!hidden.has(key)}">
          ${icon("check", { className: "ck" })}<span class="cdot" style="background:${colorVars(k.color).dot}"></span>${escapeHtml(k.name)}</button>`).join("")}
    </div>`;
}

function eventChip(e, now) {
  const c = colorVars(e.color);
  const sub = e.source === "own" ? TYPE_LABEL[e.type] : timeText(e);
  return `<button class="ev${e.time < now ? " past" : ""}${e.done ? " done" : ""}" type="button" data-action="pick" data-date="${dateKey(e.time)}" data-id="${escapeHtml(e.id)}"
    style="background:${c.bg};color:${c.ink};--dot:${c.dot}" title="${escapeHtml(eventLabel(e))}" aria-label="${escapeHtml(eventLabel(e) + ", " + (e.done ? "palautettu, " : "") + sub)}">
    <span>${e.source === "own" ? postIt("pit") : ""}${escapeHtml(e.title)}</span>${e.courseName ? `<small class="ev-course">${escapeHtml(e.courseName)}</small>` : ""}<small>${escapeHtml(e.done ? `Palautettu · ${sub}` : sub)}</small></button>`;
}

function grid(monthMs, visible, now) {
  const first = new Date(monthMs);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));

  const byDay = {};
  for (const e of visible) (byDay[dateKey(e.time)] ||= []).push(e);
  const todayKey = dateKey(now);

  let html = `<span class="wd" aria-hidden="true">vk</span>${["ma", "ti", "ke", "to", "pe", "la", "su"].map(w => `<span class="wd">${w}</span>`).join("")}`;
  for (let day = new Date(start), col = 0; day <= end; day.setDate(day.getDate() + 1), col = (col + 1) % 7) {
    const ms = day.getTime();
    const key = dateKey(ms);
    if (col === 0) html += `<span class="wk">${isoWeek(ms)}</span>`;
    const classes = ["day"];
    if (day.getMonth() !== first.getMonth()) classes.push("out");
    if (col >= 5) classes.push("we");
    if (key === todayKey) classes.push("today");
    if (key === selected) classes.push("sel");
    const label = `${WEEKDAYS[day.getDay()]} ${formatDay(ms)}${key === todayKey ? ", tänään" : ""}`;
    html += `
      <div class="${classes.join(" ")}" data-action="select-day" data-date="${key}">
        <button class="n" type="button" data-action="select-day" data-date="${key}" aria-label="${label}" aria-pressed="${key === selected}">${day.getDate()}</button>
        <button class="add" type="button" data-action="add" data-date="${key}" aria-label="Lisää merkintä ${formatDay(ms)}">${icon("plus")}</button>
        ${(byDay[key] || []).map(e => eventChip(e, now)).join("")}
      </div>`;
  }
  return `<div class="cal-grid">${html}</div>`;
}

function fold(e, isFirst, isOpen) {
  const c = colorVars(e.color);
  const tabMark = e.source === "own" && !e.course ? postIt("pit") : `<span class="cdot" style="background:${c.dot}"></span>`;
  let body = "";
  if (isOpen) {
    body = e.source === "moodle"
      ? `<div class="fbody">
          <div class="kinds"><span class="kind">Moodlesta</span>${e.done ? `<span class="kind">${icon("check")}Palautettu</span>` : ""}</div>
          <div class="acts"><a class="obtn" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">Avaa Moodlessa ${icon("external")}</a></div>
        </div>`
      : `<div class="fbody">
          <div class="kinds"><span class="kind">${postIt("pit")}${TYPE_LABEL[e.type]}</span></div>
          ${e.note ? `<p>${escapeHtml(e.note)}</p>` : ""}
          <p class="fpriv">Näkyy vain sinulle, tallennettu omalle koneellesi.</p>
          <div class="acts">
            <button class="pbtn" type="button" data-action="edit" data-id="${escapeHtml(e.id)}">Muokkaa</button>
            <button class="pbtn" type="button" data-action="delete" data-id="${escapeHtml(e.id)}">Poista</button>
          </div>
        </div>`;
  }
  return `
    <div class="fold${isFirst ? " first" : ""}${isOpen ? " open" : ""}" style="--c:${c.bg};--ink:${c.ink}">
      <span class="back" aria-hidden="true"></span>
      <button class="ftab" type="button" data-action="open-fold" data-id="${escapeHtml(e.id)}" tabindex="-1" aria-hidden="true">${tabMark}<span>${escapeHtml(e.courseName || "Oma merkintä")}</span></button>
      <div class="front">
        <button class="fhead" type="button" data-action="open-fold" data-id="${escapeHtml(e.id)}" aria-expanded="${isOpen}"><span class="sr-only">${e.courseName ? escapeHtml(e.courseName) + ", " : ""}</span><b${e.done ? ' class="done"' : ""}>${escapeHtml(e.title)}</b><small>${timeText(e)}</small></button>
        ${body}
      </div>
    </div>`;
}

function panel(visible, now) {
  const ms = parseDateKey(selected);
  const items = visible.filter(e => dateKey(e.time) === selected);
  const openOne = items.find(e => e.id === openId) || items[0];
  return `
    <aside class="cal-panel" aria-labelledby="day-h">
      <div class="dayhead">
        <span class="selnum" aria-hidden="true">${new Date(ms).getDate()}</span>
        <div><div class="lab">Valittu päivä</div><h2 id="day-h">${WEEKDAYS[new Date(ms).getDay()]} ${formatDay(ms)}</h2><div class="rel">${relative(selected, now)}</div></div>
      </div>
      ${items.length
        ? `<div class="pile">${items.map((e, i) => fold(e, i === 0, e === openOne)).join("")}</div>`
        : `<p class="muted cal-empty">Ei merkintöjä tälle päivälle.</p>`}
      <button class="addlink" type="button" data-action="add" data-date="${selected}">${icon("plus")}Lisää merkintä tälle päivälle</button>
    </aside>`;
}

function dialogHtml(data) {
  const d = dialog;
  const courses = selectableCourses(data, d.courseId);
  const chip = (value, name, mark, bg) => `
    <label class="chip" style="--c:${bg}">
      <input class="sr-only" type="radio" name="dlg-course" value="${escapeHtml(value)}" ${(d.courseId || "") === value ? "checked" : ""}>${mark}<span>${escapeHtml(name)}</span></label>`;
  return `
    <div class="scrim" data-action="close-dlg" aria-hidden="true"></div>
    <form class="dlg" id="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-h" novalidate>
      <div class="dlg-h">
        <h2 id="dlg-h">${d.mode === "edit" ? "Muokkaa merkintää" : "Uusi merkintä"}</h2>
        <button class="datebtn" type="button" data-action="pick-date" aria-label="Päivämäärä ${shortDay(d.date)}, vaihda">${icon("calendar")}${shortDay(d.date)}</button>
        <input class="sr-only" type="date" id="dlg-date" value="${d.date}" tabindex="-1" aria-hidden="true">
        <button class="xbtn" type="button" data-action="close-dlg" aria-label="Sulje">${icon("close")}</button>
      </div>
      ${waveField("dlg-title", "Otsikko", d.title, 'maxlength="120"')}
      <span class="flabel" id="k-lab">Kurssi</span>
      <div class="kgrid" role="radiogroup" aria-labelledby="k-lab">
        ${courses.map(c => {
          const v = colorVars(colorForCourse(data, c));
          return chip(c.id, c.name, `<span class="cdot" style="background:${v.dot}"></span>`, v.bg);
        }).join("")}
        ${courses.length ? `<span class="ksep" aria-hidden="true"></span>` : ""}
        ${chip("", "Oma merkintä", postIt("pit"), "var(--own)").replace('class="chip"', 'class="chip kown"')}
      </div>
      <span class="flabel" id="t-lab">Tyyppi</span>
      <div class="seg2" role="radiogroup" aria-labelledby="t-lab">
        <label><input class="sr-only" type="radio" name="dlg-type" value="deadline" ${d.type === "deadline" ? "checked" : ""}>${postIt("pit")}Määräaika</label>
        <label><input class="sr-only" type="radio" name="dlg-type" value="other" ${d.type === "other" ? "checked" : ""}>${postIt("pit")}Muu merkintä</label>
      </div>
      <div class="thint"><span class="t1">Näkyy kalenterissa ja Tänään-sivulla.</span><span class="t2">Näkyy vain kalenterissa.</span></div>
      <div class="row2">
        ${waveField("dlg-time", "Kellonaika", d.time ? d.time.replace(":", ".") : "", 'inputmode="numeric" maxlength="5"')}
        ${d.showNote ? "" : `<button class="morel" type="button" data-action="show-note">${icon("plus")}Lisätieto</button>`}
      </div>
      ${d.showNote ? waveField("dlg-note", "Lisätieto", d.note, 'maxlength="300"') : ""}
      ${d.error ? `<p class="dlg-err" role="alert">${escapeHtml(d.error)}</p>` : ""}
      <div class="dlg-f">
        <button class="dlg-cancel" type="button" data-action="close-dlg">Peruuta</button>
        <button class="savebtn" type="submit">${icon("check")}Tallenna</button>
      </div>
    </form>`;
}

// ---------- näkymä ----------

export function render(ctx) {
  const { data, state } = ctx;
  const now = Date.now();
  if (state.calDate) {                 // #calendar=2026-11-12 (Tänään-sivun linkit)
    selected = state.calDate;
    month = firstOfMonth(parseDateKey(state.calDate));
    openId = null;
    state.calDate = null;
  }
  if (!selected) selected = dateKey(now);
  if (!month) month = firstOfMonth(now);

  const events = allEvents(data);
  const hidden = new Set(data.calendarPrefs.hidden);
  const visible = events.filter(e => !e.filterKey || !hidden.has(e.filterKey));

  let html = head(ctx, month);
  if (state.message) html += `<div class="notice ${state.message.kind}">${escapeHtml(state.message.text)}</div>`;
  if (undo) html += `<div class="notice info notice-x" role="status"><span>Merkintä "${escapeHtml(undo.title)}" poistettu. <button class="link" data-action="undo">Kumoa</button></span>
    <button class="notice-close" type="button" data-action="undo-close" aria-label="Sulje ilmoitus">${icon("close")}</button></div>`;
  html += filters(filterKeys(data, events), hidden);
  html += `<div class="cal-layout">${grid(month, visible, now)}${panel(visible, now)}</div>`;
  if (dialog) html += dialogHtml(data);
  return html;
}

function openDialog(ctx, values) {
  const prefs = ctx.data.calendarPrefs;
  const courses = selectableCourses(ctx.data);
  // Oletuksena viimeksi käytetty kurssi ("" = Oma merkintä), muuten ensimmäinen kurssi
  let courseId = prefs.lastCourse;
  if (courseId !== "" && !courses.some(c => c.id === courseId)) courseId = courses.length ? courses[0].id : "";
  dialog = { mode: "new", id: null, title: "", courseId: courseId || null, type: "deadline", time: "", note: "",
    showNote: false, error: "", focus: "dlg-title", ...values };
  if (dialog.mode === "edit") dialog.original = values;
  ctx.render();
}

async function saveDialog(ctx) {
  const d = dialog;
  if (!d || d.saving) return;
  const time = parseTime(d.time);
  if (!d.title.trim()) { d.error = "Kirjoita merkinnälle otsikko."; d.focus = "dlg-title"; ctx.render(); return; }
  if (time === null) { d.error = "Kirjoita kellonaika muodossa 14.30 tai jätä kenttä tyhjäksi."; d.focus = "dlg-time"; ctx.render(); return; }
  const values = { title: d.title.trim(), date: d.date, time, courseId: d.courseId || null, type: d.type, note: d.note.trim() };
  const id = d.id || newId("own-");
  d.saving = true;
  try {
    await updateData(["ownEntries", "calendarPrefs"], ({ ownEntries, calendarPrefs }) => {
      if (d.mode === "edit") {
        const entry = ownEntries.find(e => e.id === id);
        if (!entry) throw new Error("Merkintä on jo poistettu.");
        for (const [key, value] of Object.entries(values)) {
          if (value !== d.original[key]) entry[key] = value;
        }
      } else {
        ownEntries.push({ id, ...values, created: Date.now() });
      }
      return { ownEntries, calendarPrefs: { ...calendarPrefs, lastCourse: values.courseId || "" } };
    });
  } finally {
    d.saving = false;
  }
  if (dialog !== d) return;
  selected = values.date;
  month = firstOfMonth(parseDateKey(selected));
  openId = id;
  dialog = null;
  clearUndo();
  ctx.render();
}

// Lomakkeen kentät talteen, jotta uudelleenpiirto (esim. taustan päivitys) ei hävitä kirjoitettua
function readDialog(root) {
  if (!dialog) return;
  const val = id => { const el = root.querySelector(`#${id}`); return el ? el.value : null; };
  if (val("dlg-title") !== null) dialog.title = val("dlg-title");
  if (val("dlg-time") !== null) dialog.time = val("dlg-time");
  if (val("dlg-note") !== null) dialog.note = val("dlg-note");
  const course = root.querySelector("input[name='dlg-course']:checked");
  if (course) dialog.courseId = course.value || null;
  const type = root.querySelector("input[name='dlg-type']:checked");
  if (type) dialog.type = type.value;
}

export function bind(root, ctx) {
  if (dialog && dialog.focus) {
    const el = root.querySelector(`#${dialog.focus}`);
    if (el) el.focus();
    dialog.focus = null;
  }
  if (!keysBound) {
    keysBound = true;
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && dialog && ctx.state.view === "calendar") { dialog = null; ctx.render(); }
    });
  }

  root.addEventListener("input", () => readDialog(root));
  root.addEventListener("change", event => {
    readDialog(root);
    if (event.target.id === "dlg-date" && event.target.value) { dialog.date = event.target.value; ctx.render(); }
  });
  root.addEventListener("submit", event => {
    event.preventDefault();
    readDialog(root);
    saveDialog(ctx).catch(error => ctx.showMessage("error", error.message));
  });

  root.addEventListener("click", async event => {
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const { data } = ctx;
    try {
      if (await handleSync(el.dataset.action, ctx)) return;
      switch (el.dataset.action) {
        case "prev-month": { const d = new Date(month); month = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(); ctx.render(); break; }
        case "next-month": { const d = new Date(month); month = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); ctx.render(); break; }
        case "select-day":
          selected = el.dataset.date; openId = null;
          month = firstOfMonth(parseDateKey(selected));
          ctx.render(); break;
        case "pick": selected = el.dataset.date; openId = el.dataset.id; ctx.render(); break;
        case "open-fold": openId = el.dataset.id; ctx.render(); break;
        case "toggle-filter": {
          const hide = el.getAttribute("aria-pressed") === "true";
          await updateData("calendarPrefs", ({ calendarPrefs }) => {
            const hidden = new Set(calendarPrefs.hidden);
            if (hide) hidden.add(el.dataset.key); else hidden.delete(el.dataset.key);
            return { calendarPrefs: { ...calendarPrefs, hidden: [...hidden] } };
          });
          break;
        }
        case "add": openDialog(ctx, { date: el.dataset.date }); break;
        case "edit": {
          const e = data.ownEntries.find(x => x.id === el.dataset.id);
          if (e) openDialog(ctx, { mode: "edit", id: e.id, date: e.date, title: e.title, courseId: e.courseId || null,
            type: e.type || "deadline", time: e.time || "", note: e.note || "", showNote: Boolean(e.note) });
          break;
        }
        case "delete": {
          let removed;
          await updateData("ownEntries", ({ ownEntries }) => {
            removed = ownEntries.find(x => x.id === el.dataset.id);
            if (removed) return { ownEntries: ownEntries.filter(x => x.id !== removed.id) };
          });
          if (!removed) break;
          clearUndo();
          undo = removed;
          undoTimer = setTimeout(() => { clearUndo(); if (ctx.state.view === "calendar") ctx.render(); }, UNDO_MS);
          ctx.render();
          break;
        }
        case "undo": {
          if (!undo) break;
          const entry = undo;
          await updateData("ownEntries", ({ ownEntries }) => {
            if (!ownEntries.some(e => e.id === entry.id)) return { ownEntries: [...ownEntries, entry] };
          });
          if (undo === entry) { clearUndo(); openId = entry.id; ctx.render(); }
          break;
        }
        case "undo-close": clearUndo(); ctx.render(); break;
        case "close-dlg": dialog = null; ctx.render(); break;
        case "show-note": readDialog(root); dialog.showNote = true; dialog.focus = "dlg-note"; ctx.render(); break;
        case "pick-date": {
          const input = root.querySelector("#dlg-date");
          try { input.showPicker(); } catch (e) { input.focus(); }
          break;
        }
      }
    } catch (error) {
      ctx.showMessage("error", error.message);
    }
  });
}
