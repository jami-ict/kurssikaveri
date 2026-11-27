// Popupin tapahtumat. HTML on views/popupView.js:ssä; data yhteisissä moduuleissa.
import { loadAll } from "./shared/store.js";
import { escapeHtml, existsMap, openPage, ask, grantFolderPermission, grantNote, refreshMoodle } from "./shared/ui.js";
import { cleanPageTitle } from "./shared/contents.js";
import { popupContext, renderPopup } from "./views/popupView.js";
import * as folder from "./shared/fsstore.js";
import { createSaveClose } from "./shared/saveClose.js";

const content = document.getElementById("content");
const saveClose = createSaveClose(window);
document.addEventListener("pointerdown", saveClose.cancel, true);
document.addEventListener("keydown", saveClose.cancel, true);
let data, tab, context;
let draft = null;
let bookmarkResult = null;
let tabResult = null;
let permissionResult = null;
let editing = false;
let busy = "";
let refreshing = false;
let refreshError = "";
let renderNumber = 0;
let renderTimer;

function prepareDraft() {
  if (context.kind !== "bookmark" || !data.courses.length) { draft = null; return; }
  if (draft?.url === tab.url) return;
  const saved = data.bookmarks.find(item => item.url === tab.url && data.courses.some(course => course.id === item.courseId));
  const recent = data.courses.find(course => course.id === data.viewPrefs.bookmarkCourse);
  draft = { url:tab.url, tabId:tab.id, title:saved?.title || cleanPageTitle(tab.title,tab.url), courseId:saved?.courseId || recent?.id || "", note:saved?.note || "", clip:false, noteOpen:false, extrasOpen:false };
  bookmarkResult = null;
  editing = false;
}

async function render() {
  const number = ++renderNumber;
  const fresh = await loadAll();
  const exists = await existsMap();
  const permission = fresh.settings.storage === "folder" ? await folder.permissionState().catch(()=>"prompt") : "granted";
  if (number !== renderNumber) return;
  data = fresh;
  context = popupContext(data,tab);
  prepareDraft();
  const active = document.activeElement;
  const focusId = content.contains(active) ? active.id : "";
  const focusAction = content.contains(active) ? active.dataset.action : "";
  const selection = active?.tagName === "TEXTAREA" || (active?.tagName === "INPUT" && active.type === "text") ? [active.selectionStart,active.selectionEnd] : null;
  const scroll = content.scrollTop;
  content.innerHTML = renderPopup({data,exists,tab,context,permission,now:Date.now(),draft,bookmarkResult,tabResult,permissionResult,editing,busy,refreshing,refreshError});
  content.scrollTop = scroll;
  content.querySelectorAll("#bookmark-form input,#bookmark-form select,#bookmark-form textarea,#bookmark-form button").forEach(input=>{input.disabled=Boolean(busy);});
  if (focusId || focusAction) {
    const replacement = focusId ? document.getElementById(focusId) : [...content.querySelectorAll("[data-action]")].find(item=>item.dataset.action === focusAction);
    replacement?.focus({preventScroll:true});
    if (selection && replacement?.setSelectionRange) replacement.setSelectionRange(...selection);
  }
}

// Taustapäivitys säilyttää luonnoksen, avoimet lisävalinnat ja kohdistuksen.
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(()=>render().catch(showLoadError),0);
}

function showLoadError(error) {
  saveClose.cancel();
  content.innerHTML = `<p class="pp-notice error" role="alert">${escapeHtml(error.message || "Tietoja ei voitu lukea.")}</p><button class="btn" type="button" data-action="retry">Yritä uudelleen</button>`;
}

async function go(page) {
  await openPage(page);
  window.close();
}

async function grabPage() {
  try {
    await chrome.scripting.executeScript({target:{tabId:draft.tabId},func:()=>{window.__kurssikaveriWholePage=true;}});
    const [frame] = await chrome.scripting.executeScript({target:{tabId:draft.tabId},files:["clip.js"]});
    if (!frame?.result) throw new Error("Sivun tekstiä ei saatu luettua. Lataa sivu uudelleen ja yritä uudestaan.");
    if (frame.result.error) throw new Error(frame.result.error);
    return frame.result;
  } catch (error) {
    throw new Error(`Sivun tekstin lukeminen epäonnistui. ${error.message}`);
  }
}

async function saveBookmark() {
  if (busy || !draft) return;
  saveClose.cancel();
  if (!draft.title.trim()) { draft.extrasOpen=true; bookmarkResult={ok:false,text:"Kirjoita linkille otsikko."}; await render(); document.getElementById("bm-title")?.focus(); return; }
  busy="bookmark";
  const fields={url:draft.url,title:draft.title,courseId:draft.courseId,note:draft.note};
  const wantedClip=draft.clip;
  await render();
  try {
    let clip=null;
    if (wantedClip) { const page=await grabPage(); clip={title:page.title,selection:false,markdown:page.markdown}; }
    const saved=await ask("addBookmark",{...fields,clip});
    bookmarkResult={ok:true,text:saved.updated ? "Linkin tiedot päivitetty" : "Tallennettu kurssin linkkeihin",course:saved.course,courseId:fields.courseId,title:fields.title,note:fields.note,undoToken:saved.undoToken,clipSaved:Boolean(saved.clip && !saved.clip.error),warning:saved.clip?.error || ""};
    if (bookmarkResult.clipSaved) bookmarkResult.text="Linkki ja koko sivun teksti tallennettu";
    draft.clip=false; // Huomautuksen muokkaus ei tallenna koko sivua uudelleen.
    editing=false;
  } catch(error) { bookmarkResult={ok:false,text:error.message}; }
  finally { busy=""; await render(); }
  if (bookmarkResult?.ok && !bookmarkResult.warning) saveClose.start();
}

async function saveFiles() {
  if (busy) return;
  saveClose.cancel();
  const target=context;
  busy="files"; tabResult=null; await render();
  try {
    if (target.kind === "course") {
      const saved=await ask("saveCourseFiles",{moodleId:target.course.moodleId});
      const failed=saved.failed || [];
      const fresh=await loadAll();
      const waiting=Object.values(fresh.downloads).filter(item=>Number(item.moodleId) === Number(target.course.moodleId) && item.state === "pending").length;
      const summary=failed.length || waiting ? "Kaikkia tiedostoja ei saatu tallennettua." : `Tallennettiin ${saved.done} ${saved.done === 1 ? "tiedosto" : "tiedostoa"}.`;
      tabResult={kind:failed.length ? "error" : waiting ? "info" : "ok",text:`${summary}${waiting ? ` ${waiting} tallennusta odottaa lupaa opintokansioon.` : ""}${failed.length ? ` ${failed.length} tallennusta epäonnistui: ${failed.map(item=>item.name).join(", ")}. Yritä uudelleen.` : ""}`};
    } else {
      const saved=await ask("saveFromTab",{tabId:tab.id});
      tabResult={kind:saved.pending ? "info" : "ok",text:saved.already ? "Tiedosto on jo tallessa." : saved.pending ? "Tallennus odottaa lupaa opintokansioon." : `Tallennettu: ${saved.path}`};
    }
  } catch(error) { tabResult={kind:"error",text:error.message}; }
  finally { busy=""; await render(); }
  if (tabResult?.kind === "ok") saveClose.start();
}

async function refresh(force=false) {
  if (refreshing) return;
  refreshing=true; refreshError=""; await render();
  try {
    const result=await refreshMoodle(force ? {force:true} : {});
    if (!result?.ok) refreshError=result?.error || "Moodlen yhteyttä ei voitu tarkistaa.";
  } catch(error) { refreshError=error.message; }
  finally { refreshing=false; await render(); }
}

content.addEventListener("input",event=>{
  saveClose.cancel();
  if (!draft || !event.target.name) return;
  const input=event.target;
  draft[input.name]=input.type === "checkbox" ? input.checked : input.value;
  if(input.name === "title") document.getElementById("bm-preview").textContent=input.value;
});
content.addEventListener("change",event=>{
  saveClose.cancel();
  if(["bm-course","bm-clip"].includes(event.target.id)) {
    draft[event.target.name]=event.target.type === "checkbox" ? event.target.checked : event.target.value;
    bookmarkResult=null;
    render().catch(showLoadError);
  }
});
content.addEventListener("toggle",event=>{
  const key=event.target.dataset?.draftDetail;
  if(draft && key) draft[key]=event.target.open;
},true);
content.addEventListener("invalid",event=>{const details=event.target.closest("details"); if(details) details.open=true;},true);
content.addEventListener("submit",event=>{if(event.target.id === "bookmark-form") {event.preventDefault(); saveBookmark().catch(showLoadError);}});
content.addEventListener("click",async event=>{
  const target=event.target.closest("[data-action],[data-go],[data-external]");
  if(!target) return;
  event.preventDefault();
  if(target.disabled) return;
  saveClose.cancel();
  try {
    if(target.dataset.go) {await go(target.dataset.go); return;}
    if(target.hasAttribute("data-external")) {await chrome.tabs.create({url:target.href}); window.close(); return;}
    switch(target.dataset.action) {
      case "retry": await render(); break;
      case "onboarding": await chrome.tabs.create({url:chrome.runtime.getURL("onboarding.html")}); window.close(); break;
      case "refresh": await refresh(true); break;
      case "grant":
        target.disabled=true;
        try {permissionResult=grantNote(await grantFolderPermission());}
        catch(error) {permissionResult={kind:"error",text:error.message};}
        await render(); break;
      case "save-course": case "save-tab": await saveFiles(); break;
      case "edit": editing=true; draft.noteOpen=true; await render(); document.getElementById("bm-note")?.focus(); break;
      case "undo": {
        if(busy) break;
        busy="undo";
        const result=bookmarkResult;
        target.disabled=true;
        try {
          const undone=await ask("undoBookmark",{token:result.undoToken});
          draft.title=undone.bookmark?.title || cleanPageTitle(tab.title,tab.url);
          draft.note=undone.bookmark?.note || "";
          bookmarkResult=null; editing=false;
          permissionResult={kind:"ok",text:"Linkin muutos kumottu."};
        }
        catch(error) {bookmarkResult={...result,warning:error.message};}
        finally {busy=""; await render();}
        break;
      }
      case "print": {
        if(busy) break;
        busy="print"; target.disabled=true;
        try {
          const page=await grabPage();
          await chrome.storage.session.set({printClip:{title:draft.title || page.title,url:page.url,html:page.html,selection:false,time:Date.now()}});
          await chrome.tabs.create({url:chrome.runtime.getURL("print.html")}); window.close();
        } catch(error) {bookmarkResult={ok:false,text:error.message};}
        finally {busy=""; await render();}
        break;
      }
    }
  } catch(error) {permissionResult={kind:"error",text:error.message}; render().catch(showLoadError);}
});
document.querySelectorAll("[data-page]").forEach(button=>button.addEventListener("click",()=>go(button.dataset.page).catch(showLoadError)));
chrome.storage.onChanged.addListener((changes,area)=>{if(area === "local" && ["settings","ownEntries","deadlines","courses","downloads","bookmarks","courseContent"].some(key=>changes[key])) scheduleRender();});

(async()=>{
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  await render();
  if(data?.settings.onboarded) await refresh();
})().catch(showLoadError);
