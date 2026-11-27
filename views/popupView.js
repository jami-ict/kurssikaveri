// Popupin HTML. Sama kurssitilanne ja määräaikalista kuin muissa näkymissä.
// Tiedosto ei lue selainta tai muuta tietoja; tapahtumat liitetään popup.js:ssä.
import { moodleBase } from "../shared/store.js";
import { escapeHtml as esc, attentionCount, attentionItems, courseImportNotice } from "../shared/ui.js";
import { courseSummary, relativeDays, formatDeadline, formatDay } from "../shared/status.js";
import { upcomingEvents, dateKey } from "../shared/agenda.js";
import { colorVars } from "../shared/colors.js";
import { videoInfo, formatStart } from "../shared/contents.js";

const pageUrl = page => `library.html#${page}`;
const coursePage = id => `course=${encodeURIComponent(id)}`;
const safeWebUrl = value => /^https?:\/\//i.test(value || "") ? value : "";

function pageLink(page, text, className = "pp-link") {
  return `<a class="${className}" href="${esc(pageUrl(page))}" data-go="${esc(page)}">${esc(text)}</a>`;
}

function folder(id, title, body, kind = "") {
  return `<section class="pp-folder ${kind}" aria-labelledby="pp-${id}"><h2 class="pp-tab" id="pp-${id}">${esc(title)}</h2><div class="pp-face">${body}</div></section>`;
}

function notice(text, kind = "info") {
  return `<p class="pp-notice ${kind}" role="status">${esc(text)}</p>`;
}

// Moodlen kurssi päätellään avoimen sivun osoitteesta tai sille kirjatusta kurssista.
// Viimeksi avattua kurssia ei arvata tämän sivun kurssiksi.
export function popupContext(data, tab) {
  if (!safeWebUrl(tab?.url)) return { kind: "none" };
  let url, base;
  try { url = new URL(tab.url); base = new URL(moodleBase(data.settings)); } catch { return { kind: "none" }; }
  const basePath = base.pathname.replace(/\/$/, "");
  const inMoodle = url.origin === base.origin && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`));
  if (!inMoodle) return { kind: "bookmark" };
  if (url.pathname.includes("/pluginfile.php/")) {
    let name = url.pathname.split("/").pop();
    try { name = decodeURIComponent(name); } catch { /* Näytetään alkuperäinen nimi. */ }
    return { kind: "pdf", name, pdf: /\.pdf$/i.test(name) };
  }
  const moodleId = /\/course\/view\.php$/.test(url.pathname) ? Number(url.searchParams.get("id")) : data.pageCourses[tab.url]?.moodleId;
  const course = data.courses.find(c => Number(c.moodleId) === Number(moodleId) && moodleId);
  return course ? { kind: "course", course } : { kind: "none" };
}

function permissionNotice(state) {
  if (!state.needsPermission) return "";
  return `<aside class="pp-notice error"><strong>Tallennus odottaa lupaasi</strong><p>Anna lupa kansioon ”${esc(state.data.settings.folderName)}”${state.pending ? ` (${state.pending} tiedostoa odottaa)` : ""}.</p><button class="btn small" type="button" data-action="grant">Anna tallennuslupa</button></aside>`;
}

function bookmarkSection(state) {
  const { data, draft, bookmarkResult, editing, busy } = state;
  if (!draft) return "";
  if (bookmarkResult?.ok && !editing) {
    return folder("save", "Tallennettu", `<p class="pp-success" role="status">${esc(bookmarkResult.text)}</p><p class="pp-course">${esc(bookmarkResult.course)}</p><p class="pp-page-title">${esc(bookmarkResult.title)}</p>${bookmarkResult.note ? `<p class="muted small">Huomautus: ${esc(bookmarkResult.note)}</p>` : ""}
      ${bookmarkResult.warning ? notice(bookmarkResult.warning, "error") : ""}
      ${bookmarkResult.clipSaved ? `<p class="muted small">Kumoaminen koskee linkkiä. Tallennettu tekstitiedosto säilyy kansiossa.</p>` : ""}
      <div class="pp-result-actions">${bookmarkResult.undoToken ? `<button class="link" type="button" data-action="undo" ${busy ? "disabled" : ""}>${bookmarkResult.clipSaved ? "Kumoa linkki" : "Kumoa"}</button>` : ""}<button class="link" type="button" data-action="edit">${draft.note ? "Muokkaa huomautusta" : "Lisää huomautus"}</button>${pageLink(coursePage(bookmarkResult.courseId), "Kurssin linkit")}</div>`, "pp-saved");
  }
  const video = videoInfo(draft.url);
  let host = "";
  try { host = new URL(draft.url).hostname.replace(/^www\./, ""); } catch { /* Osoite tarkistetaan ennen luonnoksen luontia. */ }
  const already = data.bookmarks.some(b => b.url === draft.url && b.courseId === draft.courseId);
  const texts = data.savedTexts.filter(t => t.url === draft.url && t.courseId === draft.courseId).length;
  const courses = [...data.courses].sort((a,b) => (a.status === "completed") - (b.status === "completed") || a.name.localeCompare(b.name,"fi"));
  const selected = courses.find(c => c.id === draft.courseId);
  const label = `${already ? "Päivitä" : "Tallenna"} ${draft.clip ? "linkki ja teksti" : "linkki"}`;
  return folder("save", video ? "Tallenna videon linkki" : "Tallenna sivu", `
    <p class="pp-page-title" id="bm-preview">${esc(draft.title)}</p><p class="pp-source">${esc(video ? `${video.site}${video.start ? ` · alkaen ${formatStart(video.start)}` : ""}` : host)}</p>
    ${permissionNotice(state)}<form id="bookmark-form"><div class="pp-save-row"><label for="bm-course">Kurssi<select id="bm-course" name="courseId" required><option value="">Valitse kurssi</option>${courses.map(c=>`<option value="${esc(c.id)}" ${c.id===draft.courseId ? "selected" : ""}>${esc(c.name)}${c.status === "completed" ? " (päättynyt)" : ""}</option>`).join("")}</select></label>
    <button class="btn primary" type="submit" ${busy ? "disabled" : ""}>${busy === "bookmark" ? "Tallennetaan…" : label}</button></div>
    <p class="pp-selected-course" id="bm-selected">${esc(selected?.name || "")}</p><div class="pp-options">
      <details data-draft-detail="noteOpen" ${draft.noteOpen ? "open" : ""}><summary>${draft.note ? "Muokkaa huomautusta" : "Lisää huomautus"}</summary><label for="bm-note">Huomautus (valinnainen)<textarea id="bm-note" name="note" maxlength="300">${esc(draft.note)}</textarea></label></details>
      <details data-draft-detail="extrasOpen" ${draft.extrasOpen ? "open" : ""}><summary>Lisävalinnat</summary><label for="bm-title">Linkin otsikko<input id="bm-title" name="title" value="${esc(draft.title)}" maxlength="200" required></label>
      ${video ? "" : `<label class="pp-check"><input type="checkbox" id="bm-clip" name="clip" ${draft.clip ? "checked" : ""}><span>Tallenna myös koko sivun teksti<small>Markdown-tiedostona kurssin kansioon.</small></span></label><button class="btn" type="button" data-action="print" ${busy ? "disabled" : ""}>Avaa tulostusversio</button>`}</details></div></form>
      ${bookmarkResult && !bookmarkResult.ok ? notice(bookmarkResult.text,"error") : ""}
      ${!bookmarkResult && already ? `<p class="muted small">Sivu on jo tämän kurssin linkeissä.</p>` : ""}${texts ? `<p class="muted small">Tältä sivulta on ${texts} ${texts === 1 ? "teksti" : "tekstiä"} kurssin Omissa tallennuksissa.</p>` : ""}`, "pp-save");
}

function saveSection(state) {
  if (state.context.kind === "bookmark") return bookmarkSection(state);
  const { context, data, exists, now, busy, tabResult } = state;
  if (!["pdf","course"].includes(context.kind)) return "";
  const course = context.course;
  const summary = course ? courseSummary(data,course,exists,now) : null;
  const label = course ? `Tallenna kurssin puuttuvat tiedostot${summary.unknownFolders ? "" : ` (${summary.unsaved})`}` : context.pdf === false ? "Tallenna tiedosto kurssille" : "Tallenna PDF kurssille";
  return folder("save", course ? "Avoin Moodle-kurssi" : context.pdf === false ? "Avoin Moodle-tiedosto" : "Avoin Moodle-PDF", `<p class="pp-page-title">${esc(course?.name || context.name)}</p>${permissionNotice(state)}
    ${summary?.materialsUnchecked ? `<p class="muted small">Osaa kurssin sisällöstä ei ole vielä luettu. Avaa kurssi Moodlessa, jotta kaikki materiaalit löytyvät.</p>` : ""}
    ${summary && !summary.unsaved && !summary.unknownFolders ? `<p class="pp-success">Kaikki tunnetut tiedostot ovat tallessa.</p>` : `<button class="btn primary pp-save-wide" type="button" data-action="${course ? "save-course" : "save-tab"}" ${busy || state.needsPermission ? "disabled" : ""}>${busy === "files" ? "Tallennetaan…" : esc(label)}</button>`}
    ${tabResult ? notice(tabResult.text,tabResult.kind) : ""}${course ? pageLink(coursePage(course.id), "Avaa kurssi") : ""}`, "pp-save");
}

function eventTarget(event) {
  return safeWebUrl(event.url) ? {href:event.url,external:true} : {href:pageUrl(`calendar=${dateKey(event.time)}`),page:`calendar=${dateKey(event.time)}`};
}

function eventLink(event, className, body) {
  const target = eventTarget(event);
  return `<a class="${className}" href="${esc(target.href)}" ${target.external ? "data-external" : `data-go="${esc(target.page)}"`}>${body}</a>`;
}

function eventDate(event) {
  return event.allDay ? `${formatDay(event.time,true)} · koko päivä` : formatDeadline(event.time);
}

function deadlinesSection(state, events) {
  const {data,now,refreshing,refreshError} = state;
  const fetched = data.deadlines.fetched;
  const date = fetched ? new Date(fetched).toLocaleString("fi-FI",{day:"numeric",month:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
  const error = data.deadlines.error || refreshError;
  const login = error === "login";
  const sync = `<div class="pp-sync"><span>${refreshing ? "Tarkistetaan Moodlea…" : fetched ? `Viimeisin haku ${esc(date)}` : "Määräaikoja ei ole vielä haettu"}</span><button class="link" type="button" data-action="refresh" ${refreshing ? "disabled" : ""}>Päivitä</button></div>
    ${error ? `<aside class="pp-notice error"><p>${login ? "Kirjaudu Moodleen, jotta määräajat voidaan päivittää." : "Tarkistus jäi kesken. Näytetään viimeksi haetut määräajat; tarkista ajantasaiset tiedot Moodlesta."}</p><a class="pp-link" href="${esc(moodleBase(data.settings))}/my/" data-external>${login ? "Kirjaudu Moodleen" : "Tarkista Moodlesta"}</a></aside>` : ""}`;
  if (!events.length) return folder("next","Seuraava määräaika",`${sync}<p>Ei tiedossa olevia määräaikoja.</p>${pageLink("calendar","Avaa kalenteri")}`,"pp-next");
  const event = events[0];
  const dot = colorVars(event.color).dot;
  return folder("next","Seuraava määräaika",`${sync}<div class="pp-nearest" style="--course-dot:${dot}"><p class="pp-relative ${event.time < now ? "late" : ""}">${esc(relativeDays(event.time,now))}${event.allDay ? "" : ` klo ${new Date(event.time).toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"})}`}</p>
    <p class="pp-date">${esc(eventDate(event))}</p>${eventLink(event,"pp-event-title",esc(event.title))}<p class="pp-course">${esc(event.courseName)}${event.source === "own" ? `<span class="pp-own">Oma määräaika</span>` : ""}</p></div>`,"pp-next");
}

function otherDeadlines(events) {
  const rows = events.slice(1,3).map(event=>eventLink(event,"pp-deadline",`<span class="pp-date">${esc(eventDate(event))}${event.source === "own" ? `<span class="pp-own">Oma määräaika</span>` : ""}</span><strong>${esc(event.title)}</strong><span class="pp-course">${esc(event.courseName)}</span>`)).join("");
  return folder("other","Muut määräajat",`${rows}${pageLink("calendar","Avaa kalenteri")}`);
}

export function renderPopup(state) {
  const {data,exists,now} = state;
  if (!data.settings.onboarded) return folder("start","Tervetuloa",`<p>Valitse ensin, mihin opintosi tallennetaan.</p><button class="btn primary" type="button" data-action="onboarding">Avaa aloitusopas</button>`);
  if (!data.courses.length) return folder("start","Lisää kurssisi",`<p>${esc(courseImportNotice(data) || "Tuo kurssisi Moodlesta. Sen jälkeen voit tallentaa materiaaleja kurssikansioihin.")}</p>${pageLink("import","Tuo kurssit Moodlesta","btn primary")}`);
  const pending = attentionItems(data,exists).pending.length;
  state = {...state,pending,needsPermission:data.settings.storage === "folder" && (state.permission !== "granted" || pending > 0)};
  const events = upcomingEvents(data,now);
  const next = deadlinesSection(state,events);
  const saving = saveSection(state);
  let html = data.settings.popupFirst === "save" ? saving+next : next+saving;
  if (!saving) html += permissionNotice(state);
  if (state.permissionResult) html += notice(state.permissionResult.text,state.permissionResult.kind);
  html += otherDeadlines(events);
  const summaries = data.courses.map(course=>({course,s:courseSummary(data,course,exists,now)}));
  const withNew = summaries.filter(({s})=>s.newItems.length || s.updated.length).slice(0,3);
  if (withNew.length) html += folder("new","Uutta kursseilla",withNew.map(({course,s})=>pageLink(coursePage(course.id),`${course.name} · ${[s.newItems.length ? `${s.newItems.length} uutta` : "",s.updated.length ? `${s.updated.length} päivitetty` : ""].filter(Boolean).join(" · ")}`,"pp-material")).join(""));
  const count = attentionCount(data,exists);
  const ended = summaries.filter(({s})=>s.ended || (s.endingSoon && s.unsaved > 0));
  const importNotice = courseImportNotice(data);
  if (count || ended.length || importNotice) html += folder("attention","Vaatii huomiota",`${count ? `<p>${count} ${count===1 ? "tiedosto vaatii" : "tiedostoa vaatii"} tarkistamista.</p>${pageLink("home","Tarkista tiedostot")}` : ""}
    ${ended.map(({course,s})=>`<p>${esc(course.name)}: ${s.ended ? "kurssi on päättynyt" : `päättyy ${s.daysLeft} päivän päästä, ${s.unsaved} tiedostoa tallentamatta`}. ${pageLink(coursePage(course.id),"Avaa kurssi")}</p>`).join("")}
    ${importNotice ? `<p>${esc(importNotice)}</p>${pageLink("import","Tarkista kurssit")}` : ""}`);
  return html;
}
