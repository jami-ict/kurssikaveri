// courseView.js – yhden kurssin sivu: määräajat, uudet kohteet ja koko sisältö
// Moodlen välilehtien mukaan (sama rakenne kuin kurssin kansio ja Kurssin tiedot.md).

import { courseFolder, COURSE_FILE } from "../shared/rules.js";
import { updateData, moodleBase } from "../shared/store.js";
import { escapeHtml, STATUS_LABELS, obsidianUrl, openEntry, baseName, isPresent, formatDate, saveCourseFiles, saveCourseLabel, savingCourses, ask } from "../shared/ui.js";
import { courseSummary, courseDates, formatDeadline, relativeDays, isNew } from "../shared/status.js";
import { KINDS, fileKey, videoInfo, formatStart } from "../shared/contents.js";
import { icon } from "../shared/icons.js";
import { requestPermission, permissionState, readFile } from "../shared/fsstore.js";
import { readableText, readErrorMessage, downloadPathPattern, missingDownloadMessage } from "../shared/savedText.js";

const FILTERS = [["all", "Kaikki"], ["files", "Tiedostot"], ["links", "Linkit ja videot"]];
const CLIP_FOLDER_TEXT = "Omat tallennukset";
const LINKISH = ["link", "video", "tool"];

// Avausvalinnat muistetaan kurssikohtaisesti tämän Kurssikaveri-välilehden ajan.
function courseFolds(state, courseId) {
  state.courseFolds ??= new Map();
  if (!state.courseFolds.has(courseId)) state.courseFolds.set(courseId, { deadlines: true, content: true });
  return state.courseFolds.get(courseId);
}

function fold(folds, id, name, iconName, summary, body) {
  const open = Boolean(folds[id]);
  // Tallennusikkunan suora linkki kohdistuu näkyvään kansiopainikkeeseen.
  const buttonId = id === "texts" ? "course-saved-texts" : `course-fold-${id}`;
  return `<section class="fold sfold course-fold${open ? " open" : ""}" aria-labelledby="course-title-${id}">
    <span class="back" aria-hidden="true"></span>
    <h2 class="course-fold-heading"><button class="sf-cover" type="button" id="${buttonId}" data-action="course-fold" data-id="${id}"
      aria-labelledby="course-title-${id}" aria-describedby="course-summary-${id}" aria-expanded="${open}" aria-controls="course-body-${id}">
      <span class="ftab">${icon(iconName)}<span id="course-title-${id}">${name}</span></span>
      <span class="sf-face"><span id="course-summary-${id}">${escapeHtml(summary)}</span>${icon("chevron")}</span>
    </button></h2>
    <div class="fbody" id="course-body-${id}"${open ? "" : " hidden"}>${body}</div>
  </section>`;
}

export function render(ctx) {
  const { data, exists, state } = ctx;
  const course = data.courses.find(c => c.id === state.courseId);
  if (!course) {
    return `<button class="backbtn" data-action="back" aria-label="Takaisin kursseihin">${icon("left")}<span>Kurssit</span></button>
      <div class="card empty">Kurssia ei löytynyt. Se on ehkä poistettu.</div>`;
  }
  const now = Date.now();
  const s = courseSummary(data, course, exists, now);
  const settings = data.settings;
  const obsidian = obsidianUrl(settings, `${courseFolder(settings, course)}/${COURSE_FILE}`);
  const meta = data.contentsMeta[course.moodleId || `course-${course.id}`];
  const folds = courseFolds(state, course.id);
  if (state.openSavedTexts) folds.texts = true;

  let html = `
    <button class="backbtn" data-action="back" aria-label="Takaisin kursseihin">${icon("left")}<span>Kurssit</span></button>
    <div class="toolbar" style="margin-top:8px">
      <div>
        <h1 style="margin-bottom:2px">${escapeHtml(course.name)}</h1>
        <div class="muted">${[course.code, course.group, courseDates(course), course.semester].filter(Boolean).map(escapeHtml).join(" · ")}</div>
      </div>
      <label class="inline">Tila
        <select id="course-status" aria-label="Kurssin tila">
          ${Object.entries(STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${key === course.status ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
    </div>`;
  if (state.message) html += `<div class="notice ${state.message.kind}">${escapeHtml(state.message.text)}</div>`;

  html += `
    <div class="actions">
      ${s.content && (s.unsaved > 0 || s.unknownFolders > 0) ? `<button class="btn primary" data-action="save-course" ${savingCourses.has(course.moodleId) ? "disabled" : ""}>${saveCourseLabel(s, course.moodleId)}</button>` : ""}
      ${course.moodleId ? `<button class="btn${s.content && (s.unsaved > 0 || s.unknownFolders > 0) ? "" : " primary"}" data-action="open-url" data-url="${escapeHtml(`${moodleBase(settings)}/course/view.php?id=${course.moodleId}`)}">Avaa Moodlessa</button>` : ""}
      ${obsidian ? `<button class="btn" data-action="open-url" data-url="${escapeHtml(obsidian)}">Avaa Obsidianissa</button>` : ""}
      ${settings.storage !== "folder" && meta && meta.downloadId ? `<button class="btn" data-action="show-folder" data-download="${meta.downloadId}">Näytä kansio</button>` : ""}
    </div>
    <div class="stats">
      ${s.content ? `<span><strong>${s.saved}/${s.total}</strong> tiedostoa tallennettu</span>` : ""}
      ${s.content ? `<span><strong>${s.links}</strong> linkkiä ja videota</span>` : ""}
    </div>
    <div class="muted">Kurssikansio: ${escapeHtml(courseFolder(settings, course))}</div>`;

  // Opettaja on vaihtanut tallennettuja tiedostoja Moodlessa
  if (s.updated.length) {
    html += `<div class="notice info upd-note">
      <span>${s.updated.length === 1 ? "1 tallennettu tiedosto on" : `${s.updated.length} tallennettua tiedostoa on`} päivitetty Moodlessa:
        ${s.updated.slice(0, 3).map(d => `<b>${escapeHtml(d.fileName || baseName(d.path))}</b>`).join(", ")}${s.updated.length > 3 ? " …" : ""}.
        Vanha versio jää talteen, kun tallennat uuden.</span>
      <button class="btn small primary" data-action="save-updates">${s.updated.length === 1 ? "Tallenna uusi versio" : "Tallenna uudet versiot"}</button>
    </div>`;
  }

  if (s.endingSoon && s.unsaved > 0) {
    html += `<div class="notice info">Kurssi päättyy ${s.daysLeft} päivän päästä, ja ${s.unsaved} ${s.unsaved === 1 ? "tiedosto on" : "tiedostoa on"} tallentamatta.
      Kurssin materiaalit voivat poistua näkyvistä kurssin päätyttyä.</div>`;
  }

  html += `<div class="course-folds">`;

  // Määräajat
  if (s.deadlines.length) {
    const next = s.deadlines.find(d => !d.submitted && d.time >= now);
    const summary = `${s.deadlines.length} ${s.deadlines.length === 1 ? "määräaika" : "määräaikaa"}${next ? ` · seuraava ${formatDeadline(next.time)}` : ""}`;
    html += fold(folds, "deadlines", "Määräajat", "clock", summary, `<div class="list">${s.deadlines.map(d => `
      <div class="row">
        <div style="min-width:0">
          <div class="name">${escapeHtml(d.name)}</div>
          <div class="muted">${escapeHtml(d.label)} ${formatDeadline(d.time)} · ${d.submitted
            ? `<span class="tag ok">${icon("check")} Palautettu</span>`
            : `<span class="${d.overdue ? "error" : ""}">${relativeDays(d.time, now)}</span>`}</div>
        </div>
        <button class="btn small" data-action="open-url" data-url="${escapeHtml(d.url)}">Avaa tehtävä</button>
      </div>`).join("")}</div>
      <p class="muted small">Vain Moodlen tehtävät, joille on asetettu määräaika. Tarkista kurssin ohjeet.</p>`);
  }

  // Uutta
  if (s.newItems.length) {
    const summary = `${s.newItems.length} ${s.newItems.length === 1 ? "uusi kohde" : "uutta kohdetta"} · ${s.newItems[0].name}`;
    html += fold(folds, "new", "Uutta viimeisen 2 viikon aikana", "new", summary, `<div class="list">${s.newItems.map(i => `
      <div class="row">
        <div style="min-width:0">
          <div class="name">${icon((KINDS[i.kind] || KINDS.activity).icon, { className: "kind" })} ${escapeHtml(i.name)}</div>
          <div class="muted">${escapeHtml(i.section)} · löytyi ${formatDate(i.firstSeen)}${i.addedFiles ? ` · uudet tiedostot: ${i.addedFiles.map(f => escapeHtml(f.name)).join(", ")}` : ""}</div>
        </div>
      </div>`).join("")}</div>`);
  }

  html += ownLinks(data, course, folds);
  html += savedTexts(data, course, folds);
  const foot = `</div>${courseFoot(settings)}`;

  if (!course.moodleId) {
    const files = otherFiles(ctx, course, new Set());
    html += fold(folds, "content", "Tiedostot", "folder", files ? "Kurssikansioon tallennetut tiedostot" : "Ei tallennettuja tiedostoja",
      files || `<div class="list"><div class="empty">Ei tallennettuja tiedostoja.</div></div>`);
    return html + foot;
  }
  if (!s.content) {
    const files = otherFiles(ctx, course, new Set());
    html += fold(folds, "content", "Sisältö", "folder", "Sisältöä ei ole vielä luettu Moodlesta",
      `<div class="list"><div class="empty">Avaa kurssi kerran Moodlessa, niin sen tiedostot, linkit ja videot tulevat tänne näkyviin.</div></div>`
      + (files ? `<h3>Muut tallennetut tiedostot</h3>${files}` : ""));
    return html + foot;
  }

  // Sisältö välilehdittäin
  let contentHtml = `<div class="tabs">${FILTERS.map(([key, label]) => `<button class="tab ${state.itemFilter === key ? "active" : ""}" id="course-filter-${key}" data-action="filter" data-filter="${key}" aria-pressed="${state.itemFilter === key}">${label}</button>`).join("")}</div>`;
  const missing = s.unreadTabs;
  if (missing.length) contentHtml += `<p class="muted">Osa kurssista puuttuu vielä (${missing.map(escapeHtml).join(", ")}). Avaa kurssi Moodlessa, niin se päivittyy.</p>`;
  else if (s.materialsUnchecked) contentHtml += `<p class="muted">Kaikkia materiaaleja ei ole vielä tarkistettu. Avaa kurssi Moodlessa, niin sisältö päivittyy.</p>`;

  const used = new Set();
  const sections = Object.entries(s.content.sections || {}).sort((a, b) => a[1].order - b[1].order);
  for (const [name, info] of sections) {
    const items = info.items.filter(i => state.itemFilter === "all"
      || (state.itemFilter === "files" ? ["file", "folder"].includes(i.kind) : LINKISH.includes(i.kind)));
    if (items.length === 0 && state.itemFilter !== "all") continue;
    contentHtml += `<h3 class="section-title">${escapeHtml(name)}</h3>`;
    if (items.length === 0) { contentHtml += `<p class="muted small">Ei sisältöä.</p>`; continue; }
    contentHtml += `<div class="list">${items.map(item => itemRow(item, s, data, now, used)).join("")}</div>`;
  }
  const others = otherFiles(ctx, course, used);
  if (others && state.itemFilter !== "links") contentHtml += `<h3>Muut tallennetut tiedostot</h3>${others}`;
  const summary = `${s.saved}/${s.total} tiedostoa tallennettu · ${s.links} linkkiä ja videota${s.materialsUnchecked ? " · materiaaleja tarkistamatta" : ""}`;
  html += fold(folds, "content", "Sisältö", "folder", summary, contentHtml);
  return html + foot;
}

// Harvoin tarvittavat toiminnot sivun lopussa: Kurssin tiedot.md päivittyy muutenkin itsestään, ja poisto on peruuttamaton.
function courseFoot(settings) {
  return `
    <div class="course-foot">
      ${settings.storage === "folder" ? `<button class="btn" data-action="ensure-folder" title="Päivittää kurssin yhteenvetotiedoston ja luo kurssikansion, jos se puuttuu.">Päivitä ${COURSE_FILE}</button>` : ""}
      <button class="btn danger" data-action="remove">Poista kurssi</button>
    </div>`;
}

function itemRow(item, s, data, now, used) {
  const kind = KINDS[item.kind] || KINDS.activity;
  const deadline = s.deadlines.find(d => d.cmid === item.cmid && !item.embedded);
  const tags = [
    isNew(item.firstSeen, now) ? `<span class="tag new">Uusi</span>` : "",
    deadline && deadline.submitted ? `<span class="tag ok">${icon("check")} Palautettu</span>` : "",
    deadline && !deadline.submitted ? `<span class="tag ${deadline.overdue ? "late" : "deadline"}">${icon("clock")} ${escapeHtml(deadline.label)} ${formatDeadline(deadline.time)}</span>` : ""
  ].join("");
  const info = [item.label, kind.label, item.service, item.duration].filter(Boolean).map(escapeHtml).join(" · ");
  let actions = "";
  let extra = "";

  if (item.kind === "file") {
    const entry = s.savedMap[fileKey(item.cmid)];
    if (entry) used.add(entry.id);
    actions = entry && entry.update
      ? `<span class="tag upd">Päivitetty Moodlessa</span><button class="btn small primary" data-action="save-update" data-id="${escapeHtml(entry.id)}">Tallenna uusi versio</button><button class="btn small" data-action="open-file" data-id="${escapeHtml(entry.id)}">Avaa vanha</button>`
      : entry
      ? `<span class="tag ok">${icon("check")} Tallennettu</span><button class="btn small" data-action="open-file" data-id="${escapeHtml(entry.id)}">Avaa</button>`
      : `<span class="muted small">Ei tallennettu</span><button class="btn small" data-action="open-url" data-url="${escapeHtml(item.moodleUrl)}">Moodlessa</button>`;
  } else if (item.kind === "folder") {
    const files = item.files || [];
    const savedCount = files.filter(f => s.savedMap[fileKey(item.cmid, f.subpath, f.name)]).length;
    actions = item.files
      ? `<span class="${savedCount === files.length && files.length ? "tag ok" : "muted small"}">${savedCount}/${files.length} tallennettu</span>`
      : `<span class="muted small">Tiedostot näkyvät, kun kurssi on avattu Moodlessa</span>`;
    actions += `<button class="btn small" data-action="open-url" data-url="${escapeHtml(item.moodleUrl)}">Moodlessa</button>`;
    if (files.length) {
      extra = `<details class="folder-files"><summary>Näytä tiedostot (${files.length})</summary>${files.map(f => {
        const entry = s.savedMap[fileKey(item.cmid, f.subpath, f.name)];
        if (entry) used.add(entry.id);
        return `<div class="file-line">
          <span>${escapeHtml(`${f.subpath || ""}${f.name}`)} ${isNew(f.firstSeen, now) && !isNew(item.firstSeen, now) ? `<span class="tag new">Uusi</span>` : ""}</span>
          ${entry && entry.update ? `<span><span class="tag upd">Päivitetty</span> <button class="link" data-action="save-update" data-id="${escapeHtml(entry.id)}">Tallenna uusi versio</button></span>`
            : entry ? `<button class="link" data-action="open-file" data-id="${escapeHtml(entry.id)}">Avaa</button>` : `<span class="muted small">ei tallennettu</span>`}
        </div>`;
      }).join("")}</details>`;
    }
  } else if (LINKISH.includes(item.kind)) {
    actions = `<button class="btn small" data-action="open-url" data-url="${escapeHtml(item.target || item.moodleUrl)}">Avaa</button>`;
    if (item.target && !item.embedded) actions += `<button class="btn small" data-action="open-url" data-url="${escapeHtml(item.moodleUrl)}">Moodlessa</button>`;
  } else {
    actions = `<button class="btn small" data-action="open-url" data-url="${escapeHtml(item.moodleUrl)}">Moodlessa</button>`;
  }

  let host = "";
  if (item.target && !item.service) { try { host = new URL(item.target).hostname.replace(/^www\./, ""); } catch (e) { /* ei osoite */ } }

  return `
    <div class="row item">
      <div style="min-width:0;flex:1">
        <div class="name">${icon(kind.icon, { className: "kind", label: kind.label })} ${escapeHtml(item.name)} ${tags}</div>
        <div class="muted small">${info}${host ? ` · ${escapeHtml(host)}` : ""}</div>
        ${item.description ? `<div class="muted small clamp">${escapeHtml(item.description)}</div>` : ""}
        ${extra}
      </div>
      <div class="actions" style="margin:0;flex-shrink:0">${actions}</div>
    </div>`;
}

// Omat linkit: nettisivut, jotka käyttäjä on tallentanut kurssille ponnahdusikkunasta (uusin ensin)
function ownLinks(data, course, folds) {
  const links = data.bookmarks.filter(b => b.courseId === course.id)
    .sort((a, b) => (videoInfo(b.url) ? 1 : 0) - (videoInfo(a.url) ? 1 : 0) || b.created - a.created); // videot ensin
  if (links.length === 0) return "";
  return fold(folds, "links", "Omat linkit", "link", `${links.length} ${links.length === 1 ? "linkki" : "linkkiä"}`, `<div class="list">${links.map(b => {
    let host = "";
    try { host = new URL(b.url).hostname.replace(/^www\./, ""); } catch (e) { /* ei osoite */ }
    const video = videoInfo(b.url);
    const kind = video ? icon(KINDS.video.icon, { className: "kind", label: "Video" }) : icon(KINDS.link.icon, { className: "kind", label: "Oma linkki" });
    const meta = video
      ? [video.site, video.start ? `alkaen ${formatStart(video.start)}` : "", `tallennettu ${formatDate(b.created)}`]
      : [host, `tallennettu ${formatDate(b.created)}`, b.clipPath ? (b.clipSelection ? "valittu teksti tallessa" : "teksti tallessa") : ""];
    const clipUrl = b.clipPath ? obsidianUrl(data.settings, `${courseFolder(data.settings, course)}/${b.clipPath}`) : "";
    return `
    <div class="row item">
      <div style="min-width:0;flex:1">
        <div class="name">${kind} ${escapeHtml(b.title || host || b.url)}</div>
        <div class="muted small">${meta.filter(Boolean).map(escapeHtml).join(" · ")}</div>
        ${b.note ? `<div class="muted small clamp">${escapeHtml(b.note)}</div>` : ""}
      </div>
      <div class="actions" style="margin:0;flex-shrink:0">
        <button class="btn small" data-action="open-url" data-url="${escapeHtml(b.url)}">Avaa</button>
        ${b.clipPath ? showTextButton(data.settings, "clip", b.id) : ""}
        ${clipUrl ? `<button class="btn small" data-action="open-url" data-url="${escapeHtml(clipUrl)}">Teksti Obsidianissa</button>` : ""}
        <button class="btn small danger" data-action="remove-link" data-id="${escapeHtml(b.id)}" aria-label="Poista linkki ${escapeHtml(b.title || host)}">Poista</button>
      </div>
    </div>`;
  }).join("")}</div>
  <p class="muted small">Lisää linkkejä Kurssikaverin työkalupalkin kuvakkeesta.</p>`);
}

// Omat tallennukset: nettisivuilta hiiren oikealla tallennetut tekstit (uusin ensin), erillään kurssin linkeistä
function savedTexts(data, course, folds) {
  const texts = data.savedTexts.filter(t => t.courseId === course.id).sort((a, b) => b.saved - a.saved);
  if (texts.length === 0) return "";
  return fold(folds, "texts", "Omat tallennukset", "page", `${texts.length} ${texts.length === 1 ? "teksti" : "tekstiä"}`, `<div class="list">${texts.map(t => {
    let host = "";
    try { host = new URL(t.url).hostname.replace(/^www\./, ""); } catch (e) { /* ei osoite */ }
    const fileUrl = obsidianUrl(data.settings, `${courseFolder(data.settings, course)}/${t.path}`);
    return `
    <div class="row item">
      <div style="min-width:0;flex:1">
        <div class="name">${escapeHtml(t.title || host || "Tallennettu teksti")}</div>
        <div class="muted small">${[host, `tallennettu ${formatDate(t.saved)}`].filter(Boolean).map(escapeHtml).join(" · ")}</div>
        ${t.note ? `<div class="muted small clamp">${escapeHtml(t.note)}</div>` : ""}
        ${(t.tags || []).length ? `<div class="muted small">${t.tags.map(tag => `#${escapeHtml(tag)}`).join(" ")}</div>` : ""}
      </div>
      <div class="actions" style="margin:0;flex-shrink:0">
        ${showTextButton(data.settings, "text", t.id)}
        ${fileUrl ? `<button class="btn small" data-action="open-url" data-url="${escapeHtml(fileUrl)}">Obsidianissa</button>` : ""}
        <button class="btn small" data-action="open-url" data-url="${escapeHtml(t.url)}">Lähde</button>
        <button class="btn small danger" data-action="remove-text" data-id="${escapeHtml(t.id)}" aria-label="Poista tallennus ${escapeHtml(t.title || host)} listalta">Poista</button>
      </div>
    </div>`;
  }).join("")}</div>
  <p class="muted small">Tallenna valittu teksti sivun hiiren oikean painikkeen valikosta. Tiedostot ovat kurssikansion ${CLIP_FOLDER_TEXT} -kansiossa.</p>`);
}

// Näytä teksti: omassa opintokansiossa teksti luetaan ja näytetään ikkunassa. Lataukset-kansiota lisäosa ei voi lukea,
// joten siellä tiedosto näytetään Resurssienhallinnassa (Chromen lataushistorian kautta).
function showTextButton(settings, kind, id) {
  return `<button class="btn small" data-action="show-text" data-kind="${kind}" data-id="${escapeHtml(id)}">${settings.storage === "folder" ? "Näytä teksti" : "Näytä kansiossa"}</button>`;
}

async function showSavedText(ctx, course, el) {
  const { data } = ctx;
  const clip = el.dataset.kind === "clip";
  const item = clip ? data.bookmarks.find(b => b.id === el.dataset.id) : data.savedTexts.find(t => t.id === el.dataset.id);
  const relative = item && (clip ? item.clipPath : item.path);
  if (!relative) return;
  const dir = courseFolder(data.settings, course);
  const fallback = { title: item.title, url: item.url, note: item.note, tags: item.tags };
  const opener = `[data-action="show-text"][data-kind="${el.dataset.kind}"][data-id="${CSS.escape(el.dataset.id)}"]`;

  if (data.settings.storage !== "folder") {
    const [found] = await chrome.downloads.search({ filenameRegex: downloadPathPattern(dir, relative), exists: true, orderBy: ["-startTime"], limit: 1 });
    if (found) chrome.downloads.show(found.id);
    else openTextDialog({ title: item.title || "Tallennettu teksti", error: missingDownloadMessage(relative) }, opener);
    return;
  }
  let text;
  try {
    if (await permissionState() === "prompt") await requestPermission(); // painalluksesta, joten Chrome voi kysyä luvan
    text = await (await readFile(`${dir}/${relative}`)).text();
  } catch (error) {
    openTextDialog({ title: item.title || "Tallennettu teksti", error: readErrorMessage(error) }, opener);
    return;
  }
  openTextDialog({ ...readableText(text, fallback), saved: clip ? (item.clipped || item.created) : item.saved, path: relative }, opener);
}

// Täyttää library.html:n ikkunan. Sulkeminen (Sulje tai Esc) palauttaa kohdistuksen avanneeseen painikkeeseen,
// joka haetaan uudelleen, koska sivu on voinut piirtyä uudelleen ikkunan ollessa auki.
function openTextDialog(view, opener) {
  const dialog = document.getElementById("text-view");
  if (!dialog) return;
  if (dialog.open) dialog.close();
  const part = id => document.getElementById(`text-view-${id}`);
  const set = (id, value) => { part(id).textContent = value || ""; part(id).hidden = !value; };
  let host = "";
  try { host = view.source ? new URL(view.source).hostname.replace(/^www\./, "") : ""; } catch (e) { /* ei osoite */ }
  set("title", view.title);
  set("meta", view.error ? "" : [host, view.saved ? `tallennettu ${formatDate(view.saved)}` : "", view.selection ? "valittu teksti" : "", view.path].filter(Boolean).join(" · "));
  set("note", view.error ? "" : [view.note, (view.tags || []).map(tag => `#${tag}`).join(" ")].filter(Boolean).join(" · "));
  set("error", view.error);
  set("body", view.error ? "" : (view.body || "Tiedosto on tyhjä."));
  dialog.addEventListener("close", () => document.querySelector(opener)?.focus(), { once: true });
  dialog.showModal();
  part("body").scrollTop = 0;
  (view.error ? dialog.querySelector("form button") : part("body")).focus();
}

// Kurssille tallennetut tiedostot, joita ei löydy kerätystä sisällöstä (esim. järjestetty käsin)
function otherFiles(ctx, course, used) {
  const files = Object.values(ctx.data.downloads)
    .filter(d => d.courseId === course.id && d.status === "filed" && d.state === "complete" && !d.movingTo && !used.has(d.id) && isPresent(d, ctx.exists))
    .sort((a, b) => b.time - a.time);
  if (files.length === 0) return "";
  return `<div class="list">${files.map(d => `
    <div class="row clickable" data-action="open-file" data-id="${escapeHtml(d.id)}">
      <div style="min-width:0">
        <div class="name">${escapeHtml(baseName(d.path || d.fullPath) || d.fileName)}</div>
        <div class="muted">${d.oldVersion ? "vanha versio · " : ""}${[d.section, d.folder].filter(Boolean).map(escapeHtml).join(" · ")}${d.section || d.folder ? " · " : ""}${formatDate(d.time)}</div>
      </div>
      <span class="muted small">Avaa</span>
    </div>`).join("")}</div>`;
}

export function bind(root, ctx) {
  const course = ctx.data.courses.find(c => c.id === ctx.state.courseId);

  const status = root.querySelector("#course-status");
  if (status) status.addEventListener("change", async () => {
    try {
      await ask("setCourseStatus", { courseId: course.id, status: status.value, endHandled: true });
    } catch (error) { ctx.showMessage("error", error.message); }
  });

  root.addEventListener("click", async event => {
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled) return;
    try {
      switch (el.dataset.action) {
        case "course-fold": {
          const folds = courseFolds(ctx.state, course.id);
          folds[el.dataset.id] = !folds[el.dataset.id];
          ctx.render();
          break;
        }
        case "back": ctx.setView("courses"); break;
        case "ensure-folder": {
          el.disabled = true;
          if (await requestPermission() !== "granted") throw new Error("Kurssikaveri tarvitsee kirjoitusluvan opintokansioon.");
          await ask("createCourseFiles", { courseIds: [course.id], folderOnly: true });
          ctx.showMessage("ok", `${COURSE_FILE} päivitetty kansioon ${courseFolder(ctx.data.settings, course)}.`);
          window.scrollTo(0, 0); // ilmoitus näkyy sivun yläreunassa, painike on lopussa
          break;
        }
        case "save-course": {
          const result = await saveCourseFiles(course.moodleId, ctx.render);
          ctx.showMessage(result.kind, result.text);
          break;
        }
        case "save-update": {
          el.disabled = true;
          await ask("saveUpdate", { id: el.dataset.id });
          ctx.showMessage("ok", "Uusi versio tallennettu. Vanha versio on kohdassa Muut tallennetut tiedostot.");
          break;
        }
        case "save-updates": {
          el.disabled = true;
          const ids = courseSummary(ctx.data, course, ctx.exists).updated.map(d => d.id);
          let done = 0;
          const failed = [];
          for (const id of ids) {
            try { await ask("saveUpdate", { id }); done++; } catch (error) { failed.push(`${ctx.data.downloads[id].fileName}: ${error.message}`); }
          }
          ctx.showMessage(failed.length ? "error" : "ok", failed.length
            ? `Tallennettiin ${done}/${ids.length} uutta versiota. Jäi tallentamatta: ${failed.join("; ")}.`
            : `Tallennettiin ${done} ${done === 1 ? "uusi versio" : "uutta versiota"}. Vanhat versiot ovat kohdassa Muut tallennetut tiedostot.`);
          break;
        }
        case "filter": ctx.state.itemFilter = el.dataset.filter; ctx.render(); break;
        case "show-text": await showSavedText(ctx, course, el); break;
        case "open-url": chrome.tabs.create({ url: el.dataset.url }); break;
        case "show-folder": chrome.downloads.show(Number(el.dataset.download)); break;
        case "remove-link":
          await ask("removeBookmark", { id: el.dataset.id });
          ctx.showMessage("ok", "Linkki poistettu.");
          break;
        case "remove-text":
          if (!confirm("Poistetaanko tallennus listalta? Tiedosto jää kurssin kansioon.")) return;
          await ask("removeSavedText", { id: el.dataset.id });
          ctx.showMessage("ok", "Tallennus poistettu listalta. Tiedosto jäi kansioon.");
          break;
        case "open-file": {
          const entry = ctx.data.downloads[el.dataset.id];
          if (entry) await openEntry(entry);
          break;
        }
        case "remove": {
          if (!confirm(`Poistetaanko ${course.name} Kurssikaverista? Kurssin omat linkit ja tallennusten luettelo poistuvat Kurssikaverista. Tiedostot jäävät koneellesi.`)) return;
          await updateData(["courses", "moodleMap", "bookmarks", "savedTexts"], ({ courses, moodleMap, bookmarks, savedTexts }) => ({
            courses: courses.filter(c => c.id !== course.id),
            moodleMap: Object.fromEntries(Object.entries(moodleMap).filter(([, id]) => id !== course.id)),
            bookmarks: bookmarks.filter(b => b.courseId !== course.id),
            savedTexts: savedTexts.filter(t => t.courseId !== course.id)
          }));
          ctx.setView("courses");
          break;
        }
      }
    } catch (error) {
      ctx.showMessage("error", error.message);
      if (el.dataset.action === "ensure-folder") window.scrollTo(0, 0);
    }
  });
}
