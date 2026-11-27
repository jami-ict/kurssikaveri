// Moodle-palkin tilaviestit (shared/barState.js): viestiin pitää voida luottaa.
import test from "node:test";
import assert from "node:assert/strict";
import { progressState, checkNote, whenText, pageProblem, problemText, savePageLabel, savedMessage, saveCourseText } from "../shared/barState.js";

test("keskeneräinen lataus ei näytä valmista tilaa", () => {
  const state = progressState({ total: 7, saved: 7, downloading: 2 });
  assert.equal(state.kind, "busy");
  assert.doesNotMatch(state.text, /Kaikki/);
  assert.match(state.text, /2 tiedostoa kesken/);
});

test("lukematon välilehti estää koko kurssin onnistumisviestin", () => {
  const state = progressState({ total: 7, saved: 7, unchecked: true });
  assert.equal(state.kind, "partial");
  assert.equal(state.text, "7 / 7 löydettyä tiedostoa koneellasi · osa kurssista tarkistamatta");
  assert.equal(progressState({ total: 7, saved: 7 }).text, "Kaikki tiedostot koneellasi");
});

test("tuntematon kansio estää onnistumisviestin", () => {
  assert.equal(progressState({ total: 3, saved: 3, unknownFolders: 1 }).kind, "progress");
});

test("nollasta tiedostosta ei synny onnistumisviestiä", () => {
  assert.deepEqual(progressState({ total: 0, saved: 0 }), { kind: "empty", text: "Kurssilta ei löytynyt tallennettavia tiedostoja" });
  assert.equal(progressState({ total: 0, saved: 0, unchecked: true }).kind, "checking");
});

test("osittainen tallennus näyttää luvut", () => {
  const state = progressState({ total: 7, saved: 4 });
  assert.equal(state.text, "4 / 7 tiedostoa koneellasi");
  assert.equal(state.pct, 57);
});

test("epäonnistunut tarkistus säilyttää viimeisimmän onnistumisajan", () => {
  const now = new Date(2026, 10, 22, 15, 0).getTime();
  const lastOk = new Date(2026, 10, 22, 14, 20).getTime();
  const error = problemText({ code: "login" });
  assert.equal(checkNote({ lastOk, error, now }), "Tarkistus epäonnistui. Kirjaudu Moodleen uudelleen. Viimeisin onnistunut tarkistus tänään klo 14.20.");
  assert.equal(checkNote({ error, now }), error);
  assert.equal(checkNote({ lastOk, now }), "Kurssin sisältö tarkistettu 40 min sitten.");
  assert.equal(checkNote({ reading: true, lastOk, error, now }), "Tarkistetaan kurssin sisältöä…");
});

test("päivämäärät", () => {
  const now = new Date(2026, 10, 22, 9, 0).getTime();
  assert.equal(whenText(new Date(2026, 10, 21, 9, 5).getTime(), now), "eilen klo 9.05");
  assert.equal(whenText(new Date(2026, 10, 18, 14, 20).getTime(), now), "18.11. klo 14.20");
});

test("kirjautumissivu, HTTP-virhe ja verkkovirhe erotellaan", () => {
  const none = { querySelector: () => null };
  assert.equal(pageProblem({ ok: true, status: 200, url: "https://moodle/course/view.php?id=1" }, none), null);
  assert.equal(pageProblem({ ok: true, status: 200, url: "https://moodle/login/index.php" }, none).code, "login");
  assert.equal(pageProblem({ ok: true, status: 200, url: "https://moodle/course/view.php" }, { querySelector: () => ({}) }).code, "login");
  const http = pageProblem({ ok: false, status: 503, url: "https://moodle/course/view.php" }, none);
  assert.match(problemText(http), /virhe 503/);
  assert.match(problemText(null), /verkkoyhteys/);
});

test("painikkeiden tekstit ja taivutus", () => {
  assert.equal(savePageLabel({ unsaved: 3 }), "Tallenna tämän välilehden tiedostot (3)");
  assert.equal(savePageLabel({ unsaved: 3, tabs: false }), "Tallenna tämän sivun tiedostot (3)");
  assert.equal(savePageLabel({ unsaved: 3, unknownFolders: 1 }), "Tallenna tämän välilehden tiedostot");
  assert.equal(saveCourseText({ unsaved: 8 }), "Tallenna kurssin puuttuvat tiedostot (8)");
  assert.equal(savedMessage(1, 1), "Tallennettiin 1 tiedosto.");
  assert.equal(savedMessage(5, 5), "Tallennettiin 5 tiedostoa.");
  assert.equal(savedMessage(0, 0), "Kaikki kurssin tiedostot on jo tallennettu.");
});
