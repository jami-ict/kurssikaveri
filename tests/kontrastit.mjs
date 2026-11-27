// kontrastit.mjs – tarkistaa värimaailmojen luettavuuden (WCAG 2: teksti vähintään 4,5:1).
//
// Aja repon juuressa:  node tests/kontrastit.mjs
// Tulostaa jokaisen valmiin värimaailman ja jokaisen kurssivärien sävyn tekstin ja taustan parit vaaleassa
// ja tummassa teemassa. Parit ja rajat ovat tiedostossa shared/skins.js (PAIRS), ja muokkain käyttää samaa tarkistusta.
// Lopussa "Kaikki kunnossa" tai tieto siitä, moniko pari jää alle rajan.

import { PRESETS, TONES, contrastReport, moodleVars, contrast, previewStyle, mix } from "../shared/skins.js";

const MOODLE_PAIRS = [
  ["--kk-on-accent", "--kk-accent"], ["--kk-accent", "#ffffff"], ["--kk-text", "--kk-bg"],
  ["--kk-muted", "#ffffff"], ["--kk-new-ink", "--kk-new-bg"], ["--kk-on-warn", "--kk-warn"],
  // Moodle-palkin avoin kansio, tumma kieleke, avauslinkki ja päivitystunniste (päätös 25).
  ["--kk-text", "--kk-accent-soft"], ["--kk-accent-ink", "--kk-accent-soft"],
  ["--kk-accent", "--kk-accent-soft"], ["--kk-topbar-ink", "--kk-topbar"],
  ["#ffffff", "--kk-topbar"], ["--kk-warn", "--kk-warn-soft"]
];

let failures = 0;

function line(ok, ratio, fg, a, bg, b, limit) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "ALLE"} ${ratio.toFixed(2).padStart(5)}  ${fg} ${a} / ${bg} ${b}${ok ? "" : `  (raja ${limit})`}`);
}

for (const preset of PRESETS) {
  for (const [tone, toneName] of TONES) {
    // Metsä + pastelli on style.css:n oma paletti; muilla sävyillä Metsän värit toimivat oman värimaailman pohjana
    const skin = { ...preset, builtin: false, tone };
    for (const dark of [false, true]) {
      console.log(`\n${preset.name}, ${toneName} – ${dark ? "tumma" : "vaalea"}`);
      for (const p of contrastReport(skin, dark)) line(p.ok, p.ratio, p.fg, p.a, p.bg, p.b, p.limit);
      // Asetusten kansioiden reuna (style.css: .sfold --fold-border = 70 % --muted, 30 % --line), raja 3:1 (WCAG 1.4.11)
      const v = Object.fromEntries(previewStyle(skin, dark).split(";").filter(Boolean).map(part => part.split(":")));
      const border = mix(v["--line"], v["--muted"], 0.7), ratio = contrast(border, v["--bg"]);
      line(ratio >= 3, ratio, "kansion reuna", border, "--bg", v["--bg"], 3);
      // Hakutulosten raidoitus (style.css: .list.striped, 93 % --surface, 7 % --text): himmeä teksti raidalla
      const stripe = mix(v["--surface"], v["--text"], 0.07), muted = contrast(v["--muted"], stripe);
      line(muted >= 4.5, muted, "himmeä teksti raidalla", v["--muted"], "raita", stripe, 4.5);
    }
    const vars = moodleVars(skin);
    console.log(`\n${preset.name}, ${toneName} – Moodle-palkki`);
    for (const [fg, bg] of MOODLE_PAIRS) {
      const a = vars[fg] || fg, b = vars[bg] || bg, ratio = contrast(a, b);
      line(ratio >= 4.5, ratio, fg, a, bg, b, 4.5);
    }
  }
}

console.log(failures === 0 ? "\nKaikki kunnossa." : `\n${failures} paria jää alle rajan.`);
process.exitCode = failures === 0 ? 0 : 1;
