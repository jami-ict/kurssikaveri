// Aja: node --test tests/saveClose.test.mjs (ei asennettavia riippuvuuksia).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createSaveClose, SAVE_CLOSE_DELAY } from "../shared/saveClose.js";
import { parseTags } from "../shared/rules.js";

function clock() {
  let now=0, next=0, closed=0;
  const timers=new Map();
  return { setTimeout(fn,delay) { const id=++next; timers.set(id,{fn,time:now+delay}); return id; },
    clearTimeout(id) { timers.delete(id); }, close() { closed++; },
    tick(ms) { now+=ms; for(const [id,timer] of [...timers]) if(timer.time<=now) { timers.delete(id); timer.fn(); } },
    get closed() { return closed; }, get pending() { return timers.size; } };
}

test("kuittaus näkyy 1,5 sekuntia ja sulkemisen voi perua",()=>{
  const time=clock(), close=createSaveClose(time);
  close.start(); time.tick(SAVE_CLOSE_DELAY-1); assert.equal(time.closed,0);
  time.tick(1); assert.equal(time.closed,1);
  close.start(); close.cancel(); time.tick(SAVE_CLOSE_DELAY); assert.equal(time.closed,1);
  close.start(); close.start(); assert.equal(time.pending,1);
});

const sources={popup:await readFile(new URL('../popup.js',import.meta.url),'utf8'),selection:await readFile(new URL('../selection.js',import.meta.url),'utf8')};
function controller(kind,options={}) {
  const time=clock(), events={}, docEvents={};
  const data={settings:{storage:'folder',onboarded:true},courses:[{id:'c1',moodleId:12,name:'Backend'}],bookmarks:[],savedTexts:[],viewPrefs:{},downloads:options.downloads || {}};
  const content={innerHTML:'',scrollTop:0,contains:()=>false,querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>{events[name]=fn;}};
  const dialog={open:false,showModal(){this.open=true;}};
  const elements={'content':content,'sel-preview':dialog,'sel-preview-title':{},'sel-preview-meta':{},'sel-preview-body':{focus:()=>{}}};
  const context=options.context || {kind:'bookmark'};
  const sandbox=vm.createContext({createSaveClose,window:time,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,Date,parseTags,MAX_TAGS:10,usedTags:()=>[],
    document:{activeElement:null,getElementById:id=>elements[id] || null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{docEvents[name]=fn;}},
    loadAll:async()=>data,existsMap:async()=>({}),popupContext:()=>context,renderPopup:()=>'<p>Tallennettu</p>',renderSelection:()=>'<p>Tallennettu</p>',
    escapeHtml:v=>v,cleanPageTitle:v=>v,selectionText:v=>v.text,webAddress:v=>v,openPage:async()=>{},
    folder:{permissionState:async()=>'granted'},ask:async action=>{
      if(options.fail) throw new Error('Tallennusvirhe');
      if(options.wait) await options.wait;
      return options.result || {course:'Backend',title:'Artikkeli',undoToken:'u1',path:'Omat tallennukset/Artikkeli.md'};
    },
    chrome:{scripting:{executeScript:async request=>request.files ? [{result:{title:'Sivu',markdown:'Koko sivu'}}] : []},
      storage:{onChanged:{addListener:()=>{}},session:{get:async()=>({}),remove:async()=>{}}}}
  });
  const source=sources[kind];
  vm.runInContext(source.slice(0,source.lastIndexOf('(async()=>{')).replace(/^import .*;\r?\n/gm,''),sandbox);
  if(kind==='popup') vm.runInContext(`data=fixture; tab={id:1,url:'https://example.org',title:'Artikkeli'}; context=fixtureContext; draft={url:tab.url,tabId:1,title:tab.title,courseId:'c1',note:'',clip:${Boolean(options.clip)}};`,Object.assign(sandbox,{fixture:data,fixtureContext:context}));
  else vm.runInContext("data=fixture; selection={url:'https://example.org',title:'Artikkeli',markdown:'Teksti',text:'Teksti',time:1}; draft.courseId='c1';",Object.assign(sandbox,{fixture:data}));
  return {time,dialog,api:sandbox,events,docEvents,
    run:()=>kind==='popup' ? sandbox.saveBookmark() : sandbox.save(),
    click:action=>events.click({preventDefault:()=>{},target:{closest:()=>({dataset:{action},hasAttribute:()=>false})}}) };
}

test("linkin, koko sivun ja tekstivalinnan tallennus sulkee vasta kuittauksen jälkeen",async()=>{
  for(const [kind,options] of [['popup',{}],['popup',{clip:true,result:{course:'Backend',clip:{path:'Sivu.md'}}}],['selection',{}]]) {
    const c=controller(kind,options); await c.run();
    assert.equal(c.time.closed,0); c.time.tick(1499); assert.equal(c.time.closed,0);
    c.time.tick(1); assert.equal(c.time.closed,1);
  }
});

test("sulkemista ei aloiteta kesken tallennuksen",async()=>{
  for(const kind of ['popup','selection']) {
    let finish; const wait=new Promise(resolve=>{finish=resolve;});
    const c=controller(kind,{wait}); const saving=c.run();
    await Promise.resolve(); c.time.tick(10000); assert.equal(c.time.closed,0);
    finish(); await saving; c.time.tick(1500); assert.equal(c.time.closed,1);
  }
});

test("virhe tai osittainen sivutallennus jää näkyviin",async()=>{
  for(const [kind,options] of [['popup',{fail:true}],['selection',{fail:true}],['popup',{result:{course:'Backend',clip:{error:'Teksti jäi tallentamatta'}}}]]) {
    const c=controller(kind,options); await c.run(); c.time.tick(10000); assert.equal(c.time.closed,0);
  }
});

test("PDF ja kurssitallennus sulkeutuvat, mutta lupaodotus ja osittainen virhe eivät",async()=>{
  const cases=[
    [{kind:'pdf'},{path:'Ohje.pdf'}, {}, true],
    [{kind:'pdf'},{pending:true}, {}, false],
    [{kind:'course',course:{moodleId:12}},{done:2,failed:[]}, {}, true],
    [{kind:'course',course:{moodleId:12}},{done:1,failed:[{name:'Ohje.pdf'}]}, {}, false],
    [{kind:'course',course:{moodleId:12}},{done:1,failed:[]}, {one:{moodleId:12,state:'pending'}}, false]
  ];
  for(const [context,result,downloads,shouldClose] of cases) {
    const c=controller('popup',{context,result,downloads}); await c.api.saveFiles(); c.time.tick(1500);
    assert.equal(c.time.closed,shouldClose ? 1 : 0);
  }
});

test("taustapäivitys ei aloita kuittausaikaa uudelleen",async()=>{
  const c=controller('popup'); await c.run(); c.time.tick(1000);
  await c.api.render(); c.time.tick(500); assert.equal(c.time.closed,1);
});

test("näppäin tai hiiren painallus keskeyttää automaattisen sulkemisen",async()=>{
  for(const kind of ['popup','selection']) for(const action of ['pointerdown','keydown']) {
    const c=controller(kind); await c.run(); c.docEvents[action](); c.time.tick(10000); assert.equal(c.time.closed,0);
  }
});

test("huomautuksen muokkaus ja tallennuksen esikatselu pitävät ikkunan auki",async()=>{
  const p=controller('popup'); await p.run(); await p.click('edit'); p.time.tick(10000); assert.equal(p.time.closed,0);
  const s=controller('selection'); await s.run(); await s.click('saved-preview'); s.time.tick(10000);
  assert.equal(s.time.closed,0); assert.equal(s.dialog.open,true);
});
