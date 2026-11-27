// Opintokansio toimii sellaisenaan Obsidian-holvin juurena.
import { escapeHtml } from "./ui.js";

// Ei muuta tallennuspaikkaa. Vanhankin asennuksen todellinen opintokansio haetaan kahvan kautta.
export async function prepareObsidian(folder, settings) {
  if (settings.storage !== "folder") throw new Error("Obsidianin käyttöönotto tarvitsee oman opintokansion.");
  // Vanhaa toimivaa kytkentää ei muuteta sisäkkäiseksi holviksi tai tiedostosiirroksi.
  if (settings.obsidian?.vault && (settings.obsidian.prefix || settings.obsidian.path)) {
    return { ...settings.obsidian, enabled: true };
  }
  const root = await folder.getStudyRoot();
  await folder.makeVault(root);
  return { ...settings.obsidian, enabled: true, vault: root.name, prefix: "", path: "" };
}

// compact = Asetusten avattava ohje: otsikko ja juurilause ovat jo ympäröivässä näkymässä.
export function obsidianInstructions(name, { compact = false } = {}) {
  return `<div class="obs-instructions">
    ${compact ? "" : "<p><strong>Avaa kansio vielä Obsidianissa</strong></p>"}
    <ol>
      <li>Avaa Obsidianin holvivalinta.</li>
      <li>Valitse <strong>Open folder as vault</strong> (Avaa kansio holvina).</li>
      <li>Valitse nykyinen opintokansiosi <strong class="obs-folder-name">${escapeHtml(name)}</strong>.</li>
    </ol>
    ${compact ? "" : "<p>Opintokansio on holvin juuri. Holvin nimi on kansion nimi.</p>"}
    <div class="actions"><a class="btn2" href="obsidian://choose-vault">Avaa Obsidianin holvivalinta</a></div>
    <details><summary>Jos tiedostot eivät näy Obsidianissa</summary>
      <p>Jos kansiota on tyhjennetty tai täytetty Obsidianin ollessa auki, tiedostolista voi jäädä vanhaan tilaan. Sulje holvi ja avaa se uudelleen. Voit myös avata Obsidianin komentovalikon (Ctrl+P) ja valita <strong>Reload app without saving</strong>.</p>
    </details>
  </div>`;
}
