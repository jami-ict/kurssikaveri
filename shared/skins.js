// skins.js – värimaailmat.
//
// Värimaailma on neljä valintaa: pohja (base), pääväri (accent), huomioväri (warn) ja kurssivärien sävy (tone).
// Niistä lasketaan style.css:n muuttujat (--bg, --accent, --warn …) vaalealle ja tummalle teemalle.
// "Metsä" on style.css:n oma paletti (P1B): sille ei lasketa mitään, vaan style.css:n arvot ovat voimassa.
// Käyttäjän omat värimaailmat ovat asetuksissa (settings.customSkins) samassa muodossa kuin valmiit.
//
// Sivuilla värit asettaa shared/theme.js. Moodlen sisältöskripti lataa saman paletin kurssisivulla.
//
// Tässä tiedostossa ei käytetä sivua (document), joten sama koodi toimii sivuilla, taustaskriptissä ja Nodessa
// (tests/kontrastit.mjs tarkistaa värien luettavuuden).

export const DEFAULT_SKIN = "meri";

// builtin = style.css:n oma paletti; sen base, accent ja warn ovat mukana vain oman värimaailman lähtöarvoiksi
export const PRESETS = [
  { id: "meri", name: "Meri", base: "#f1f4f6", accent: "#1f4e6b", warn: "#a34a12", tone: "pastel" },
  { id: "metsa", name: "Metsä", builtin: true, base: "#f6f3ec", accent: "#28513f", warn: "#9a3d0a", tone: "pastel" },
  { id: "kanerva", name: "Kanerva", base: "#f7f1f5", accent: "#674064", warn: "#9a480d", tone: "pastel" }
];

// Kurssivärien sävyt. Pastelli = style.css:n omat kurssivärit.
export const TONES = [["pastel", "Pastelli"], ["bright", "Kirkas"], ["muted", "Murrettu"]];

const HEX = /^#[0-9a-f]{6}$/i;

// Tarkistaa ja siistii värimaailman (asetuksista tai myöhemmin tiedostosta). Palauttaa null, jos se ei kelpaa.
export function cleanSkin(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { id, name, base, accent, warn, tone } = raw;
  if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/i.test(id) || PRESETS.some(p => p.id === id)) return null;
  if (![base, accent, warn].every(c => typeof c === "string" && HEX.test(c))) return null;
  return {
    id,
    name: String(name || "Oma värimaailma").trim().slice(0, 30) || "Oma värimaailma",
    base: base.toLowerCase(), accent: accent.toLowerCase(), warn: warn.toLowerCase(),
    tone: TONES.some(([key]) => key === tone) ? tone : "pastel"
  };
}

export function customSkins(settings) {
  const list = (settings && Array.isArray(settings.customSkins)) ? settings.customSkins : [];
  return list.map(cleanSkin).filter(Boolean);
}

// Valmiit ja omat
export function allSkins(settings) {
  return [...PRESETS, ...customSkins(settings)];
}

export function getSkin(settings) {
  const id = (settings && settings.skin) || DEFAULT_SKIN;
  return allSkins(settings).find(s => s.id === id) || PRESETS[0];
}

// ---------- värilaskenta ----------

function toRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map(c => c + c).join("") : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return "#" + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

// Sekoitus: amount = kuinka paljon väriä b (0…1)
export function mix(a, b, amount) {
  const x = toRgb(a), y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * amount));
}

// Suhteellinen kirkkaus ja kontrasti WCAG 2 -kaavalla (1…21). Teksti tarvitsee vähintään 4,5.
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function toHsl(hex) {
  const [r, g, b] = toRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([r, g, b].map(v => (v + m) * 255));
}

// Sama sävy, uusi vaaleus (0…1)
function withLightness(hex, lightness) {
  const [h, s] = toHsl(hex);
  return fromHsl([h, s, lightness]);
}


// Siirtää väriä kohti mustaa tai valkoista, kunnes se erottuu taustasta (suhde vähintään ratio)
export function readable(color, background, ratio = 4.5) {
  const toward = luminance(background) > 0.4 ? "#000000" : "#ffffff";
  let result = color;
  for (let i = 1; i <= 20 && contrast(result, background) < ratio; i++) result = mix(color, toward, i / 20);
  return result;
}

// Teksti värin päällä: valkoinen, jos se erottuu, muuten tumma
function inkOn(background, dark = "#10201a") {
  return contrast("#ffffff", background) >= 4.5 ? "#ffffff" : readable(dark, background);
}

// ---------- muuttujat ----------

function lightVars({ id, base, accent: accentIn, warn: warnIn }) {
  const text = mix(base, "#000000", 0.87);
  const accent = darken(accentIn, base); // sama korjaus kuin muokkaimen "Tummenna automaattisesti"
  const warn = darken(warnIn, base);
  const accentSoft = mix(accent, "#ffffff", 0.82);
  const accentInk = readable(mix(accent, "#000000", 0.3), accentSoft);
  const onAccent = inkOn(accent);
  return {
    "--bg": base,
    "--surface": mix(base, "#ffffff", 0.6),
    "--field": "#ffffff",
    "--text": text,
    "--muted": readable(mix(text, base, 0.3), base),
    "--faint": mix(text, base, 0.62),
    "--border": mix(base, text, 0.14),
    "--line": mix(base, text, 0.08),
    "--accent": accent,
    "--accent-hover": mix(accent, "#000000", 0.25),
    "--accent-soft": accentSoft,
    "--accent-ink": accentInk,
    "--on-accent": onAccent,
    "--warn": warn,
    "--warn-soft": mix(warn, "#ffffff", 0.84),
    ...(id === DEFAULT_SKIN ? { "--ok": accentInk, "--ok-soft": accentSoft } : {}),
    "--on-warn": inkOn(warn),
    "--new": accentInk,
    "--new-soft": accentSoft,
    "--topbar": accent,
    "--topbar-ink": readable(mix(onAccent, accent, 0.15), accent)
  };
}

function darkVars({ id, base, accent: accentIn, warn: warnIn }) {
  const bg = mix("#1b1c1c", accentIn, 0.08);
  const surface = mix(bg, "#ffffff", 0.05);
  const text = mix(base, "#000000", 0.06);
  const accent = readable(withLightness(accentIn, 0.64), surface, 5.5);
  const warn = readable(withLightness(warnIn, 0.69), surface, 5.5);
  const accentSoft = mix(surface, accent, 0.18);
  const accentInk = readable(mix(accent, "#ffffff", 0.6), accentSoft);
  const topbar = mix(accentIn, "#000000", 0.55);
  const darkInk = mix(bg, "#000000", 0.3);
  return {
    "--bg": bg,
    "--surface": surface,
    "--field": surface,
    "--text": text,
    "--muted": readable(mix(text, bg, 0.32), surface),
    "--faint": mix(text, bg, 0.68),
    "--border": mix(bg, "#ffffff", 0.15),
    "--line": mix(bg, "#ffffff", 0.09),
    "--accent": accent,
    "--accent-hover": mix(accent, "#ffffff", 0.3),
    "--accent-soft": accentSoft,
    "--accent-ink": accentInk,
    "--on-accent": readable(darkInk, accent),
    "--warn": warn,
    "--warn-soft": mix(surface, warn, 0.2),
    ...(id === DEFAULT_SKIN ? { "--ok": accentInk, "--ok-soft": accentSoft } : {}),
    "--on-warn": readable(darkInk, warn),
    "--new": accentInk,
    "--new-soft": accentSoft,
    "--topbar": topbar,
    "--topbar-ink": readable(mix("#ffffff", topbar, 0.2), topbar)
  };
}

// ---------- kurssivärit ----------
// Paul Tolin Bright-paletti. Kurssin piste säilyy samana myös oman teeman sävyä vaihdettaessa.
const COURSE_DOTS = ["#4477aa", "#ee6677", "#228833", "#ccbb44", "#66ccee", "#aa3377", "#bbbbbb"];

function courseVars(tone, dark) {
  const surface = dark ? "#232528" : "#ffffff";
  const amount = { pastel: 0.22, bright: 0.38, muted: 0.12 }[tone] ?? 0.22;
  const vars = {};
  COURSE_DOTS.forEach((dot, i) => {
    const key = `--k${i + 1}`;
    const background = mix(surface, dot, amount);
    vars[key + "-bg"] = background;
    vars[key + "-dot"] = dot;
    vars[key + "-ink"] = readable(mix(dot, dark ? "#ffffff" : "#000000", 0.7), background, 7);
  });
  return vars;
}

// { light: { "--bg": "#…", … }, dark: { … } } tai null, kun käytössä on style.css:n oma paletti
export function skinVars(skin) {
  if (!skin || skin.builtin) return null;
  return {
    light: { ...lightVars(skin), ...courseVars(skin.tone, false) },
    dark: { ...darkVars(skin), ...courseVars(skin.tone, true) }
  };
}

function block(vars) {
  return Object.entries(vars).map(([name, value]) => `${name}:${value};`).join("");
}

// CSS, joka korvaa style.css:n värimuuttujat. Valitsimet ovat samat kuin style.css:ssä, ja koska tämä tyyli
// lisätään sivulle style.css:n jälkeen, nämä arvot voittavat. Tyhjä merkkijono = ei korvata mitään.
export function skinCss(skin) {
  const vars = skinVars(skin);
  if (!vars) return "";
  const dark = block(vars.dark);
  return `:root{${block(vars.light)}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}`
    + `:root[data-theme="dark"]{${dark}}`;
}

// Moodle-palkin värit (content.css: var(--kk-…)). Moodle-sivu on aina vaalea. null = content.css:n omat värit.
export function moodleVars(skin) {
  const vars = skinVars(skin);
  if (!vars) return null;
  const v = vars.light;
  return {
    "--kk-accent": v["--accent"],
    "--kk-on-accent": v["--on-accent"],
    "--kk-text": v["--text"],
    "--kk-muted": v["--muted"],
    "--kk-faint": v["--faint"],
    "--kk-bg": v["--bg"],
    "--kk-line": v["--border"],
    "--kk-surface": v["--surface"],
    "--kk-accent-soft": v["--accent-soft"],
    "--kk-accent-ink": v["--accent-ink"],
    "--kk-topbar": v["--topbar"],
    "--kk-topbar-ink": v["--topbar-ink"],
    "--kk-fold-border": mix(v["--line"], v["--muted"], 0.7),
    "--kk-new-bg": v["--new-soft"],
    "--kk-new-ink": v["--new"],
    "--kk-warn": v["--warn"],
    "--kk-warn-soft": v["--warn-soft"],
    "--kk-on-warn": v["--on-warn"],
    // --k1-bg → --kk-k1-bg
    ...Object.fromEntries(Object.entries(v).filter(([name]) => /^--k\d-/.test(name)).map(([name, value]) => [name.replace("--k", "--kk-k"), value]))
  };
}

// Kortissa näkyvät kansion kieleke, pinta ja huomioväri.
export function skinPreview(skin, dark) {
  if (skin.builtin) return dark
    ? { bar: "#13261d", bg: "#232825", warn: "#f0a070" }
    : { bar: skin.accent, bg: "#fffdf8", warn: skin.warn };
  const vars = dark ? darkVars(skin) : lightVars(skin);
  return { bar: vars["--topbar"], bg: vars["--surface"], warn: vars["--warn"] };
}

export function previewStyle(skin, dark) {
  return block({ ...(dark ? darkVars(skin) : lightVars(skin)), ...courseVars(skin.tone, dark) });
}

// ---------- luettavuus ----------
// [teksti, tausta, pienin sallittu kontrasti]
const PAIRS = [
  ["--text", "--bg", 4.5], ["--text", "--surface", 4.5], ["--text", "--field", 4.5],
  ["--muted", "--bg", 4.5], ["--muted", "--surface", 4.5],
  ["--accent", "--bg", 4.5], ["--accent", "--surface", 4.5], ["--accent", "--field", 4.5],
  ["--on-accent", "--accent", 4.5], ["--on-accent", "--accent-hover", 4.5],
  ["--accent-ink", "--accent-soft", 4.5], ["--new", "--new-soft", 4.5],
  ["--warn", "--bg", 4.5], ["--warn", "--surface", 4.5], ["--warn", "--accent-soft", 3], // iso teksti kansiossa
  ["--on-warn", "--warn", 4.5], ["--topbar-ink", "--topbar", 4.5], ["#ffffff", "--topbar", 4.5], // logo on valkoinen
  ...[1, 2, 3, 4, 5, 6, 7].map(n => [`--k${n}-ink`, `--k${n}-bg`, 4.5])
];

// Kaikki tarkistetut parit yhdelle teemalle: [{ fg, bg, a, b, ratio, limit, ok }]
export function contrastReport(skin, dark) {
  const vars = Object.fromEntries(previewStyle(skin, dark).split(";").filter(Boolean).map(part => part.split(":")));
  return PAIRS.map(([fg, bg, limit]) => {
    const a = vars[fg] || fg, b = vars[bg] || bg, ratio = contrast(a, b);
    return { fg, bg, a, b, ratio, limit, ok: ratio >= limit };
  });
}

// Muokkaimen huomautukset käyttäjän valitsemista väreistä. Tyhjä lista = luettavuus kunnossa.
// fix = korjattu arvo samalle kentälle ("Korjaa automaattisesti").
// Tummentaa väriä sävy säilyttäen, kunnes se erottuu taustasta
function darken(color, background, ratio = 4.5) {
  const [h, s, l] = toHsl(color);
  let result = color;
  for (let step = 1; step <= 50 && contrast(result, background) < ratio; step++) result = fromHsl([h, s, Math.max(0, l - step * 0.02)]);
  return result;
}

const MIN_BASE_LUMINANCE = 0.6; // pohjan pitää olla vaalea: tumma teema lasketaan erikseen

export function skinIssues(skin) {
  const issues = [];
  if (luminance(skin.base) < MIN_BASE_LUMINANCE) {
    const [h, s, l] = toHsl(skin.base);
    let fix = skin.base;
    for (let step = 1; step <= 50 && luminance(fix) < MIN_BASE_LUMINANCE; step++) fix = fromHsl([h, s, Math.min(1, l + step * 0.02)]);
    issues.push({ field: "base", fix, text: "Pohja on liian tumma. Valitse vaalea pohja: tumma teema lasketaan siitä automaattisesti.", action: "Vaalenna automaattisesti" });
    return issues; // muut värit verrataan pohjaan, joten pohja korjataan ensin
  }
  if (contrast(skin.accent, skin.base) < 4.5) {
    issues.push({ field: "accent", fix: darken(skin.accent, skin.base), text: "Linkit ja valinnat eivät erotu pohjasta. Pääväri on liian lähellä pohjan väriä.", action: "Tummenna automaattisesti" });
  }
  if (contrast(skin.warn, skin.base) < 4.5) {
    issues.push({ field: "warn", fix: darken(skin.warn, skin.base), text: "Huomioväri ei erotu pohjasta.", action: "Tummenna automaattisesti" });
  }
  if (issues.length === 0) {
    const failed = [...contrastReport(skin, false), ...contrastReport(skin, true)].filter(pair => !pair.ok);
    if (failed.length > 0) issues.push({ field: null, fix: null, text: "Jokin teksti ei erotu taustastaan näillä väreillä. Kokeile tummempaa pääväriä tai huomioväriä.", action: "" });
  }
  return issues;
}
