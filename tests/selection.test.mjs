// Aja: node --test tests/selection.test.mjs (ei asennettavia riippuvuuksia).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { renderSelection, selectionText, webAddress } from '../views/selectionView.js';
import { parseTags } from '../shared/rules.js';

function state() {
  return {data:{settings:{storage:'downloads'},courses:[{id:'c1',name:'Backend',status:'active'},{id:'c2',name:'Data',status:'completed'}],bookmarks:[]},selection:{url:'https://example.org/article',title:'Artikkeli',markdown:'**Teksti** ja [linkki](https://example.org)',text:'Teksti ja linkki'},draft:{courseId:'c1',note:'',tags:'',addLink:false},busy:'',error:'',permission:'granted',saved:null};
}

test('selaimen tekstiesikatselu säilyttää koodimerkit; vanha Markdown ei muuta tallennettavaa valintaa',()=>{
  const selection={text:'2 * 3 ja <div> sekä **koodi**',markdown:'**eri sisältö**'};
  assert.equal(selectionText(selection),selection.text);
  const old={markdown:'## Otsikko\n\n**Lihavoitu** ja [linkki](https://example.org)'};
  assert.equal(selectionText(old),'Otsikko\n\nLihavoitu ja linkki');
  assert.ok(old.markdown.includes('**Lihavoitu**'));
});

test('päätoiminto on ennen lisävalintoja; pitkä esikatselu ei kasvata lomaketta rajatta',()=>{
  const s=state(); s.selection.text='Pitkä valinta '.repeat(500);
  const html=renderSelection(s);
  assert.ok(html.indexOf('id="sel-save"')<html.indexOf('name="note"'));
  assert.ok(html.indexOf('id="sel-save"')<html.indexOf('name="tags"'));
  assert.ok(!html.includes(s.selection.text));
  assert.ok(html.includes('Näytä koko valinta'));
  assert.ok(!html.includes('id="sel-addlink" checked'));
  assert.ok(html.includes('Backend → Omat tallennukset'));
});

test('HTML ja lähdeosoite tulostetaan turvallisesti',()=>{
  const s=state(); s.selection.text='<img src=x onerror=alert(1)>'; s.selection.title='<script>bad()</script>'; s.selection.url='javascript:alert(1)'; s.draft.note='</textarea><script>bad()</script>';
  const html=renderSelection(s);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('&lt;img'));
  assert.equal(webAddress(s.selection.url),'');
});

test('puuttuva lupa estää tallennuksen, virhe ja luonnos näkyvät yhdessä',()=>{
  const s=state(); s.data.settings.storage='folder'; s.permission='prompt'; s.error='Yritä uudelleen'; s.draft.note='Säilyvä huomautus'; s.draft.noteOpen=true;
  const html=renderSelection(s);
  assert.match(html,/id="sel-save"[^>]*disabled/);
  assert.ok(html.includes('data-action="grant"'));
  assert.ok(html.includes('Säilyvä huomautus'));
  assert.ok(html.includes('role="alert"'));
  s.permission='missing'; assert.ok(renderSelection(s).includes('Avaa tallennusasetukset'));
});

test('kuittaus näyttää linkityksen toteutuneen seurauksen ja normalisoidut tiedot',()=>{
  const s=state(); s.saved={course:'Backend',title:'Tallennettu otsikko',note:'Huomautus',tags:['projekti'],linked:false,alreadyLinked:true};
  const html=renderSelection(s);
  for (const text of ['Valittu teksti tallennettu','Sivu on jo tämän kurssin linkeissä.','Huomautus','#projekti','Näytä tallennus','Kurssin omat tallennukset']) assert.ok(html.includes(text));
  assert.ok(!html.includes('Kumoa')); assert.ok(!html.includes('id="selection-form"'));
  s.saved.alreadyLinked=false; assert.ok(renderSelection(s).includes('Sivua ei lisätty kurssin linkkeihin.'));
  s.saved.linked=true; assert.ok(renderSelection(s).includes('Sivu lisättiin myös kurssin linkkeihin.'));
});

test('puuttuva valinta ja kurssit tarjoavat seuraavan askeleen',()=>{
  const s=state(); s.selection=null; assert.ok(renderSelection(s).includes('Valittu teksti puuttuu'));
  s.selection=state().selection; s.data.courses=[]; assert.ok(renderSelection(s).includes('data-action="import"'));
});

const source=await readFile(new URL('../background.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function selectionDocument('),source.indexOf('// Poistaa tallennetun tekstin'));
function backend(bookmarks=[]) {
  let data={courses:[{id:'c1',name:'Backend'}],bookmarks:structuredClone(bookmarks),savedTexts:[],viewPrefs:{}};
  let fail=false, writes=[];
  const context=vm.createContext({Date,JSON,String,Array,Boolean,parseTags,pad2:n=>String(n).padStart(2,'0'),CLIP_DIR:'Omat tallennukset',newId:()=>`id${data.savedTexts.length}`,shorten:v=>v,loadAll:async()=>structuredClone(data),save:async changes=>{data={...data,...changes};},writeCourseText:async(_data,_course,path,body,overwrite)=>{if(fail) throw new Error('kirjoitusvirhe'); writes.push({path,body,overwrite}); return path;},scheduleCourseContents:()=>{}});
  vm.runInContext(functions,context);
  return {run:fields=>context.saveSelection(fields),get data(){return data;},writes,setFail:()=>{fail=true;}};
}
const fields={url:'https://example.org/article',title:' Artikkeli ',markdown:'## Valittu\n\n**Muotoilu säilyy tiedostossa**',courseId:'c1',note:'  Oma\n huomautus  ',tags:['#projekti','oma idea'],addLink:false};

test('oikea taustatoiminto tallentaa koko Markdownin, tagit ja huomautuksen ilman sivun linkitystä',async()=>{
  const b=backend(); const saved=await b.run(fields);
  assert.equal(b.data.bookmarks.length,0); assert.equal(b.data.savedTexts.length,1);
  assert.ok(b.writes[0].body.includes(fields.markdown));
  assert.ok(b.writes[0].body.includes('note: "Oma huomautus"'));
  assert.ok(b.writes[0].body.includes('created:')); assert.ok(b.writes[0].body.includes('time:'));
  assert.equal(b.writes[0].overwrite,false);
  assert.equal(saved.note,'Oma huomautus'); assert.equal(saved.tags.join(','),'projekti,oma-idea');
  assert.equal(saved.linked,false); assert.equal(saved.alreadyLinked,false);
});

test('valinnainen linkki lisätään kerran eikä olemassa olevan linkin huomautusta muuteta',async()=>{
  const b=backend(); assert.equal((await b.run({...fields,addLink:true})).linked,true);
  assert.equal((await b.run({...fields,addLink:true})).alreadyLinked,true); assert.equal(b.data.bookmarks.length,1);
  const c=backend([{id:'old',courseId:'c1',url:fields.url,note:'Käyttäjän oma linkkihuomautus'}]);
  const result=await c.run({...fields,addLink:true});
  assert.equal(result.linked,false); assert.equal(result.alreadyLinked,true);
  assert.equal(c.data.bookmarks[0].note,'Käyttäjän oma linkkihuomautus');
});

test('kirjoitusvirhe tai virheellinen syöte ei luo onnistunutta tallennusta tai linkkiä',async()=>{
  const b=backend(); b.setFail(); await assert.rejects(b.run({...fields,addLink:true}),/kirjoitusvirhe/);
  assert.equal(b.data.savedTexts.length,0); assert.equal(b.data.bookmarks.length,0);
  const c=backend(); await assert.rejects(c.run({...fields,url:'javascript:alert(1)'}));
  await assert.rejects(c.run({...fields,markdown:' '}));
  assert.equal(c.writes.length,0);
});
