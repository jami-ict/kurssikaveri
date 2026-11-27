// colors.js – kurssin väri (1–7). Värit ovat style.css:ssä: --k1-bg, --k1-dot, --k1-ink …
//
// Väri tallennetaan kurssille (course.color), kun kurssi lisätään, joten se pysyy samana, vaikka kursseja
// lisätään, poistetaan tai ne päättyvät. Uusi kurssi saa värin, jota käynnissä olevat ja tulevat kurssit
// käyttävät vähiten (7 väriä). Jos kurssilla ei vielä ole tallennettua väriä (vanha tallennus), väri lasketaan
// kurssin paikasta listassa, ja taustaskripti tallentaa sen (ensureColors).
// Jos määräaika kuuluu kurssiin, jota ei ole tuotu, väri lasketaan Moodlen kurssinumerosta.
// Omat merkinnät ilman kurssia ovat keltaisia ("own": --own, --own-ink).

export const COLOR_COUNT = 7;

export function colorForCourse(data, course, moodleId = null) {
  if (course && course.color >= 1 && course.color <= COLOR_COUNT) return course.color; // tallennettu väri
  const current = data.courses.filter(c => c.status !== "completed");
  const index = !course ? -1
    : course.status !== "completed" ? current.indexOf(course)
    : current.length + data.courses.filter(c => c.status === "completed").indexOf(course);
  const n = index >= 0 ? index : Math.abs(Number(moodleId) || 0);
  return (n % COLOR_COUNT) + 1;
}

// Väri uudelle kurssille: se, jota käynnissä olevat ja tulevat kurssit käyttävät vähiten (tasatilanteessa pienin numero)
export function pickColor(courses) {
  const used = new Array(COLOR_COUNT + 1).fill(0);
  for (const c of courses) if (c.status !== "completed" && c.color >= 1 && c.color <= COLOR_COUNT) used[c.color]++;
  let best = 1;
  for (let n = 2; n <= COLOR_COUNT; n++) if (used[n] < used[best]) best = n;
  return best;
}

// Antaa värin kursseille, joilla sitä ei vielä ole. Palauttaa true, jos jokin muuttui.
// Jos yhdelläkään kurssilla ei ole väriä (vanha tallennus), kurssit pitävät värin, joka niillä on tähän asti näkynyt.
export function ensureColors(courses) {
  const missing = courses.filter(c => !c.color);
  if (missing.length === 0) return false;
  if (missing.length === courses.length) {
    const shown = courses.map(c => colorForCourse({ courses }, c));
    courses.forEach((c, i) => { c.color = shown[i]; });
  } else {
    for (const c of missing) c.color = pickColor(courses);
  }
  return true;
}

// CSS-arvot värille: { bg, dot, ink }
export function colorVars(color) {
  if (color === "own") return { bg: "var(--own)", dot: "#D9B02C", ink: "var(--own-ink)" };
  return { bg: `var(--k${color}-bg)`, dot: `var(--k${color}-dot)`, ink: `var(--k${color}-ink)` };
}

// Muistilappu omien merkintöjen tunnukseksi (sama keltainen molemmissa teemoissa)
export function postIt(className = "pit") {
  return `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h11v7.2l-3.8 3.8H2.5z" fill="#F7D54A" stroke="#8A6D00" stroke-width="1" stroke-linejoin="round"/><path d="M13.5 9.7h-3.8v3.8z" fill="#D9B02C" stroke="#8A6D00" stroke-width="1" stroke-linejoin="round"/></svg>`;
}
