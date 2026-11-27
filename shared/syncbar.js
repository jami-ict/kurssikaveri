// syncbar.js – päivitys- ja tallennuspainike (Tänään- ja Kalenteri-sivu).
//
// Tilat: ei uutta ("Päivitetty 9.42") → tarkistetaan (kuvake pyörii) → uusia löytyi
// ("Tallenna N uutta" liukuu esiin) → tallennettu ("N tiedostoa tallennettu" hetken ajan).
// Käyttö: renderSync(ctx) palauttaa HTML:n, handleSync(action, ctx) hoitaa painallukset.

import { escapeHtml, refreshMoodle, saveCourseFiles } from "./ui.js";
import { courseSummary, formatDay } from "./status.js";
import { icon } from "./icons.js";

let refreshing = false;
let saving = false;
let savedNote = "";

function clock(ms) { const d = new Date(ms); return `${d.getHours()}.${String(d.getMinutes()).padStart(2, "0")}`; }
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }

function activeSummaries(ctx) {
  return ctx.data.courses
    .filter(course => course.status === "active")
    .map(course => ({ course, s: courseSummary(ctx.data, course, ctx.exists) }));
}

function materialNotes(unsaved, files, unchecked) {
  const notes = [];
  if (files.length) {
    const target = files.length === 1 ? `#course=${encodeURIComponent(files[0].course.id)}` : "#courses-unsaved";
    notes.push(`<span>${files.length} kurssilla on <strong>${unsaved} ${unsaved === 1 ? "tiedosto" : "tiedostoa"} tallentamatta</strong>.
      <a href="${target}">Näytä ${files.length === 1 ? "kurssi" : "kurssit"}</a></span>`);
  }
  if (unchecked.length === 1) {
    const { course } = unchecked[0];
    notes.push(`<span>Materiaaleja tarkistamatta kurssilla <a href="#course=${encodeURIComponent(course.id)}">${escapeHtml(course.name)}</a>.</span>`);
  } else if (unchecked.length) {
    notes.push(`<span>${unchecked.length} kurssin materiaaleja on vielä tarkistamatta. <a href="#courses-unchecked">Näytä tarkistettavat kurssit</a></span>`);
  }
  return notes.length ? `<div class="material-notes">${notes.join("")}</div>` : "";
}

export function renderSync(ctx, homeSummaries) {
  const active = homeSummaries ? homeSummaries.filter(({ course }) => course.status === "active") : activeSummaries(ctx);
  const files = active.filter(({ s }) => s.unsaved > 0);
  const unsaved = files.reduce((sum, { s }) => sum + s.unsaved, 0);
  const fetched = ctx.data.deadlines.fetched;
  let text = "";
  if (refreshing) text = "Tarkistetaan Moodlea…";
  else if (saving) text = "Tallennetaan…";
  else if (savedNote && (!homeSummaries || !unsaved)) text = savedNote;
  else if (fetched) text = `${homeSummaries ? "Määräajat päivitetty" : "Päivitetty"} ${sameDay(fetched, Date.now()) ? "" : formatDay(fetched) + " klo "}${clock(fetched)}`;

  const saveLabel = homeSummaries ? "Tallenna tiedostot" : `Tallenna ${unsaved} uutta`;
  const saveButton = unsaved > 0 && (homeSummaries || !savedNote)
    ? `<button class="sync-s" type="button" data-action="save-all" ${saving || refreshing ? "disabled" : ""}>${icon("download")}${saving ? "Tallennetaan…" : saveLabel}</button>`
    : "";
  return `${homeSummaries ? materialNotes(unsaved, files, active.filter(({ s }) => s.materialsUnchecked)) : ""}
    <span class="sync-wrap">
      <span class="muted" aria-live="polite">${escapeHtml(text)}</span>
      <span class="sync" role="group" aria-label="Moodle">
        <button class="sync-r${refreshing ? " spin" : ""}" type="button" data-action="refresh" ${refreshing || saving ? "disabled" : ""}
          aria-label="Päivitä Moodlesta" title="Päivitä Moodlesta">${icon("refresh")}</button>
        ${saveButton}
      </span>
    </span>`;
}

// Palauttaa true, jos painallus kuului tälle painikeryhmälle
export async function handleSync(action, ctx) {
  if (action === "refresh") {
    refreshing = true; savedNote = ""; ctx.render();
    try { await refreshMoodle({ force: true }); } finally { refreshing = false; }
    await ctx.refresh();
    return true;
  }
  if (action === "save-all") {
    ctx.state.message = null;
    saving = true; ctx.render();
    let done = 0;
    const errors = [];
    try {
      for (const { course } of activeSummaries(ctx).filter(({ s }) => s.unsaved > 0)) {
        try {
          const result = await saveCourseFiles(course.moodleId);
          const match = /Tallennettiin (\d+)/.exec(result.text);
          if (match) done += Number(match[1]);
          if (result.kind === "error") errors.push(`${course.name}: ${result.text}`);
        } catch (error) {
          errors.push(`${course.name}: ${error.message}`);
        }
      }
    } finally { saving = false; }
    savedNote = done ? `${done} ${done === 1 ? "tiedosto" : "tiedostoa"} tallennettu` : "";
    setTimeout(() => { savedNote = ""; ctx.render(); }, 4000);
    await ctx.refresh();
    if (errors.length) ctx.showMessage("error", errors.join(" "));
    return true;
  }
  return false;
}
