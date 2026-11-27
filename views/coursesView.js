// coursesView.js – Kurssit: kurssit kansioina tai listana, haku kaikista kursseista,
// tuonti Moodlesta esikatselun kautta ja kurssin lisäys käsin.
// Kurssia painamalla avautuu kurssin oma sivu (views/courseView.js).
//
// Ryhmät:
//   Käynnissä  kurssin värinen kansio: uudet, päättyy pian, seuraava määräaika, tiedostot koneella;
//              kiireellisin (lähin määräaika) ensin
//   Tulevat    samanlaiset kansiot, jos on tulevia kursseja
//   Päättyneet lukukausittain kokoon taitettuina (uusin auki)
// Kortit / Lista -valinta muistetaan (viewPrefs.coursesLayout).

import { semesterFor, cleanName, COURSE_FILE, newCourse, assignCourseFolder } from "../shared/rules.js";
import { updateData, newId, moodleBase } from "../shared/store.js";
import { escapeHtml, STATUS_LABELS, ask, baseName, isPresent, openEntry } from "../shared/ui.js";
import { fetchMoodleCourses, toImportRows } from "../shared/moodle.js";
import { courseSummary, formatDay } from "../shared/status.js";
import { KINDS, allItems } from "../shared/contents.js";
import { icon } from "../shared/icons.js";
import { colorForCourse, colorVars } from "../shared/colors.js";
import { upcomingEvents } from "../shared/agenda.js";

const WEEKDAY_SHORT = ["su", "ma", "ti", "ke", "to", "pe", "la"];
let openSemesters = null;   // avatut lukukaudet (Set); oletuksena uusin auki

export function render(ctx) {
  const { data, state } = ctx;
  const unsavedOnly = state.view === "courses-unsaved";
  const filtered = unsavedOnly || state.view === "courses-unchecked";
  const layout = data.viewPrefs.coursesLayout === "list" ? "list" : "cards";
  const letters = [..."Hae kursseista"].map((ch, i) => `<span class="ch" style="--i:${i}">${ch}</span>`).join("");
  let html = `
    <div class="cr-head">
      <h1>Kurssit</h1>
      <div class="cr-tools">
        ${filtered ? '<a class="link" href="#courses">Näytä kaikki kurssit</a>' : `<div class="wave cr-search" role="search">
          ${icon("search", { className: "sicon" })}
          <input class="input" id="course-search" type="search" placeholder=" " autocomplete="off" value="${escapeHtml(state.search)}"
            title="Hakee kurssien nimistä ja sisällöstä: tiedostot, linkit, videot">
          <span class="bar"></span>
          <label class="label" for="course-search">${letters}</label>
        </div>`}
        <div class="seg" role="group" aria-label="Näkymä">
          <button type="button" data-action="layout" data-layout="cards" aria-pressed="${layout === "cards"}">Kortit</button>
          <button type="button" data-action="layout" data-layout="list" aria-pressed="${layout === "list"}">Lista</button>
        </div>
      </div>
    </div>`;

  if (state.message) html += `<div class="notice ${state.message.kind}">${escapeHtml(state.message.text)}</div>`;
  if (!filtered && state.importError) {
    html += `<div class="notice error">${escapeHtml(state.importError)}
      ${state.importLogin ? `<div class="actions"><button class="btn small" data-action="open-login">Avaa Moodle ja kirjaudu</button></div>` : ""}</div>`;
  }
  if (!filtered && state.importRows) html += importPreview(state);
  if (!filtered && state.addCourseOpen) html += addForm(state);

  if (!filtered && state.search.trim()) return html + searchResults(ctx);

  if (!filtered && data.courses.length === 0) {
    html += `<div class="cr-empty"><p>Ei vielä kursseja. Tuo kurssisi Moodlesta tai lisää kurssi käsin.</p>
      <div class="actions">
        <button class="btn primary" data-action="import" ${state.importBusy ? "disabled" : ""}>${state.importBusy ? "Haetaan kursseja…" : "Tuo kurssit Moodlesta"}</button>
        <button class="link" data-action="add-open">Lisää kurssi käsin</button>
      </div></div>`;
    return html;
  }

  const now = Date.now();
  const events = upcomingEvents(data, now).filter(e => e.time >= now);
  const info = course => {
    const s = courseSummary(data, course, ctx.exists, now);
    const next = events.find(e => e.course === course);
    return { course, s, next, color: colorForCourse(data, course) };
  };
  const byUrgency = (a, b) => (a.next ? a.next.time : Infinity) - (b.next ? b.next.time : Infinity) || a.course.name.localeCompare(b.course.name, "fi");

  const active = data.courses.filter(c => c.status === "active").map(info).sort(byUrgency);
  if (filtered) {
    const label = unsavedOnly ? "Tallentamattomia tiedostoja" : "Materiaaleja tarkistamatta";
    const rows = active.filter(({ s }) => unsavedOnly ? s.unsaved > 0 : s.materialsUnchecked);
    html += `<div class="grp"><h2>${label}</h2></div>`;
    if (!rows.length) return html + `<p>Tässä ryhmässä ei enää ole kursseja.</p>`;
    return html + (layout === "list" ? courseTable(rows, label) : `<div class="cr-cards">${rows.map(courseCard).join("")}</div>`);
  }
  const upcoming = data.courses.filter(c => c.status === "upcoming").map(info).sort(byUrgency);
  const completed = data.courses.filter(c => c.status === "completed").map(info);

  if (active.length) {
    html += `<div class="grp"><h2>Käynnissä</h2><span class="muted">${active.length} ${active.length === 1 ? "kurssi" : "kurssia"} · kiireellisin ensin</span></div>`;
    html += layout === "list" ? courseTable(active, "Käynnissä olevat kurssit") : `<div class="cr-cards">${active.map(courseCard).join("")}</div>`;
  }
  if (upcoming.length) {
    html += `<div class="grp"><h2>Tulevat</h2><span class="muted">${upcoming.length} ${upcoming.length === 1 ? "kurssi" : "kurssia"}</span></div>`;
    html += layout === "list" ? courseTable(upcoming, "Tulevat kurssit") : `<div class="cr-cards">${upcoming.map(courseCard).join("")}</div>`;
  }
  if (completed.length) html += completedGroups(completed);
  html += moreActions(state);
  return html;
}

// Lukukausi kurssin päättymis- tai alkamispäivästä: "Kevät 2026" / "Syksy 2025"
function termOf(course) {
  const t = course.end || course.start;
  if (!t) return { key: course.semester || "", label: course.semester ? `Lukuvuosi ${course.semester}` : "Ajankohta ei tiedossa", order: 0 };
  const d = new Date(t * 1000);
  const spring = d.getMonth() <= 6;
  return { key: `${d.getFullYear()}-${spring ? 1 : 2}`, label: `${spring ? "Kevät" : "Syksy"} ${d.getFullYear()}`, order: d.getFullYear() * 2 + (spring ? 0 : 1) };
}

function shortDate(ms) { return `${WEEKDAY_SHORT[new Date(ms).getDay()]} ${formatDay(ms)}`; }

// Kurssin tunnisteet: uudet kohteet ja kokonaan uudet välilehdet (kaikki välilehden kohteet uusia)
function courseTags(s) {
  const tags = [];
  const content = s.content;
  if (content) {
    const newSections = Object.entries(content.sections || {})
      .filter(([, info]) => info.items.length > 0 && info.items.every(i => s.newItems.some(n => n.cmid === i.cmid && !n.addedFiles)))
      .map(([name]) => name);
    if (newSections.length === 1) tags.push(`Uusi välilehti: ${newSections[0]}`);
    else if (newSections.length > 1) tags.push(`${newSections.length} uutta välilehteä`);
  }
  if (s.newItems.length && !tags.length) tags.push(`${s.newItems.length} uutta`);
  return tags;
}

function progress(s, course) {
  if (s.materialsUnchecked) {
    const missing = s.unsaved ? `${s.unsaved} ${s.unsaved === 1 ? "tiedosto" : "tiedostoa"} tallentamatta · ` : "";
    return { done: null, text: missing + "Materiaaleja tarkistamatta" };
  }
  if (s.content && s.total > 0) {
    if (s.unsaved === 0) return { done: true, text: "Kaikki tiedostot koneellasi", pct: 100 };
    return { done: false, text: `${s.saved} / ${s.total} tiedostoa koneellasi`, pct: Math.round(s.saved / s.total * 100) };
  }
  if (s.content) return { done: null, text: "Ei tiedostoja Moodlessa" };
  return { done: null, text: course.moodleId ? "Avaa kurssi kerran Moodlessa, niin sisältö tulee näkyviin" : "Ei yhdistetty Moodleen" };
}

function courseCard({ course, s, next, color }) {
  const c = colorVars(color);
  const tags = courseTags(s);
  const p = progress(s, course);
  const ending = s.endingSoon ? `<span class="tag warn">Päättyy ${formatDay(course.end * 1000)}</span>` : "";
  return `
    <button class="cr-card fld" type="button" data-action="open-course" data-course="${course.id}" style="--c:${c.bg};--dot:${c.dot};color:${c.ink}">
      <span class="back" aria-hidden="true"></span>
      <span class="ftab" aria-hidden="true"></span>
      <span class="fld-front">
        <span class="cr-name">${escapeHtml(course.name)}</span>
        ${tags.length || ending ? `<span class="cr-tags">${ending}${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</span>` : ""}
        <span class="cr-next">${next ? `Seuraavaksi <b>${shortDate(next.time)}</b> ${escapeHtml(next.title)}` : `<span class="cr-faint">Ei tulevia määräaikoja</span>`}</span>
        ${p.done === true ? `<span class="cr-prog full">${icon("check")}${p.text}</span>`
          : p.done === false ? `<span class="cr-prog"><span class="cr-bar"><i style="width:${p.pct}%"></i></span><small>${p.text}</small></span>`
          : `<span class="cr-prog"><small>${escapeHtml(p.text)}</small></span>`}
      </span>
    </button>`;
}

function courseTable(rows, label) {
  return `
    <div class="cr-table" role="table" aria-label="${label}">
      <div class="cr-lhead" role="row">
        <span role="columnheader">Kurssi</span><span role="columnheader">Seuraava määräaika</span>
        <span role="columnheader">Uutta</span><span role="columnheader">Koneellasi</span><span role="columnheader">Päättyy</span>
      </div>
      ${rows.map(({ course, s, next, color }) => {
        const c = colorVars(color);
        const tags = courseTags(s);
        const p = progress(s, course);
        const end = course.end ? formatDay(course.end * 1000) : "";
        return `
        <button class="cr-lrow" type="button" role="row" data-action="open-course" data-course="${course.id}">
          <span class="c1" role="cell"><span class="cdot" style="background:${c.dot}"></span>${escapeHtml(course.name)}</span>
          <span class="c2" role="cell">${next ? `<b>${shortDate(next.time)}</b> ${escapeHtml(next.title)}` : `<span class="muted">Ei tulevia</span>`}</span>
          <span class="c3" role="cell">${tags.map(t => `<span class="tag">${escapeHtml(t.startsWith("Uusi välilehti") ? "Uusi välilehti" : t)}</span>`).join("")}</span>
          <span class="c4" role="cell">${p.done === true ? `<span class="cr-ok">${icon("check")}Kaikki</span>`
            : p.done === false ? `<span class="cr-mb"><i style="width:${p.pct}%;background:${c.dot}"></i></span><span class="cr-num">${s.saved}/${s.total}</span>`
            : `<span class="muted">${s.materialsUnchecked ? p.text : "–"}</span>`}</span>
          <span class="c5" role="cell">${s.endingSoon ? `<span class="cr-soon">${end} · pian</span>` : end}</span>
        </button>`;
      }).join("")}
    </div>`;
}

function completedGroups(rows) {
  const groups = new Map();
  for (const r of rows) {
    const t = termOf(r.course);
    if (!groups.has(t.key)) groups.set(t.key, { ...t, rows: [] });
    groups.get(t.key).rows.push(r);
  }
  const sorted = [...groups.values()].sort((a, b) => b.order - a.order);
  if (!openSemesters) openSemesters = new Set(sorted.length ? [sorted[0].key] : []);
  return `
    <div class="grp"><h2>Päättyneet</h2><span class="muted">Materiaalit pysyvät koneellasi</span></div>
    <div class="sems">
      ${sorted.map(g => `
        <details class="sem" data-term="${escapeHtml(g.key)}" ${openSemesters.has(g.key) ? "open" : ""}>
          <summary><span class="st">${escapeHtml(g.label)}</span><span class="sn">${g.rows.length} ${g.rows.length === 1 ? "kurssi" : "kurssia"}</span>${icon("chevron", { className: "chev" })}</summary>
          <div class="arows">${g.rows.sort((a, b) => a.course.name.localeCompare(b.course.name, "fi")).map(({ course, s }) => `
            <button class="arow" type="button" data-action="open-course" data-course="${course.id}">${icon("folder", { className: "fic" })}<span class="an">${escapeHtml(course.name)}</span>
              <span class="af">${s.saved ? `${s.saved} ${s.saved === 1 ? "tiedosto" : "tiedostoa"}` : ""}</span></button>`).join("")}
          </div>
        </details>`).join("")}
    </div>`;
}

function moreActions(state) {
  return `
    <div class="cr-more">
      <span class="muted">Puuttuuko kurssi?</span>
      <button class="link" data-action="import" ${state.importBusy ? "disabled" : ""}>${state.importBusy ? "Haetaan kursseja…" : "Tuo kurssit Moodlesta"}</button>
      <span class="muted" aria-hidden="true">·</span>
      <button class="link" data-action="add-open">Lisää kurssi käsin</button>
    </div>`;
}

// Hakutuloksista näytetään enintään näin monta; otsikon luku kertoo kaikkien osumien määrän
const ITEM_LIMIT = 60;
const FILE_LIMIT = 40;
function limitNote(count, limit) {
  return count > limit ? `<p class="muted small">Näytetään ${limit} ensimmäistä. Tarkenna hakua.</p>` : "";
}

// Haku kaikista kursseista: kerätty sisältö (tiedostot, kansiot, linkit, videot) ja tallennetut tiedostot
function searchResults(ctx) {
  const { data, exists, state } = ctx;
  const words = state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = text => { const t = text.toLowerCase(); return words.every(w => t.includes(w)); };
  const courseOf = moodleId => data.courses.find(c => c.moodleId === Number(moodleId));

  const items = allItems(data.courseContent).filter(i => {
    const course = courseOf(i.moodleId);
    if (!course) return false;
    const files = (i.files || []).map(f => f.name).join(" ");
    return matches(`${i.name} ${i.description || ""} ${i.label || ""} ${i.section} ${course.name} ${course.code || ""} ${i.target || ""} ${i.service || ""} ${files}`);
  });

  const files = Object.values(data.downloads)
    .filter(d => d.state === "complete" && !d.movingTo && isPresent(d, exists))
    .filter(d => {
      const course = data.courses.find(c => c.id === d.courseId);
      return matches(`${d.fileName} ${d.originalName} ${baseName(d.path)} ${d.section || ""} ${d.folder || ""} ${course ? course.name : ""}`);
    });

  if (items.length === 0 && files.length === 0) return `<div class="list"><div class="empty">Ei tuloksia haulla "${escapeHtml(state.search)}".</div></div>`;

  let html = "";
  if (items.length) {
    html += `<h2>Kurssien sisältö (${items.length})</h2>${limitNote(items.length, ITEM_LIMIT)}<div class="list striped">${items.slice(0, ITEM_LIMIT).map(i => {
      const course = courseOf(i.moodleId);
      const kind = KINDS[i.kind] || KINDS.activity;
      const url = i.target || i.moodleUrl;
      return `
        <div class="row">
          <div style="min-width:0">
            <div class="name">${icon(kind.icon, { className: "kind", label: kind.label })} ${escapeHtml(i.name)}</div>
            <div class="muted">${escapeHtml(course.name)} · ${escapeHtml(i.section)} · ${kind.label}${i.service ? " · " + escapeHtml(i.service) : ""}</div>
          </div>
          <div class="actions" style="margin:0;flex-shrink:0">
            <button class="btn small" data-action="open-course" data-course="${course.id}">Kurssi</button>
            <button class="btn small" data-action="open-url" data-url="${escapeHtml(url)}">Avaa</button>
          </div>
        </div>`;
    }).join("")}</div>`;
  }
  if (files.length) {
    html += `<h2>Tallennetut tiedostot (${files.length})</h2>${limitNote(files.length, FILE_LIMIT)}<div class="list striped">${files.slice(0, FILE_LIMIT).map(d => {
      const course = data.courses.find(c => c.id === d.courseId);
      return `
        <div class="row clickable" data-action="open-file" data-id="${escapeHtml(d.id)}">
          <div style="min-width:0">
            <div class="name">${escapeHtml(baseName(d.path || d.fullPath) || d.fileName)}</div>
            <div class="muted">${[course ? course.name : "Järjestämättä", d.section, d.folder].filter(Boolean).map(escapeHtml).join(" · ")}</div>
          </div>
          <span class="muted small">Avaa</span>
        </div>`;
    }).join("")}</div>`;
  }
  return html;
}

// Tuonnin esikatselu. Taulukossa ovat vain kurssit, joita ei ole vielä tuotu; jo tuodut kerrotaan yhdellä rivillä.
// Jos tuotavaa ei ole, näytetään pelkkä ilmoitus (ei taulukkoa, josta ei voi valita mitään).
function importPreview(state) {
  const rows = state.importRows.map((r, i) => ({ r, i }));   // i = rivin paikka state.importRows-listassa
  const fresh = rows.filter(({ r }) => !r.imported);
  const imported = rows.filter(({ r }) => r.imported);
  const importedNote = imported.length ? `
      <details class="imp-done">
        <summary>${imported.length} ${imported.length === 1 ? "kurssi on" : "kurssia on"} jo tuotu</summary>
        <p class="muted small">${imported.map(({ r }) => escapeHtml(r.name)).join(" · ")}</p>
      </details>` : "";

  if (fresh.length === 0) {
    return `
    <div class="card">
      <h2 style="margin-top:0">Kaikki kurssisi on jo tuotu</h2>
      <p>Kaikki Moodlen kurssisi (${rows.length}) ovat jo Kurssikaverissa, joten uutta tuotavaa ei ole.</p>
      ${importedNote}
      <div class="actions">
        <button class="btn primary" data-action="import-cancel">Selvä</button>
      </div>
    </div>`;
  }

  const selected = fresh.filter(({ r }) => r.selected).length;
  const day = unix => { const d = new Date(unix * 1000); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };
  return `
    <div class="card">
      <h2 style="margin-top:0">Tuo kurssit Moodlesta</h2>
      <p class="muted">Moodlesta löytyi ${fresh.length} ${fresh.length === 1 ? "kurssi, jota" : "kurssia, joita"} ei ole vielä tuotu. Voit muokata nimiä ja tiloja ennen tuontia.
        Ryhmä- ja toteutustunnukset on poistettu nimistä. Kurssikaveri muistuttaa kurssin päättymisestä Moodlen ajankohdan perusteella.</p>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Nimi</th><th>Koodi</th><th>Ajankohta</th><th>Tila</th></tr></thead>
        <tbody>
          ${fresh.map(({ r, i }) => `
            <tr>
              <td><input type="checkbox" id="imp-sel-${i}" data-row="${i}" data-field="selected" ${r.selected ? "checked" : ""} aria-label="Tuo ${escapeHtml(r.name)}"></td>
              <td>
                <input type="text" id="imp-name-${i}" data-row="${i}" data-field="name" value="${escapeHtml(r.name)}">
                <div class="muted small">${escapeHtml(r.fullname)}${r.hidden ? " · piilotettu Moodlessa" : ""}</div>
              </td>
              <td>${escapeHtml(r.code)}</td>
              <td class="small">${r.start ? day(r.start) : "?"}–${r.end ? day(r.end) : "?"}<div class="muted small">${r.semester}</div></td>
              <td>
                <select id="imp-status-${i}" data-row="${i}" data-field="status">
                  ${Object.entries(STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${key === r.status ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </td>
            </tr>`).join("")}
        </tbody>
      </table></div>
      ${importedNote}
      <label class="inline" style="margin-top:12px">
        <input type="checkbox" id="imp-folders" ${state.importFolders !== false ? "checked" : ""}>
        Luo jokaiselle kurssille kansio ja ${COURSE_FILE} -tiedosto
      </label>
      <div class="actions">
        <button class="btn primary" data-action="import-confirm" ${selected === 0 ? "disabled" : ""}>Tuo valitut (${selected})</button>
        <button class="btn" data-action="import-cancel">Peruuta</button>
      </div>
    </div>`;
}

// Lomakkeen kentät ovat tilassa (state.addDraft), jotta sivun uudelleenpiirto ei hävitä kirjoitettua
function addForm(state) {
  const now = semesterFor(Date.now() / 1000);
  const year = Number(now.slice(0, 4));
  const next = `${year + 1}-${year + 2}`;
  const draft = state.addDraft || {};
  return `
    <div class="card">
      <h2 style="margin-top:0">Lisää kurssi</h2>
      <p class="muted">Kurssi, jota ei ole Moodlessa. Moodle-kurssit kannattaa tuoda Moodlesta.</p>
      <div class="form-row">
        <label>Kurssin nimi <input type="text" id="add-name" class="wide" placeholder="esim. Tietokannat" value="${escapeHtml(draft.name || "")}"></label>
        <label>Koodi (valinnainen) <input type="text" id="add-code" value="${escapeHtml(draft.code || "")}"></label>
        <label>Lukuvuosi
          <select id="add-semester"><option>${now}</option><option ${draft.semester === next ? "selected" : ""}>${next}</option></select>
        </label>
        <label>Tila
          <select id="add-status"><option value="active">Käynnissä</option><option value="upcoming" ${draft.status === "upcoming" ? "selected" : ""}>Tuleva</option></select>
        </label>
      </div>
      <p class="error" id="add-error"></p>
      <div class="actions">
        <button class="btn primary" data-action="add-save">Lisää</button>
        <button class="btn" data-action="add-cancel">Peruuta</button>
      </div>
    </div>`;
}

export function bind(root, ctx) {
  const { state } = ctx;

  // Aloitusoppaasta tultaessa (#import) tuonti käynnistyy heti
  if (state.autoImport) {
    state.autoImport = false;
    runImport(ctx);
  }

  const search = root.querySelector("#course-search");
  search?.addEventListener("input", () => { state.search = search.value; ctx.render(); });

  // Lukukausien auki/kiinni-tila muistetaan sivun ajan
  root.querySelectorAll("details.sem").forEach(d => d.addEventListener("toggle", () => {
    if (!openSemesters) openSemesters = new Set();
    if (d.open) openSemesters.add(d.dataset.term); else openSemesters.delete(d.dataset.term);
  }));

  // "Lisää kurssi" -lomakkeen kentät talteen sitä mukaa kuin niitä muutetaan
  const ADD_FIELDS = { "add-name": "name", "add-code": "code", "add-semester": "semester", "add-status": "status" };
  root.addEventListener("input", event => {
    const field = ADD_FIELDS[event.target.id];
    if (field) (state.addDraft ||= {})[field] = event.target.value;
  });

  root.addEventListener("change", event => {
    const t = event.target;
    if (t.id === "imp-folders") { state.importFolders = t.checked; return; }
    if (t.dataset.row !== undefined) {
      const row = state.importRows[Number(t.dataset.row)];
      row[t.dataset.field] = t.type === "checkbox" ? t.checked : t.value;
      if (t.dataset.field === "selected") ctx.render(); // päivittää "Tuo valitut (n)"
    }
  });

  root.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case "layout":
        await updateData("viewPrefs", ({ viewPrefs }) => ({ viewPrefs: { ...viewPrefs, coursesLayout: button.dataset.layout } }));
        break;
      case "open-course": ctx.openCourse(button.dataset.course); break;
      case "open-url": chrome.tabs.create({ url: button.dataset.url }); break;
      case "open-file": {
        const entry = ctx.data.downloads[button.dataset.id];
        if (entry) openEntry(entry).catch(error => ctx.showMessage("error", error.message));
        break;
      }
      case "import": await runImport(ctx); break;
      case "open-login": chrome.tabs.create({ url: `${moodleBase(ctx.data.settings)}/my/` }); break;
      case "import-cancel": state.importRows = null; ctx.render(); break;
      case "import-confirm": await confirmImport(ctx).catch(error => ctx.showMessage("error", error.message)); break;
      case "add-open": state.addCourseOpen = true; ctx.render(); break;
      case "add-cancel": state.addCourseOpen = false; state.addDraft = null; ctx.render(); break;
      case "add-save": await addCourse(root, ctx).catch(error => ctx.showMessage("error", error.message)); break;
    }
  });
}

async function runImport(ctx) {
  const { state, data } = ctx;
  state.importBusy = true;
  state.importError = "";
  state.importLogin = false;
  state.message = null;
  ctx.render();
  try {
    const moodleCourses = await fetchMoodleCourses(moodleBase(data.settings));
    state.importRows = toImportRows(moodleCourses, data.courses, data.moodleMap);
    if (state.importRows.length === 0) state.importError = "Moodlesta ei löytynyt yhtään kurssia.";
  } catch (error) {
    state.importError = error.message;
    state.importLogin = error.code === "login";
  }
  state.importBusy = false;
  ctx.render();
}

function importCourses(rows, data) {
  let count = 0;
  const folderIds = [];
  for (const row of rows) {
    // Kurssi on voitu lisätä toisessa välilehdessä esikatselun avaamisen jälkeen.
    if (data.moodleMap[row.moodleId] || data.courses.some(c => c.moodleId === row.moodleId)) continue;
    const name = cleanName(row.name) || row.fullname;
    // Jos samanniminen kurssi on jo lisätty käsin, yhdistetään siihen
    let course = data.courses.find(c => !c.moodleId
      && !Object.values(data.moodleMap).includes(c.id)
      && c.name.toLowerCase() === name.toLowerCase() && c.semester === row.semester);
    if (course) {
      Object.assign(course, { moodleId: row.moodleId, start: row.start, end: row.end });
      // Omassa opintokansiossa täydennetään myös käsin lisätyn kurssin mahdollisesti puuttuva kansio.
      if (data.settings.storage === "folder") folderIds.push(course.id);
    } else {
      course = newCourse(newId(), row.fullname, row.shortname, row.moodleId, row.semester, row.status, data.courses,
        { start: row.start, end: row.end });
      course.name = name; // käyttäjä on voinut muokata nimeä esikatselussa
      course.folder = assignCourseFolder(course, data.courses);
      data.courses.push(course);
      folderIds.push(course.id);
    }
    data.moodleMap[row.moodleId] = course.id;
    count++;
  }
  return { count, folderIds };
}

async function confirmImport(ctx) {
  const { state } = ctx;
  const rows = state.importRows.filter(row => row.selected && !row.imported).map(row => ({ ...row }));
  const folders = state.importFolders !== false;
  let imported;
  await updateData(["courses", "moodleMap", "settings"], data => {
    imported = importCourses(rows, data);
    return { courses: data.courses, moodleMap: data.moodleMap };
  });

  let note = "";
  if (folders && imported.folderIds.length > 0) {
    try {
      await ask("createCourseFiles", { courseIds: imported.folderIds });
    } catch (error) {
      note = ` Kansioiden luonti epäonnistui: ${error.message}`;
    }
  }
  state.importRows = null;
  ctx.showMessage(note ? "error" : "ok", `Tuotiin ${imported.count} ${imported.count === 1 ? "kurssi" : "kurssia"}. Avaa kurssi kerran Moodlessa, niin sen sisältö tulee näkyviin.${note}`);
}

async function addCourse(root, ctx) {
  const name = cleanName(root.querySelector("#add-name").value);
  const error = root.querySelector("#add-error");
  if (!name) { error.textContent = "Anna kurssille nimi."; return; }
  const semester = root.querySelector("#add-semester").value;
  const course = {
    id: newId(), name,
    code: root.querySelector("#add-code").value.trim(),
    semester,
    status: root.querySelector("#add-status").value,
    moodleId: null
  };
  const added = await updateData("courses", ({ courses }) => {
    if (courses.some(c => c.name.toLowerCase() === name.toLowerCase() && c.semester === semester)) return;
    course.folder = assignCourseFolder(course, courses);
    return { courses: [...courses, course] };
  });
  if (!added) {
    const message = `Kurssi "${name}" on jo olemassa lukuvuodelle ${semester}.`;
    if (error.isConnected) error.textContent = message; else ctx.showMessage("error", message);
    return;
  }
  try { await ask("createCourseFiles", { courseIds: [course.id] }); } catch (e) { /* kansio syntyy viimeistään ensimmäisen tiedoston mukana */ }
  ctx.state.addCourseOpen = false;
  ctx.state.addDraft = null;
  ctx.showMessage("ok", `Kurssi ${name} lisätty.`);
}
