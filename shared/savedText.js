// savedText.js – tallennettujen tekstien (Omat tallennukset, omien linkkien sivutekstit) näyttäminen
// kurssisivulla ilman Obsidiania. Pelkkiä funktioita: ei selaimen rajapintoja, joten testattavissa Nodella.
//
// Teksti näytetään Markdownina sellaisenaan (rivinvaihdot säilyttäen). Muunnosta ei tehdä, jotta mitään ei katoa:
// koodi, linkkien osoitteet ja taulukot jäävät ennalleen. Pois jätetään vain Kurssikaverin itse kirjoittamat
// alkutiedot (frontmatter) ja otsakelohko (otsikko + Lähde-rivi + erotin), joiden tiedot näytetään ikkunan otsikossa.

// Kurssikaverin kirjoittama frontmatter: avain: arvo -rivejä, arvot joko sellaisenaan tai JSON-merkkijonoina,
// tagit luettelona ("tags:" ja sen alla "  - "tagi""). Palauttaa { meta, body }. Ilman frontmatteria meta on tyhjä.
export function splitFrontmatter(text) {
  const source = String(text || "").replace(new RegExp("^" + String.fromCharCode(0xFEFF)), "").replace(/\r\n?/g, "\n");
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { meta: {}, body: source };
  const meta = {};
  let list = null;
  for (const line of match[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && list) { list.push(readValue(item[1])); continue; }
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!pair) { list = null; continue; }
    if (pair[2] === "") { list = meta[pair[1]] = []; continue; }
    list = null;
    meta[pair[1]] = readValue(pair[2]);
  }
  return { meta, body: source.slice(match[0].length) };
}

function readValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch (e) { /* ei JSON: sellaisenaan */ } }
  return value;
}

// Kurssikaverin otsakelohko rungon alussa: "# Otsikko", "Lähde: …" ja erotinviiva "---".
// Poistetaan vain, jos Lähde-rivi löytyy, jotta käyttäjän oma alku ei katoa.
export function stripHeader(body) {
  const lines = String(body || "").split("\n");
  let i = 0;
  const skipBlank = () => { while (i < lines.length && lines[i].trim() === "") i++; };
  skipBlank();
  if (/^#\s/.test(lines[i] || "")) i++;
  skipBlank();
  if (!/^Lähde:/.test(lines[i] || "")) return String(body || "").trim();
  i++;
  skipBlank();
  if ((lines[i] || "").trim() === "---") i++;
  return lines.slice(i).join("\n").trim();
}

// Tallennetun tekstin tiedot ikkunaa varten: otsikko, tietorivi, huomautus, tagit ja runko
export function readableText(text, fallback = {}) {
  const { meta, body } = splitFrontmatter(text);
  const tags = Array.isArray(meta.tags) ? meta.tags : (fallback.tags || []);
  return {
    title: String(meta.title || fallback.title || "Tallennettu teksti"),
    source: String(meta.source || fallback.url || ""),
    note: String(meta.note || fallback.note || ""),
    tags: tags.map(String).filter(Boolean),
    selection: String(meta.selection) === "true",
    body: stripHeader(body)
  };
}

// Lukuvirheen selitys käyttäjälle. FolderError (shared/fsstore.js) kertoo koodillaan, puuttuuko kansio vai lupa;
// selaimen NotFoundError tarkoittaa, että tiedosto tai sen kansio puuttuu.
export function readErrorMessage(error) {
  if (error?.code === "missing") return "Opintokansiota ei löydy. Tarkista tallennuspaikka kohdasta Asetukset › Tallennus.";
  if (error?.code === "permission") return "Kurssikaveri tarvitsee luvan opintokansioon. Paina Näytä teksti uudelleen ja salli kansion käyttö.";
  if (["NotFoundError", "TypeMismatchError"].includes(error?.name)) return "Tekstiä ei löytynyt kurssikansiosta. Se on ehkä siirretty tai poistettu.";
  return `Tekstin lukeminen epäonnistui${error?.message ? `: ${error.message}` : "."}`;
}

// Chromen lataushistorian haku Lataukset-tilassa: koko polku kurssikansiosta alkaen, jotta samanniminen
// tiedosto toisessa kansiossa ei osu. Windows käyttää kenoviivaa, muut järjestelmät kauttaviivaa.
export function downloadPathPattern(courseDir, relative) {
  const parts = `${courseDir}/${relative}`.split("/").filter(Boolean);
  const escape = part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `[\\\\/]${parts.map(escape).join("[\\\\/]")}$`;
}

export function missingDownloadMessage(relative) {
  return `Tiedostoa ei löydy Chromen lataushistoriasta. Löydät sen kurssikansiosta: ${relative}`;
}
