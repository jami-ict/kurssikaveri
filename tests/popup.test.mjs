// Aja: node --test tests/popup.test.mjs (ei riippuvuuksia).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { DEFAULT_SETTINGS, loadAll, saveSettings } from "../shared/store.js";
import { backupObject, parseBackup, restoreChanges } from "../shared/backup.js";
import { popupContext, renderPopup } from "../views/popupView.js";

const now=new Date(2026,10,21,12).getTime();
function fixture() {
  const data={settings:{...DEFAULT_SETTINGS,onboarded:true},courses:[{id:"c1",moodleId:12,name:"UI-kurssi",status:"active",color:1}],downloads:{},courseContent:{},moodleMap:{},pageCourses:{},savedTexts:[],bookmarks:[],viewPrefs:{},deadlines:{items:[{id:1,moodleId:12,name:"Moodlen palautus",time:now+86400000,url:"https://moodle5.samk.fi/mod/assign/view.php?id=2"}],fetched:now-3600000},ownEntries:[{id:"own1",title:"Oma raportti",date:"2026-11-23",time:"14:00",courseId:"c1",type:"deadline"}],calendarPrefs:{}};
  const tab={id:1,url:"https://example.org/article",title:"Artikkeli"};
  return {data,tab,context:popupContext(data,tab),exists:{},permission:"granted",now,draft:{url:tab.url,title:tab.title,courseId:"c1",note:"",clip:false},busy:"",refreshing:false};
}

test("vanha asennus saa määräaika ensin -oletuksen; asetus säilyy tallennuksessa ja varmuuskopiossa",async()=>{
  let stored={settings:{onboarded:true,theme:"dark"}};
  globalThis.chrome={storage:{local:{get:async keys=>typeof keys==="string" ? {[keys]:stored[keys]} : structuredClone(stored),set:async changes=>{stored={...stored,...changes};}}}};
  Object.defineProperty(globalThis,"navigator",{value:{locks:{request:async(name,task)=>task()}},configurable:true});
  assert.equal((await loadAll()).settings.popupFirst,"deadline");
  await saveSettings({popupFirst:"save"});
  const data=await loadAll();
  assert.equal(data.settings.popupFirst,"save");
  assert.equal(data.settings.theme,"dark");
  const backup=parseBackup(JSON.stringify(backupObject(data,"test-owner")));
  assert.equal(restoreChanges(backup,DEFAULT_SETTINGS).settings.popupFirst,"save");
});

test("järjestys vaihtuu muuttamatta määräaika- ja tallennussisältöä",()=>{
  const state=fixture();
  const first=renderPopup(state);
  assert.ok(first.indexOf('id="pp-next"')<first.indexOf('id="pp-save"'));
  state.data.settings.popupFirst="save";
  const second=renderPopup(state);
  assert.ok(second.indexOf('id="pp-save"')<second.indexOf('id="pp-next"'));
  for(const text of ["Moodlen palautus","Oma raportti","Tallenna sivu"]) {
    assert.ok(first.includes(text)); assert.ok(second.includes(text));
  }
  assert.ok(!first.includes("Tallenna sivun linkki")); // otsikko kattaa myös koko sivun tekstin
  state.data.settings.popupFirst="unknown";
  assert.equal(renderPopup(state),first);
});

test("omat määräajat, koko päivän aika, palautetut ja avautumisajat",()=>{
  const state=fixture();
  state.data.ownEntries[0].time="";
  state.data.ownEntries[0].date="2026-11-21";
  state.data.deadlines.items.push({id:2,moodleId:12,name:"Palautettu",time:now+1000,submitted:true},{id:3,name:"Avautuva tentti",time:now+2000,eventtype:"open"});
  const html=renderPopup(state);
  assert.ok(html.includes("koko päivä"));
  assert.ok(html.includes("calendar=2026-11-21"));
  assert.ok(html.includes('class="pp-event-title"'));
  assert.ok(!html.includes("Palautettu"));
  assert.ok(!html.includes("Avautuva tentti"));
});

test("vanhat määräajat ja oma merkintä säilyvät näkyvissä hakuvirheessä",()=>{
  const state=fixture(); state.data.deadlines.error="login";
  const html=renderPopup(state);
  assert.ok(html.includes("Kirjaudu Moodleen"));
  assert.ok(html.includes("Viimeisin haku"));
  assert.ok(html.includes("Moodlen palautus"));
  assert.ok(html.includes("Oma raportti"));
});

test("Moodle-kurssi, PDF, samanniminen vieras palvelin ja selaimen oma sivu",()=>{
  const {data}=fixture();
  assert.equal(popupContext(data,{url:"https://moodle5.samk.fi/course/view.php?id=12"}).course.id,"c1");
  assert.equal(popupContext(data,{url:"https://moodle5.samk.fi/course/view.php?id=13"}).kind,"none");
  assert.equal(popupContext(data,{url:"https://moodle5.samk.fi/pluginfile.php/2/test.pdf"}).kind,"pdf");
  assert.equal(popupContext(data,{url:"https://moodle5.samk.fi/pluginfile.php/2/kuva.png"}).pdf,false);
  assert.equal(popupContext(data,{url:"https://moodle5.samk.fi.example.org/course/view.php?id=12"}).kind,"bookmark");
  assert.equal(popupContext(data,{url:"chrome://settings"}).kind,"none");
});

test("puuttuva kansiolupa ei piilota hakuvirhettä; PDF-tallennus estyy",()=>{
  const state=fixture();
  state.data.settings.storage="folder"; state.permission="prompt";
  state.data.deadlines.error="offline";
  state.context={kind:"pdf",name:"Ohje.pdf"};
  const html=renderPopup(state);
  assert.ok(html.includes("Anna tallennuslupa"));
  assert.ok(html.includes("Tarkistus jäi kesken"));
  assert.match(html,/data-action="save-tab" disabled/);
});

test("HTML-merkinnät ja vaarallinen tehtäväosoite eivät päädy suoritettaviksi",()=>{
  const state=fixture();
  state.draft.title='<img src=x onerror="alert(1)">';
  state.data.deadlines.items[0].url="javascript:alert(1)";
  const html=renderPopup(state);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('href="javascript:'));
});

test("tyhjä tila ja käyttöönotto antavat toimivan seuraavan askeleen",()=>{
  const state=fixture(); state.data.deadlines.items=[]; state.data.ownEntries=[];
  assert.ok(renderPopup(state).includes("Ei tiedossa olevia määräaikoja"));
  state.data.courses=[]; assert.ok(renderPopup(state).includes('data-go="import"'));
  state.data.settings.onboarded=false; assert.ok(renderPopup(state).includes('data-action="onboarding"'));
});

// Ajetaan taustaskriptin oikeat linkki- ja kumoamisfunktiot eristetyssä muistissa.
// Verkkokutsut ja tiedostot eivät kuulu tähän testiin.
async function bookmarkBackend() {
  const source=await readFile(new URL("../background.js",import.meta.url),"utf8");
  const code=source.slice(source.indexOf("async function addBookmark("),source.indexOf("// ---------- Valitun tekstin tallennus"));
  let data=fixture().data,session={},counter=0;
  const sandbox={structuredClone,Date,JSON,Error,loadAll:async()=>structuredClone(data),save:async change=>{data={...data,...structuredClone(change)};},newId:prefix=>prefix+(++counter),scheduleCourseContents:()=>{},saveClip:async(data,course,bookmark)=>{bookmark.clipPath="Omat tallennukset/sivu.md";return {path:bookmark.clipPath};},chrome:{storage:{session:{get:async()=>structuredClone(session),set:async change=>{session={...session,...structuredClone(change)};}}}}};
  vm.createContext(sandbox); vm.runInContext(code,sandbox);
  return {add:fields=>sandbox.addBookmark({url:"https://example.org/article",title:"Otsikko",courseId:"c1",note:"",...fields}),undo:token=>sandbox.undoBookmark({token}),data:()=>data,session:()=>session};
}

test("kumoaminen poistaa uuden linkin ja palauttaa muokatun huomautuksen",async()=>{
  const backend=await bookmarkBackend();
  const first=await backend.add({note:"Alkuperäinen"});
  const second=await backend.add({note:"Uusi"});
  await backend.undo(second.undoToken);
  assert.equal(backend.data().bookmarks[0].note,"Alkuperäinen");
  await backend.undo(first.undoToken);
  assert.equal(backend.data().bookmarks.length,0);
});

test("rinnakkainen linkin muutos ja vanhentunut tunniste estävät kumoamisen",async()=>{
  const backend=await bookmarkBackend();
  const saved=await backend.add({});
  backend.data().bookmarks[0].note="Toisessa näkymässä muokattu";
  await assert.rejects(backend.undo(saved.undoToken),/muuttui toisessa/);
  const latest=await backend.add({});
  backend.session().popupBookmarkUndo.find(item=>item.token===latest.undoToken).expires=0;
  await assert.rejects(backend.undo(latest.undoToken),/Kumoamisaika/);
});

test("linkin muokkauksen kumoaminen säilyttää tallennetun tekstin metatiedot",async()=>{
  const backend=await bookmarkBackend();
  await backend.add({note:"Ennen"});
  const saved=await backend.add({note:"Jälkeen",clip:{markdown:"Sivun teksti"}});
  await backend.undo(saved.undoToken);
  assert.equal(backend.data().bookmarks[0].note,"Ennen");
  assert.equal(backend.data().bookmarks[0].clipPath,"Omat tallennukset/sivu.md");
});
