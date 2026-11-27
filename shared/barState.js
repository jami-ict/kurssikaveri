// barState.js – Moodle-palkin tilaviestit (content.js). Pelkkiä funktioita, joten testattavissa Nodella
// (tests/barState.test.mjs). content.js lataa tämän import()-kutsulla, kuten shared/skins.js:n.
//
// Periaate: palkin viesti kertoo vain sen, minkä Kurssikaveri tietää varmasti. "Kaikki tiedostot koneellasi"
// näkyy vasta, kun koko kurssi on luettu, tiedostoja on ja kaikki lataukset ovat valmiit.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Tallennustilanne. total/saved = tunnetut tiedostot ja niistä koneella olevat (keskeneräiset mukaan lukien),
// downloading = keskeneräiset lataukset, unknownFolders = kansiot, joiden sisältöä ei vielä tiedetä,
// unchecked = osa kurssin välilehdistä on lukematta.
// Palauttaa { kind, text, pct? }: kind = busy | checking | empty | done | partial | progress
export function progressState({ total = 0, saved = 0, downloading = 0, unknownFolders = 0, unchecked = false }) {
  if (downloading > 0) return { kind: "busy", text: `Tallennetaan… (${plural(downloading, "tiedosto", "tiedostoa")} kesken)` };
  if (total === 0 && unknownFolders === 0) {
    return unchecked
      ? { kind: "checking", text: "Kurssin sisältöä ei ole vielä tarkistettu kokonaan" }
      : { kind: "empty", text: "Kurssilta ei löytynyt tallennettavia tiedostoja" };
  }
  const pct = total ? Math.round(Math.min(saved, total) / total * 100) : 0;
  if (saved >= total && unknownFolders === 0) {
    return unchecked
      ? { kind: "partial", text: `${saved} / ${total} löydettyä tiedostoa koneellasi · osa kurssista tarkistamatta`, pct }
      : { kind: "done", text: "Kaikki tiedostot koneellasi", pct: 100 };
  }
  return { kind: "progress", text: `${saved} / ${total} tiedostoa koneellasi${unchecked ? " · osa kurssista tarkistamatta" : ""}`, pct };
}

// Kellonaika ja päivä viestiin: "tänään klo 14.20", "eilen klo 9.05", "20.11. klo 14.20"
export function whenText(ms, now = Date.now()) {
  const d = new Date(ms);
  const clock = `klo ${d.getHours()}.${String(d.getMinutes()).padStart(2, "0")}`;
  const day = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86400000);
  if (diff === 0) return `tänään ${clock}`;
  if (diff === 1) return `eilen ${clock}`;
  return `${d.getDate()}.${d.getMonth() + 1}. ${clock}`;
}

function agoText(ms, now) {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return "juuri nyt";
  if (minutes < 60) return `${minutes} min sitten`;
  return whenText(ms, now);
}

// Tarkistuksen tila palkissa. lastOk = viimeisimmän onnistuneen tarkistuksen aika, error = viimeisimmän
// yrityksen virheteksti (tyhjä, jos onnistui). Epäonnistuminen ei poista aiempaa onnistumisaikaa.
export function checkNote({ reading = false, lastOk = 0, error = "", now = Date.now() }) {
  if (reading) return "Tarkistetaan kurssin sisältöä…";
  if (error) return lastOk ? `${error} Viimeisin onnistunut tarkistus ${whenText(lastOk, now)}.` : error;
  return lastOk ? `Kurssin sisältö tarkistettu ${agoText(lastOk, now)}.` : "";
}

// Välilehden haun tulos: null = kunnossa, muuten virheen laji. Kirjautumissivu tunnistetaan osoitteesta
// (Moodle ohjaa /login/-sivulle) tai lomakkeesta (logintoken).
export function pageProblem({ ok, status, url }, doc) {
  if (/\/login\/(index\.php)?/.test(url || "")) return { code: "login" };
  if (doc && doc.querySelector && doc.querySelector('input[name="logintoken"], form#login')) return { code: "login" };
  if (!ok) return { code: "http", status };
  return null;
}

export function problemText(problem) {
  if (problem?.code === "login") return "Tarkistus epäonnistui. Kirjaudu Moodleen uudelleen.";
  if (problem?.code === "http") return `Tarkistus epäonnistui: Moodle ei vastannut odotetusti${problem.status ? ` (virhe ${problem.status})` : ""}. Yritä myöhemmin uudelleen.`;
  return "Tarkistus epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen.";
}

// Tallennuspainikkeet. Luku näytetään vain, kun tiedostojen määrä tiedetään (kansioiden sisältö tunnetaan).
export function savePageLabel({ unsaved, unknownFolders = 0, tabs = true }) {
  return `Tallenna tämän ${tabs ? "välilehden" : "sivun"} tiedostot${unknownFolders ? "" : ` (${unsaved})`}`;
}

export function savedMessage(done, total) {
  if (!total) return "Kaikki kurssin tiedostot on jo tallennettu.";
  return `Tallennettiin ${plural(done, "tiedosto", "tiedostoa")}.`;
}

// Sama teksti Moodle-palkissa ja Kurssikaverin kurssisivulla (shared/ui.js: saveCourseLabel)
export function saveCourseText({ unsaved, unknownFolders = 0 }) {
  return `Tallenna kurssin puuttuvat tiedostot${unknownFolders ? "" : ` (${unsaved})`}`;
}
