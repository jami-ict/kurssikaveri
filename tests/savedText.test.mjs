// Tallennetun tekstin näyttäminen ilman Obsidiania (shared/savedText.js)
import test from "node:test";
import assert from "node:assert/strict";
import { splitFrontmatter, stripHeader, readableText, readErrorMessage, downloadPathPattern } from "../shared/savedText.js";

const SELECTION = [
  "---",
  "source: https://example.org/sivu",
  'title: "Regressio: perusteet"',
  "created: 2026-11-22",
  'time: "12:05"',
  'course: "Data-analytiikka"',
  'note: "Tärkeä tenttiin"',
  "tags:",
  '  - "tentti"',
  '  - "regressio"',
  "selection: true",
  "---",
  "",
  "# Regressio: perusteet",
  "",
  "Lähde: [example.org](https://example.org/sivu) · tallennettu 22.11.2026 klo 12.05 · valittu teksti",
  "",
  "---",
  "",
  "## Malli",
  "",
  "Katso [ohje](https://example.org/ohje).",
  "",
  "```python",
  "y = a * x + b  # **ei lihavointia**",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  ""
].join("\r\n");

test("alkutiedot luetaan ja runko säilyy merkki merkiltä", () => {
  const { meta, body } = splitFrontmatter(SELECTION);
  assert.equal(meta.title, "Regressio: perusteet");
  assert.equal(meta.note, "Tärkeä tenttiin");
  assert.deepEqual(meta.tags, ["tentti", "regressio"]);
  assert.equal(meta.selection, "true");
  assert.ok(body.startsWith("\n# Regressio: perusteet"));
});

test("Kurssikaverin otsakelohko poistuu, mutta sisältö (linkit, koodi, taulukot) jää ennalleen", () => {
  const text = readableText(SELECTION);
  assert.equal(text.title, "Regressio: perusteet");
  assert.equal(text.source, "https://example.org/sivu");
  assert.equal(text.selection, true);
  assert.ok(text.body.startsWith("## Malli"));
  assert.ok(text.body.includes("[ohje](https://example.org/ohje)"));
  assert.ok(text.body.includes("y = a * x + b  # **ei lihavointia**"));
  assert.ok(text.body.includes("| 1 | 2 |"));
  assert.ok(!text.body.includes("Lähde:"));
});

test("tiedosto ilman alkutietoja näytetään kokonaan, tiedot listalta", () => {
  const text = readableText("# Omat muistiinpanot\n\nTeksti.", { title: "Listan nimi", url: "https://a.fi", note: "huom", tags: ["x"] });
  assert.equal(text.title, "Listan nimi");
  assert.equal(text.source, "https://a.fi");
  assert.equal(text.note, "huom");
  assert.deepEqual(text.tags, ["x"]);
  assert.equal(text.body, "# Omat muistiinpanot\n\nTeksti.");
});

test("käyttäjän oma alku ilman Lähde-riviä ei katoa", () => {
  assert.equal(stripHeader("# Otsikko\n\nEnsimmäinen kappale.\n\n---\n\nToinen."), "# Otsikko\n\nEnsimmäinen kappale.\n\n---\n\nToinen.");
});

test("lukuvirheet erotellaan", () => {
  assert.match(readErrorMessage({ code: "missing" }), /Asetukset › Tallennus/);
  assert.match(readErrorMessage({ code: "permission" }), /luvan/);
  assert.match(readErrorMessage({ name: "NotFoundError" }), /ei löytynyt kurssikansiosta/);
  assert.match(readErrorMessage(new Error("levy täynnä")), /epäonnistui: levy täynnä/);
});

test("lataushistorian haku osuu vain koko polkuun", () => {
  const re = new RegExp(downloadPathPattern("Kurssikaveri/Data (A)", "Omat tallennukset/Teksti.md"));
  assert.ok(re.test("C:\\Users\\x\\Downloads\\Kurssikaveri\\Data (A)\\Omat tallennukset\\Teksti.md"));
  assert.ok(re.test("/home/x/Downloads/Kurssikaveri/Data (A)/Omat tallennukset/Teksti.md"));
  assert.ok(!re.test("C:\\Users\\x\\Downloads\\Kurssikaveri\\Muu\\Omat tallennukset\\Teksti.md"));
  assert.ok(!re.test("C:\\Users\\x\\Downloads\\Kurssikaveri\\Data (A)\\Omat tallennukset\\Teksti.md.bak"));
});
