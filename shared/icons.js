// icons.js – Kurssikaverin ikonit yhdessä paikassa.
//
// Jokainen ikoni on 24×24-ruudukkoon piirretty viivapiirros (SVG). Väri tulee tekstin väristä
// (currentColor), joten ikonit toimivat sellaisenaan vaaleassa ja tummassa teemassa.
// Koko = tekstin koko (1em); viivan paksuus ja muut tyylit: style.css → .icon
//
// IKONISARJAN VAIHTAMINEN (esim. Lucide tai Material Symbols):
//   1. Hae tarvittavat ikonit SVG-muodossa sarjan sivulta.
//   2. Korvaa alla olevista sama nimi: kopioi <svg>-elementin SISÄLTÖ (path-, circle- ym. elementit).
//      Jos sarjan ikonit ovat täytettyjä eivätkä viivapiirroksia, vaihda .icon-tyylissä fill/stroke.
//   3. Pidä nimet samoina, niin muuta koodia ei tarvitse muuttaa.
//
// Käyttö: icon("file") → "<svg …>…</svg>" (HTML-merkkijono)
//         icon("clock", { label: "Määräaika" }) → ruudunlukija lukee nimen

export const ICONS = {
  // Sisällön lajit (shared/contents.js KINDS)
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  folder: '<path d="M3 6.5h6l2 2h10V19H3z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>',
  tool: '<path d="M3 7.5l9-4 9 4v9l-9 4-9-4z"/><path d="M3 7.5l9 4 9-4"/><path d="M12 11.5v9"/>',
  page: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  assignment: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 3h6v4H9z"/><path d="M9 13.5l2 2 4-4"/>',
  activity: '<path d="M4 5h16v11H10l-6 4z"/>',

  // Tilat
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  new: '<path d="M12 3l2 5.5L19.5 10.5 14 12.5 12 18l-2-5.5L4.5 10.5 10 8.5z"/>',
  warning: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',

  // Toiminnot
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  courses: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>'
};

export function icon(name, { label = "", className = "" } = {}) {
  const body = ICONS[name] || ICONS.file;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, "&quot;")}"` : 'aria-hidden="true"';
  return `<svg class="icon${className ? " " + className : ""}" viewBox="0 0 24 24" ${a11y}>${body}</svg>`;
}
