// Hiiren oikean painikkeen tekstivalinta: sama kansioilme kuin popupissa.
import { loadAll } from './shared/store.js';
import { escapeHtml, ask, openPage } from './shared/ui.js';
import { parseTags, usedTags, MAX_TAGS } from './shared/rules.js';
import * as folder from './shared/fsstore.js';
import { renderSelection, selectionText, webAddress } from './views/selectionView.js';
import { createSaveClose } from './shared/saveClose.js';

const content = document.getElementById('content');
const dialog = document.getElementById('sel-preview');
const saveClose = createSaveClose(window);
document.addEventListener('pointerdown',saveClose.cancel,true);
document.addEventListener('keydown',saveClose.cancel,true);
let data, selection;
let draft = {courseId:'',note:'',tags:'',addLink:false,noteOpen:false,extrasOpen:false,sourceOpen:false};
let permission='granted';
let busy='';
let error='';
let saved=null;

function render() {
  const active=document.activeElement;
  const focusId=content.contains(active) ? active.id : '';
  const scroll=content.scrollTop;
  content.innerHTML=renderSelection({data,selection,draft,permission,busy,error,saved});
  content.scrollTop=scroll;
  updateTagHints();
  if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
}

function updateTagHints() {
  const hints=document.getElementById('sel-tag-hints');
  if (!hints) return;
  const parts=draft.tags.split(',');
  const typing=parts.at(-1).trim().replace(/^#/,'').toLowerCase();
  const chosen=new Set(parseTags(parts.slice(0,-1).join(',')).map(t=>t.toLowerCase()));
  const options=parseTags(draft.tags).length >= MAX_TAGS ? [] : usedTags(data.savedTexts).filter(tag=>!chosen.has(tag.toLowerCase()) && tag.toLowerCase() !== typing && tag.toLowerCase().startsWith(typing)).slice(0,12);
  hints.innerHTML=options.length ? `<span>${typing ? 'Ehdotukset:' : 'Aiemmin käytetyt:'}</span>${options.map(tag=>`<button type="button" data-action="tag" data-tag="${escapeHtml(tag)}" ${busy ? 'disabled' : ''}>#${escapeHtml(tag)}</button>`).join('')}` : '';
}

function preview(isSaved=false) {
  saveClose.cancel();
  document.getElementById('sel-preview-title').textContent=isSaved ? 'Tallennuksen esikatselu' : 'Valitun tekstin esikatselu';
  document.getElementById('sel-preview-meta').textContent=isSaved ? `${saved.course} → Omat tallennukset · ${saved.path}` : selection.title || selection.url;
  // Tekstisisältöä, ei lähdesivun HTML:ää tai suoritettavia linkkejä.
  document.getElementById('sel-preview-body').textContent=selectionText(selection);
  dialog.showModal();
  document.getElementById('sel-preview-body').focus();
}

async function clearPendingSelection() {
  // Toiseen ikkunaan sillä välin valittu uusi teksti säilytetään.
  try {
    const {pendingSelection}=await chrome.storage.session.get('pendingSelection');
    if (pendingSelection?.time === selection.time && pendingSelection?.url === selection.url && pendingSelection?.markdown === selection.markdown) await chrome.storage.session.remove('pendingSelection');
  } catch { /* Tallennus onnistui: siivousvirhe ei saa tarjota samaa tallennusta uudelleen. */ }
}

async function save() {
  if (busy || saved) return;
  saveClose.cancel();
  busy='save'; error=''; render();
  try {
    const result=await ask('saveSelection',{url:selection.url,title:selection.title,markdown:selection.markdown,courseId:draft.courseId,note:draft.note,tags:parseTags(draft.tags),addLink:draft.addLink});
    saved={...result,courseId:draft.courseId};
    await clearPendingSelection();
    content.scrollTop=0;
  } catch (cause) {
    error=cause.message || 'Tekstin tallennus epäonnistui. Yritä uudelleen.';
    if (data.settings.storage === 'folder') permission=await folder.permissionState().catch(()=>'denied');
  } finally { busy=''; render(); }
  if (saved) saveClose.start();
  else document.getElementById('sel-error')?.focus();
}

content.addEventListener('input',event=>{
  saveClose.cancel();
  if (busy || !event.target.name) return;
  const input=event.target;
  draft[input.name]=input.type === 'checkbox' ? input.checked : input.value;
  if (input.name === 'tags') updateTagHints();
});
content.addEventListener('change',event=>{
  saveClose.cancel();
  if (busy || event.target.name !== 'courseId') return;
  draft.courseId=event.target.value;
  render();
});
content.addEventListener('toggle',event=>{ if (event.target.dataset?.detail) draft[event.target.dataset.detail]=event.target.open; },true);
content.addEventListener('submit',event=>{ if (event.target.id === 'selection-form') {event.preventDefault(); save().catch(showError);} });
content.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  if (!button) return;
  event.preventDefault();
  if (button.disabled) return;
  saveClose.cancel();
  try {
    switch (button.dataset.action) {
      case 'close': window.close(); break;
      case 'preview': preview(); break;
      case 'saved-preview': preview(true); break;
      case 'source': if (webAddress(selection.url)) await chrome.tabs.create({url:selection.url}); break;
      case 'course': await openPage(`course-saved=${encodeURIComponent(saved.courseId)}`); break;
      case 'import': await openPage('import'); break;
      case 'settings': await openPage('settings'); break;
      case 'grant':
        if (busy) break;
        busy='permission'; render();
        try { permission=await folder.requestPermission(); error=permission === 'granted' ? '' : 'Lupaa ei annettu. Voit yrittää uudelleen; lomakkeen tiedot säilyvät.'; }
        catch (cause) { error=cause.message; }
        finally { busy=''; render(); }
        break;
      case 'tag': {
        if (busy) break;
        const kept=draft.tags.split(',').slice(0,-1).map(t=>t.trim()).filter(Boolean);
        draft.tags=[...kept,button.dataset.tag].join(', ')+', ';
        const input=document.getElementById('sel-tags'); input.value=draft.tags; input.focus(); updateTagHints(); break;
      }
    }
  } catch (cause) { error=cause.message; render(); }
});

function showError(cause) {
  saveClose.cancel();
  content.innerHTML=`<p class="pp-notice error" role="alert">${escapeHtml(cause.message || 'Tietoja ei voitu lukea.')}</p><button class="btn" data-action="close">Sulje</button>`;
}

(async()=>{
  [{pendingSelection:selection},data]=await Promise.all([chrome.storage.session.get('pendingSelection'),loadAll()]);
  draft.courseId=(data.courses.find(c=>c.id === data.viewPrefs.bookmarkCourse) || data.courses.find(c=>c.status !== 'completed') || data.courses[0])?.id || '';
  if (data.settings.storage === 'folder') permission=await folder.permissionState().catch(()=>'denied');
  render();
})().catch(showError);
