// moodle.js – Moodlen rajapinnan käyttö: kirjautumisen tila, kurssilista ja määräajat.
//
// Moodlen omat sivut hakevat tietonsa osoitteesta lib/ajax/service.php. Pyyntöön tarvitaan
// istuntoavain (sesskey), joka on jokaisen Moodle-sivun lähdekoodissa (M.cfg.sesskey).
// Lisäosa lukee avaimen Omat kurssit -sivulta ja tekee saman pyynnön kuin Moodle itse.
// Selaimen kirjautuminen kulkee mukana, joten erillistä kirjautumista ei tarvita.
//
// Käytetyt rajapinnat (toimivat SAMKissa, testattu):
//   core_course_get_enrolled_courses_by_timeline_classification  kurssit ja niiden päivämäärät
//   core_calendar_get_action_events_by_timesort                  palautettavat tehtävät (Aikajana)

import { parseMoodleCourseName, semesterFor, statusFor, activityIdFromUrl } from "./rules.js";

export class LoginError extends Error {
  constructor(base) {
    super("Et ole kirjautunut Moodleen. Kirjaudu Moodleen tässä selaimessa ja yritä uudelleen.");
    this.code = "login";
    this.base = base;
  }
}

let cachedKey = null; // { base, key, time }

// Vastaako Moodle-palvelin? Kun istunto on vanhentunut, Moodle voi ohjata pyynnön koulun kertakirjautumiseen
// toiselle palvelimelle (SAMKissa idp.samk.fi). Chrome katkaisee silloin haun (CORS), ja katkos näyttää samalta
// kuin verkkovirhe. Tämä pyyntö ei seuraa ohjausta, joten se onnistuu aina, kun Moodle vastaa:
// onnistui → katkos johtui kirjautumisohjauksesta, epäonnistui → oikea verkkovirhe.
export async function moodleReachable(base) {
  try {
    await fetch(`${base}/login/index.php`, { credentials: "include", redirect: "manual", cache: "no-store" });
    return true;
  } catch (error) {
    return false;
  }
}

// Istuntosivun ja AJAX-rajapinnan pitää vastata suoraan. Kirjautumisohjaus kuuluu käyttäjän välilehdelle.
async function sessionFetch(base, path, options = {}) {
  let response;
  try {
    response = await fetch(base + path, { ...options, credentials: "include", redirect: "manual" });
  } catch (error) {
    throw new Error(`Moodleen ei saatu yhteyttä (${base}). Tarkista osoite ja verkkoyhteys.`);
  }
  if (response.type === "opaqueredirect" || response.status === 401) {
    cachedKey = null;
    throw new LoginError(base);
  }
  return response;
}

async function sesskey(base, fresh = false) {
  if (!fresh && cachedKey && cachedKey.base === base && Date.now() - cachedKey.time < 10 * 60 * 1000) return cachedKey.key;
  const response = await sessionFetch(base, "/my/courses.php", { cache: "no-store" });
  if (!response.ok) throw new Error(`Moodle ei vastannut odotetusti (${response.status}).`);
  const html = await response.text();
  const match = html.match(/"sesskey"\s*:\s*"([^"]+)"/);
  if (/id=["'](?:page-login-index|login|loginform)["']/i.test(html) || (!match && /loginform/i.test(html))) {
    cachedKey = null;
    throw new LoginError(base);
  }
  if (!match) throw new Error(`Osoitteessa ${base} ei näytä olevan Moodlea. Tarkista osoite asetuksista.`);
  cachedKey = { base, key: match[1], time: Date.now() };
  return match[1];
}

// Kutsuu Moodlen rajapintaa. Vanhentunut avain haetaan kerran uudelleen.
export async function callMoodle(base, method, args, retry = true) {
  const key = await sesskey(base, !retry);
  const response = await sessionFetch(base, `/lib/ajax/service.php?sesskey=${encodeURIComponent(key)}&info=${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ index: 0, methodname: method, args }])
  });
  let result;
  try { result = await response.json(); } catch (e) { throw new Error(`Moodle ei vastannut odotetusti (${response.status}).`); }
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || first.error) {
    const info = (first && first.exception) || first || {};
    const code = info.errorcode || "";
    if (code === "invalidsesskey" && retry) return callMoodle(base, method, args, false);
    if (/requirelogin|login/i.test(code + " " + (info.message || ""))) { cachedKey = null; throw new LoginError(base); }
    const error = new Error(`Moodle: ${info.message || "tuntematon virhe"}${code ? ` (${code})` : ""}`);
    error.code = code;
    throw error;
  }
  return first.data;
}

// Kirjautumisen tila aloitusopasta ja tuontia varten
export async function loginStatus(base) {
  try {
    await sesskey(base, true);
    return { loggedIn: true };
  } catch (error) {
    return { loggedIn: false, reason: error.code === "login" ? "login" : "error", message: error.message };
  }
}

// ---------- Kurssit ----------

export async function fetchMoodleCourses(base) {
  const data = await callMoodle(base, "core_course_get_enrolled_courses_by_timeline_classification",
    { offset: 0, limit: 0, classification: "allincludinghidden", sort: "fullname" });
  return data.courses.map(c => ({
    id: c.id, fullname: c.fullname, shortname: c.shortname,
    startdate: c.startdate || 0, enddate: c.enddate || 0, hidden: Boolean(c.hidden)
  }));
}

// Kurssit, jotka Moodle näyttää menneinä (Kojelauta → Menneet). Moodle laskee kurssin menneeksi,
// kun loppupäivä on ohi tai kun kurssi on merkitty opiskelijalle suoritetuksi – jälkimmäistä
// lisäosa ei näe päivämääristä. Palauttaa joukon Moodlen kurssi-id:itä.
export async function fetchMoodlePastIds(base) {
  const data = await callMoodle(base, "core_course_get_enrolled_courses_by_timeline_classification",
    { offset: 0, limit: 0, classification: "past", sort: "fullname" });
  return new Set(data.courses.map(c => c.id));
}

export function isImportedCourse(id, existing, moodleMap) {
  return Boolean(moodleMap[id]) || existing.some(c => c.moodleId === id);
}

// Muuttaa Moodlen kurssit tuonnin esikatselun riveiksi
export function toImportRows(moodleCourses, existing, moodleMap) {
  return moodleCourses.map(m => {
    const parsed = parseMoodleCourseName(m.fullname, m.shortname);
    const imported = isImportedCourse(m.id, existing, moodleMap);
    return {
      moodleId: m.id,
      fullname: m.fullname,
      shortname: m.shortname,
      name: parsed.name,
      code: parsed.code,
      semester: semesterFor(m.startdate),
      status: statusFor(m.startdate, m.enddate),
      start: m.startdate,
      end: m.enddate,
      hidden: m.hidden,
      imported,
      selected: !imported
    };
  });
}

// ---------- Määräajat ----------

// Moodle lisää tapahtuman nimeen loppuosan ("… on palautettava viimeistään", "… is due") eri kielillä.
const EVENT_SUFFIX = /\s+(on palautettava viimeistään|is due|sulkeutuu|closes|avautuu|opens|should be completed|tulee olla valmis)\.?$/i;

export const EVENT_LABELS = {
  due: "Määräaika",
  close: "Sulkeutuu",
  open: "Avautuu",
  expectcompletionon: "Valmis viimeistään"
};

export function eventLabel(eventtype) {
  return EVENT_LABELS[eventtype] || "Määräaika";
}

// Aikajanalta haetaan kalenteriin myös avautumiset. Muut tapahtumat säilyttävät
// määräaikakäsittelyn myös vanhoissa tallennuksissa, joista tapahtumatyyppi puuttuu.
export function isMoodleDeadline(event) {
  return event.eventtype !== "open";
}

const EVENTS_PER_PAGE = 50; // Moodle antaa enintään 50 tapahtumaa kerralla

// Palautettavat tehtävät viikon takaa eteenpäin (Moodlen Aikajana). Palautetut eivät ole listalla.
// Jos tapahtumia on yli 50, loput haetaan sivu kerrallaan (aftereventid = edellisen sivun viimeinen tapahtuma).
export async function fetchDeadlines(base) {
  const now = Math.floor(Date.now() / 1000);
  const events = [];
  const seen = new Set();
  let after = 0;
  while (true) {
    const args = { timesortfrom: now - 7 * 86400, limitnum: EVENTS_PER_PAGE, limittononsuspendedevents: true };
    if (after) args.aftereventid = after;
    const data = await callMoodle(base, "core_calendar_get_action_events_by_timesort", args);
    const batch = data?.events;
    if (!Array.isArray(batch) || batch.some(e => !e?.id)) {
      throw new Error("Moodlen määräaikojen sivu oli virheellinen.");
    }
    if (batch.length === 0) break;
    after = batch[batch.length - 1].id;
    if (seen.has(String(after))) throw new Error("Moodlen määräaikojen sivutus ei edennyt.");
    for (const event of batch) {
      const id = String(event.id);
      if (seen.has(id)) continue;
      seen.add(id);
      events.push(event);
    }
    if (batch.length < EVENTS_PER_PAGE) break;
  }
  return events.filter(e => e.eventtype !== "gradingdue").map(e => deadlineFromEvent(e, now));
}

function deadlineFromEvent(e, now) {
  return {
    id: String(e.id),
    moodleId: e.course ? e.course.id : null,
    courseTitle: e.course ? e.course.fullname : "",
    cmid: activityIdFromUrl(e.url),
    name: (e.activityname || String(e.name || "").replace(EVENT_SUFFIX, "")).trim(),
    module: e.modulename || "",
    eventtype: e.eventtype || "",
    label: eventLabel(e.eventtype),
    time: e.timesort * 1000,
    overdue: Boolean(e.overdue) || e.timesort < now,
    url: e.url || "",
    action: e.action ? e.action.name : ""
  };
}

// Kuukausikalenteri sisältää myös tehtäviä, jotka ovat jo poistuneet Aikajanalta.
export async function calendarAssignments(base, from, to) {
  const month = new Date(from);
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const events = new Map();
  const now = Math.floor(Date.now() / 1000);
  while (month.getTime() <= to) {
    const data = await callMoodle(base, "core_calendar_get_calendar_monthly_view", {
      year: month.getFullYear(), month: month.getMonth() + 1, includenavigation: false, mini: false
    });
    if (!Array.isArray(data?.weeks)) throw new Error("Moodle ei palauttanut kuukausikalenteria.");
    for (const week of data.weeks) {
      for (const day of week.days) {
        for (const e of day.events || []) {
          if (e.modulename !== "assign" || e.eventtype !== "due" || !e.id) continue;
          const item = deadlineFromEvent(e, now);
          if (item.cmid && item.time >= from && item.time <= to) events.set(item.id, item);
        }
      }
    }
    month.setMonth(month.getMonth() + 1);
  }
  return [...events.values()];
}
