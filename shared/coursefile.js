// Kurssin tiedot.md:n kirjoitus oman kansion tilassa ja siirtyminen vanhoista nimistä (Sisalto.md, Kurssi.md).
// Vanhat tiedostot säilytetään kokonaisina, myös käyttäjän mahdolliset lisäykset.
import { COURSE_FILE, OLD_COURSE_FILE, LEGACY_CONTENTS_FILE, isCoursePage } from "./rules.js";

async function readOptional(folder, path) {
  try { return await (await folder.readFile(path)).text(); }
  catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

function isOwnNote(text) {
  const frontmatter = String(text || "").replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return Boolean(frontmatter && /^source:\s*["']?oma["']?\s*(?:#.*)?$/m.test(frontmatter[1]));
}

async function archive(folder, dir, filename, text) {
  if (!text.trim()) return; // Tyhjä välivaihe ei ole säilytettävä aiempi kurssisivu.
  let path = `.kurssikaveri/aiemmat-kurssisivut/${dir}/${filename}`;
  const earlier = await readOptional(folder, path);
  if (earlier === text) return;
  if (earlier !== null) path = await folder.uniquePath(path);
  await folder.writeFile(path, text);
}

export async function writeCoursePage(folder, dir, markdown) {
  // Eri lukko kuin store.js:n yleinen tallennuslukko: kutsuja voi jo pitää sitä hallussaan.
  // Suojaa koko lue–arkistoi–kirjoita-vaiheen myös suoraan kutsuttaessa.
  const key = String(dir).replace(/\\/g, "/").normalize("NFC").toLowerCase();
  return navigator.locks.request(`kurssikaveri-course-file:${key}`, () => writeCoursePageLocked(folder, dir, markdown));
}

async function writeCoursePageLocked(folder, dir, markdown) {
  const path = `${dir}/${COURSE_FILE}`;
  const legacyPath = `${dir}/${LEGACY_CONTENTS_FILE}`;
  const current = await readOptional(folder, path);
  const legacy = await readOptional(folder, legacyPath);
  if (isOwnNote(current) || isOwnNote(legacy)) {
    throw new Error(`${dir}: kurssitiedosto on merkitty source: oma. Tiedostoa ei muutettu.`);
  }
  if (current !== null && !isCoursePage(current)) {
    await archive(folder, dir, COURSE_FILE, current);
  }
  if (legacy !== null) await archive(folder, dir, LEGACY_CONTENTS_FILE, legacy);
  await folder.writeFile(path, markdown);
  // Vanha Kurssi.md: Kurssikaverin oma (tunniste) arkistoidaan ja poistetaan vasta uuden kirjoituksen jälkeen.
  // Käyttäjän samanniminen tiedosto (ei tunnistetta tai source: oma) jätetään ennalleen.
  const oldPath = `${dir}/${OLD_COURSE_FILE}`;
  const old = await readOptional(folder, oldPath);
  if (old !== null && isCoursePage(old) && !isOwnNote(old)) {
    await archive(folder, dir, OLD_COURSE_FILE, old);
    await folder.removeFile(oldPath);
  }
  // Poistetaan vanha näkyvä sisällysluettelo vasta, kun arkisto ja uusi kurssisivu on kirjoitettu.
  if (legacy !== null) await folder.removeFile(legacyPath);
}
