// Tallennusikkunan sisältö. Ulkoasu tulee yhteisestä popup.css:stä.
import { escapeHtml as esc } from '../shared/ui.js';

export const webAddress = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';

// Uudet valinnat sisältävät selaimen antaman tekstin. Vanhassa istuntotiedossa
// poistetaan tavallisimmat Markdown-merkinnät vain esikatselusta, ei tallennuksesta.
export function selectionText(selection) {
  if (String(selection?.text || '').trim()) return String(selection.text);
  return String(selection?.markdown || '')
    .replace(/!\[([^\]]*)\]\([^\n]*?\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/~~([^\n]+?)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

function folder(title, body, saved = false) {
  return `<section class="pp-folder ${saved ? 'pp-saved' : 'pp-save'}" aria-labelledby="sel-heading"><h1 class="pp-tab" id="sel-heading">${title}</h1><div class="pp-face">${body}</div></section>`;
}

export function renderSelection(state) {
  const {data,selection,draft,busy,error,permission,saved} = state;
  if (!selection?.markdown?.trim()) return folder('Valittu teksti puuttuu', '<p>Valittua tekstiä ei löytynyt. Maalaa teksti sivulta ja valitse hiiren oikealla painikkeella uudelleen.</p><button class="btn" data-action="close">Sulje</button>');
  if (!data.courses.length) return folder('Lisää kurssisi', '<p>Lisää ensin kurssi Kurssikaveriin, niin voit tallentaa tekstiä sen materiaaleihin.</p><button class="btn primary" data-action="import">Tuo kurssit Moodlesta</button><button class="link sel-close" data-action="close">Sulje</button>');
  if (saved) return folder('Tallennettu', `<p class="pp-success" role="status">Valittu teksti tallennettu</p><p class="pp-course">${esc(saved.course)} → Omat tallennukset</p><h2 class="sel-saved-title">${esc(saved.title || selection.title || 'Tallennettu teksti')}</h2><p class="sel-hint">Tekstitiedosto · lähde ja tallennusaika mukana</p>
    <div class="sel-saved-info">${saved.note ? `<p><strong>Huomautus</strong><br>${esc(saved.note)}</p>` : ''}${saved.tags?.length ? `<p><strong>Tagit</strong><br>${saved.tags.map(tag=>`#${esc(tag)}`).join(' ')}</p>` : ''}<p>${saved.linked ? 'Sivu lisättiin myös kurssin linkkeihin.' : saved.alreadyLinked ? 'Sivu on jo tämän kurssin linkeissä.' : 'Sivua ei lisätty kurssin linkkeihin.'}</p></div>
    <div class="sel-saved-actions"><button class="btn primary" data-action="saved-preview">Näytä tallennus</button><button class="link" data-action="course">Kurssin omat tallennukset</button></div><button class="btn sel-close" data-action="close">Sulje</button>`, true);
  const courses = [...data.courses].sort((a,b)=>(a.status === 'completed')-(b.status === 'completed') || a.name.localeCompare(b.name,'fi'));
  const course = courses.find(c=>c.id === draft.courseId);
  const text = selectionText(selection);
  const preview = text.length > 300 ? text.slice(0,300).trimEnd()+'…' : text;
  let host='';
  try { host=new URL(selection.url).hostname.replace(/^www\./,''); } catch { /* Osoite tarkistetaan ennen avaamista ja tallennusta. */ }
  const linked = data.bookmarks.some(b=>b.courseId === draft.courseId && b.url === selection.url);
  const needsPermission = data.settings.storage === 'folder' && permission !== 'granted';
  return folder('Tallenna valittu teksti', `<p class="sel-origin">Valinta sivulta ${esc(host || 'avoin sivu')}</p><blockquote class="sel-quote">${esc(preview)}</blockquote><button class="link sel-preview-link" data-action="preview">Näytä koko valinta</button>
    <details class="sel-source" data-detail="sourceOpen" ${draft.sourceOpen ? 'open' : ''}><summary>Lähde ja osoite</summary><p>${esc(selection.title || host)}</p>${webAddress(selection.url) ? `<a href="${esc(selection.url)}" data-action="source">${esc(selection.url)}</a>` : `<p>${esc(selection.url)}</p>`}</details>
    ${needsPermission ? `<aside class="pp-notice error"><strong>Tallennus odottaa lupaasi</strong><p>${permission === 'missing' ? 'Valitse opintokansio Kurssikaverin asetuksissa.' : `Anna lupa opintokansioon${data.settings.folderName ? ` ”${esc(data.settings.folderName)}”` : ''} ennen tallennusta.`}</p><button class="btn" data-action="${permission === 'missing' ? 'settings' : 'grant'}" ${busy ? 'disabled' : ''}>${permission === 'missing' ? 'Avaa tallennusasetukset' : 'Anna tallennuslupa'}</button></aside>` : ''}
    <form id="selection-form"><div class="pp-save-row"><label for="sel-course">Kurssi<select id="sel-course" name="courseId" required ${busy ? 'disabled' : ''}>${courses.map(c=>`<option value="${esc(c.id)}" ${c.id === draft.courseId ? 'selected' : ''}>${esc(c.name)}${c.status === 'completed' ? ' (päättynyt)' : ''}</option>`).join('')}</select></label><button class="btn primary" id="sel-save" type="submit" ${busy || needsPermission ? 'disabled' : ''}>${busy === 'save' ? 'Tallennetaan…' : 'Tallenna teksti'}</button></div>
    <p class="sel-destination">${esc(course?.name || '')} → Omat tallennukset</p><div class="pp-options">
    <details data-detail="noteOpen" ${draft.noteOpen ? 'open' : ''}><summary>${draft.note ? 'Muokkaa huomautusta' : 'Lisää huomautus'}</summary><label for="sel-note">Huomautus (valinnainen)<textarea id="sel-note" name="note" rows="2" maxlength="300" ${busy ? 'disabled' : ''}>${esc(draft.note)}</textarea></label></details>
    <details data-detail="extrasOpen" ${draft.extrasOpen ? 'open' : ''}><summary>Lisävalinnat</summary><div class="sel-meta"><label for="sel-tags">Tagit (valinnainen)<input type="text" id="sel-tags" name="tags" maxlength="400" placeholder="esim. projekti, lähde" autocomplete="off" value="${esc(draft.tags)}" aria-describedby="sel-tags-help" ${busy ? 'disabled' : ''}><small id="sel-tags-help">Erota tagit pilkulla.</small></label><div id="sel-tag-hints" class="sel-tags"></div>
    ${linked ? '<p class="muted small">Sivu on jo tämän kurssin linkeissä.</p>' : `<label class="pp-check"><input type="checkbox" name="addLink" id="sel-addlink" ${draft.addLink ? 'checked' : ''} ${busy ? 'disabled' : ''}><span>Lisää sivu myös kurssin linkkeihin<small>Tekstivalinta säilyy Omissa tallennuksissa.</small></span></label>`}</div></details></div>
    <p class="sel-hint">Tekstitiedostoon tulevat valinta, lähde ja tallennusaika.</p>${error ? `<p class="pp-notice error" role="alert" tabindex="-1" id="sel-error">${esc(error)}</p>` : ''}<div class="sel-bottom"><button class="link" type="button" data-action="close" ${busy ? 'disabled' : ''}>Peruuta</button></div></form>`);
}
