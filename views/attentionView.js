// attentionView.js – Tänään-sivun "Vaatii huomiota" -osio: tiedostot, joiden kurssi pitää valita
// tai tarkistaa, kaksoiskappaleet ja tallennukset, jotka odottavat lupaa opintokansioon.
// Jokaisesta pääsee suoraan korjaavaan toimintoon. Palauttaa tyhjän, jos kaikki on kunnossa.

import { TYPES, materialPath, swapPrefix } from "../shared/rules.js";
import {
  escapeHtml, baseName, formatDate, attentionItems, ask, showInFolder, canShowInFolder, grantFolderPermission, grantNote
} from "../shared/ui.js";

export function render(ctx) {
  const { data, exists, state } = ctx;
  const items = attentionItems(data, exists);
  const moving = Object.values(data.downloads).filter(d => d.movingTo);

  let html = "";
  if (moving.length > 0) html += `<div class="notice info">Siirretään ${moving.length} tiedostoa kurssien kansioihin…</div>`;

  if (items.pending.length > 0) {
    html += `
      <div class="card warn">
        <strong>${items.pending.length} tiedostoa odottaa lupaa opintokansioon</strong>
        <p class="muted">Chrome ei antanut Kurssikaverin kirjoittaa kansioon "${escapeHtml(data.settings.folderName)}" taustalla.
          Anna lupa, niin tiedostot tallennetaan. Valitse Chromen kysyessä <strong>"Salli joka kerta"</strong>, niin tätä ei tarvita jatkossa.</p>
        <button class="btn primary" data-action="grant">Anna lupa ja tallenna</button>
      </div>`;
  }


  if (items.unsorted.length > 0) {
    html += `<h3>Valitse kurssi (${items.unsorted.length})</h3>
      <p class="muted">Nämä tallentuivat kansioon _Järjestämättä. Kun valitset kurssin, tiedosto siirretään sen kansioon.</p>`;
    html += items.unsorted.map(d => fixCard(d, ctx, false)).join("");
  }
  if (items.check.length > 0) {
    html += `<h3>Tarkista kurssi (${items.check.length})</h3>
      <p class="muted">Kurssi arvattiin viimeksi avatun Moodle-kurssisivun perusteella.</p>`;
    html += items.check.map(d => fixCard(d, ctx, true)).join("");
  }
  if (items.duplicates.length > 0) {
    html += `<h3>Jo tallessa (${items.duplicates.length})</h3>`;
    html += items.duplicates.map(d => duplicateCard(d, ctx)).join("");
  }
  if (items.leftBehind.length > 0) {
    html += `<h3>Jäi latauskansioon (${items.leftBehind.length})</h3>
      <p class="muted">Näitä ei voitu kopioida opintokansioon. Ne ovat selaimen latauskansiossa alla näkyvässä polussa.</p>
      <div class="list">${items.leftBehind.map(d => `
        <div class="row"><div><div class="name">${escapeHtml(d.originalName)}</div><div class="muted small">${escapeHtml(d.note)}${d.path ? ` · <span class="path">${escapeHtml(d.path)}</span>` : ""}</div></div></div>`).join("")}
      </div>`;
  }
  return html;
}

// Kortin valinnat: käyttäjän keskeneräinen valinta tai tiedoston oma ehdotus
function draftFor(d, ctx) {
  if (!ctx.state.drafts[d.id]) {
    const mapped = d.moodleId ? ctx.data.moodleMap[d.moodleId] : null;
    ctx.state.drafts[d.id] = { courseId: d.courseId || mapped || "", type: d.type || "other", fileName: d.fileName, remember: true };
  }
  return ctx.state.drafts[d.id];
}

function fixCard(d, ctx, isCheck) {
  const { data, state } = ctx;
  const draft = draftFor(d, ctx);
  const course = data.courses.find(c => c.id === draft.courseId);
  const selectable = data.courses.filter(c => c.status !== "completed");
  const active = data.courses.filter(c => c.status === "active");
  const sameCourse = course && data.moodleMap[d.moodleId] === course.id;
  const path = course ? materialPath(data.settings, course, {
    type: draft.type, fileName: draft.fileName,
    section: sameCourse ? d.section : null, sectionOrder: sameCourse ? d.sectionOrder : null,
    folder: sameCourse ? d.folder : null, subpath: sameCourse ? d.subpath : ""
  }) : null;
  const moodleKnown = d.moodleId && data.moodleMap[d.moodleId];

  let html = `
    <div class="card ${isCheck ? "" : "warn"} ${state.fixId === d.id ? "highlight" : ""}" id="card-${escapeHtml(d.id)}">
      <div class="toolbar">
        <strong>${escapeHtml(d.originalName)}</strong>
        <span class="muted">${formatDate(d.time)}</span>
      </div>
      <div class="muted">${escapeHtml(d.reason)}</div>`;
  if (d.moodleTitle) html += `<div class="muted">Moodle-kurssi: ${escapeHtml(d.moodleTitle)}</div>`;

  // Tunnistaminen mieluummin kuin muistaminen: aktiiviset kurssit painikkeina
  if (!draft.courseId && active.length > 0) {
    html += `
      <p style="margin:12px 0 4px">Mihin kurssiin tämä kuuluu?</p>
      <div class="actions" style="margin-top:0">
        ${active.map(c => `<button class="btn" data-action="pick" data-id="${escapeHtml(d.id)}" data-course="${c.id}">${escapeHtml(c.name)}</button>`).join("")}
        ${d.moodleTitle && !moodleKnown ? `<button class="btn" data-action="create-course" data-id="${escapeHtml(d.id)}">+ Uusi kurssi Moodlen tiedoista</button>` : ""}
      </div>`;
  }

  html += `
      <div class="form-row">
        <label>Kurssi
          <select id="course-${escapeHtml(d.id)}" data-field="courseId" data-id="${escapeHtml(d.id)}">
            <option value="">Valitse…</option>
            ${selectable.map(c => `<option value="${c.id}" ${c.id === draft.courseId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </label>
        <label>Tyyppi
          <select id="type-${escapeHtml(d.id)}" data-field="type" data-id="${escapeHtml(d.id)}">
            ${Object.keys(TYPES).map(t => `<option value="${t}" ${t === draft.type ? "selected" : ""}>${TYPES[t].label}</option>`).join("")}
          </select>
        </label>
        <label>Nimi
          <input type="text" class="wide" id="name-${escapeHtml(d.id)}" data-field="fileName" data-id="${escapeHtml(d.id)}" value="${escapeHtml(draft.fileName)}">
        </label>
      </div>
      <div class="muted">Tallennetaan:</div>
      <div class="path">${path ? escapeHtml(path) : "Valitse kurssi nähdäksesi sijainnin"}</div>`;

  if (d.moodleId && !moodleKnown) {
    html += `
      <label class="inline" style="margin-top:10px">
        <input type="checkbox" id="remember-${escapeHtml(d.id)}" data-field="remember" data-id="${escapeHtml(d.id)}" ${draft.remember ? "checked" : ""}>
        Muista: tämän Moodle-kurssin tiedostot kuuluvat valitulle kurssille
      </label>`;
  }

  const unchanged = isCheck && draft.courseId === d.courseId && draft.fileName === d.fileName && draft.type === d.type;
  html += `<div class="actions">`;
  if (isCheck) html += `<button class="btn primary" data-action="confirm" data-id="${escapeHtml(d.id)}" ${unchanged ? "" : "disabled"}>Oikein</button>`;
  html += `<button class="btn ${isCheck ? "" : "primary"}" data-action="refile" data-id="${escapeHtml(d.id)}" ${course && draft.fileName.trim() && !unchanged ? "" : "disabled"}>${isCheck ? "Siirrä" : "Järjestä"}</button>`;
  if (canShowInFolder(d)) html += `<button class="btn" data-action="show" data-id="${escapeHtml(d.id)}">Näytä kansiossa</button>`;
  html += `</div></div>`;
  return html;
}

function duplicateCard(d, ctx) {
  const original = ctx.data.downloads[d.duplicateOf];
  return `
    <div class="card danger ${ctx.state.fixId === d.id ? "highlight" : ""}" id="card-${escapeHtml(d.id)}">
      <div class="toolbar">
        <strong>${escapeHtml(baseName(d.path || d.fullPath) || d.originalName)}</strong>
        <span class="muted">${formatDate(d.time)}</span>
      </div>
      <div class="notice info" style="margin:8px 0 0">
        Sama tiedosto on tallennettu aiemmin:
        <div class="path" style="margin-top:4px">${escapeHtml(original ? original.path : "")}</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-action="remove-copy" data-id="${escapeHtml(d.id)}">Poista uusi kopio</button>
        <button class="btn" data-action="keep-both" data-id="${escapeHtml(d.id)}">Pidä molemmat</button>
      </div>
    </div>`;
}

export function bind(root, ctx) {
  const { state } = ctx;

  if (state.fixId) {
    const card = root.querySelector(`#card-${CSS.escape(state.fixId)}`);
    if (card) card.scrollIntoView({ block: "center" });
  }

  root.addEventListener("change", event => {
    const field = event.target.dataset.field;
    if (!field) return;
    const draft = state.drafts[event.target.dataset.id];
    if (field === "remember") draft.remember = event.target.checked;
    else if (field === "type") { draft.fileName = swapPrefix(draft.fileName, draft.type, event.target.value); draft.type = event.target.value; }
    else draft[field] = event.target.value;
    ctx.render();
  });

  // Nimeä kirjoitettaessa tallennetaan valinta piirtämättä uudelleen
  root.addEventListener("input", event => {
    if (event.target.dataset.field === "fileName") state.drafts[event.target.dataset.id].fileName = event.target.value;
  });

  root.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const id = button.dataset.id;
    const draft = state.drafts[id];
    try {
      switch (button.dataset.action) {
        case "grant": {
          const note = grantNote(await grantFolderPermission());
          ctx.showMessage(note.kind, note.text);
          break;
        }
        case "pick":
          draft.courseId = button.dataset.course;
          ctx.render();
          break;
        case "create-course": {
          const entry = ctx.data.downloads[id];
          draft.courseId = await ask("addCourseFromPage", { moodleId: entry.moodleId, title: entry.moodleTitle });
          ctx.render();
          break;
        }
        case "refile":
          button.disabled = true;
          await ask("refile", { id, courseId: draft.courseId, type: draft.type, fileName: draft.fileName, remember: draft.remember });
          delete state.drafts[id];
          ctx.showMessage("ok", "Tiedosto siirretty kurssin kansioon.");
          break;
        case "confirm":
          await ask("confirm", { id });
          delete state.drafts[id];
          break;
        case "remove-copy":
          await ask("removeCopy", { id });
          ctx.showMessage("ok", "Uusi kopio poistettu.");
          break;
        case "keep-both":
          await ask("keepBoth", { id });
          break;
        case "show":
          showInFolder(ctx.data.downloads[id]);
          break;
      }
    } catch (error) {
      ctx.showMessage("error", error.message);
    }
  });
}
