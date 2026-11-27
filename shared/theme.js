// theme.js – teema ja värimaailma lisäosan sivuille.
//
// Teema: "system" = seurataan käyttöjärjestelmän asetusta (style.css: @media prefers-color-scheme),
// "light" / "dark" = <html data-theme="..."> pakottaa valinnan.
// Värimaailma (shared/skins.js): muu kuin "Metsä" korvaa style.css:n värimuuttujat tyylillä <style id="kk-skin">.
// Moodle-sivun palkki (content.css) on aina vaalea, ja sen värit asettaa content.js.

import { getSkin, skinCss } from "./skins.js";

// Viimeksi käytetty värimaailma muistetaan myös sivun omassa muistissa, jotta se saadaan näkyviin heti
// eikä vasta, kun asetukset on luettu.
const CACHE_KEY = "kk-skin-css";

function setSkinCss(css) {
  let style = document.getElementById("kk-skin");
  if (!css) { if (style) style.remove(); return; }
  if (!style) {
    style = document.createElement("style");
    style.id = "kk-skin";
    document.head.appendChild(style); // style.css:n jälkeen, jotta nämä arvot voittavat
  }
  if (style.textContent !== css) style.textContent = css;
}

try { setSkinCss(localStorage.getItem(CACHE_KEY) || ""); } catch { /* muisti ei käytössä: värit tulevat hetken päästä */ }

export async function applyTheme() {
  const { settings } = await chrome.storage.local.get("settings");
  const theme = (settings && settings.theme) || "system";
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;

  const css = skinCss(getSkin(settings));
  setSkinCss(css);
  try {
    if (css) localStorage.setItem(CACHE_KEY, css);
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* ei haittaa */ }
}

applyTheme();
chrome.storage.onChanged.addListener(changes => { if (changes.settings) applyTheme(); });
