// agenda.js – Moodlen määräajat ja omat merkinnät yhtenä listana.
//
// Käyttävät Tänään-sivu (seuraava määräaika, pikkukalenteri, Muut) ja Kalenteri.
// Jokainen merkintä:
//   { id, source: "moodle" | "own", type: "deadline" | "other", time (ms), allDay, title,
//     course, courseName, color (1–7 tai "own"), filterKey, url, note, entry, done }
//   done = Moodlen palautustehtävä on palautettu (näkyy Kalenterissa yliviivattuna, ei Tänään-sivulla)
// "Muu merkintä" (type "other") näkyy vain Kalenterissa, ei Tänään-sivulla.
// Moodlen "avautuu"-tapahtuma (esim. tentti avautuu) ei ole määräaika, joten sekin on tyyppiä "other".

import { parseMoodleCourseName } from "./rules.js";
import { isMoodleDeadline } from "./moodle.js";
import { colorForCourse } from "./colors.js";

const DAY = 86400 * 1000;

// "2026-11-12" paikallisena päivänä
export function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

// Oman merkinnän aika: kellonaika tai päivän loppu, jos aikaa ei annettu
export function entryTime(entry) {
  const day = new Date(parseDateKey(entry.date));
  if (entry.time) {
    const [h, m] = entry.time.split(":").map(Number);
    day.setHours(h, m, 0, 0);
  } else {
    day.setHours(23, 59, 59, 0);
  }
  return day.getTime();
}

export function allEvents(data) {
  const list = [];
  for (const d of (data.deadlines && data.deadlines.items) || []) {
    const course = data.courses.find(c => c.moodleId === d.moodleId) || null;
    const opens = !isMoodleDeadline(d);
    list.push({
      // Tapahtuman oma tunnus: samalla tehtävällä voi olla kaksi tapahtumaa (avautuu ja sulkeutuu)
      id: `m${d.id}`, source: "moodle", type: opens ? "other" : "deadline", time: d.time, allDay: false,
      title: opens ? `${d.name} avautuu` : d.name, course,
      courseName: course ? course.name : parseMoodleCourseName(d.courseTitle || "").name,
      color: colorForCourse(data, course, d.moodleId),
      filterKey: course ? course.id : `m${d.moodleId}`,
      url: d.url, note: "", entry: null, done: !opens && Boolean(d.submitted)
    });
  }
  for (const e of data.ownEntries || []) {
    const course = e.courseId ? data.courses.find(c => c.id === e.courseId) || null : null;
    list.push({
      id: e.id, source: "own", type: e.type === "other" ? "other" : "deadline", time: entryTime(e), allDay: !e.time,
      title: e.title, course, courseName: course ? course.name : "",
      color: course ? colorForCourse(data, course) : "own",
      filterKey: course ? course.id : null,
      url: "", note: e.note || "", entry: e, done: false
    });
  }
  return list.sort((a, b) => a.time - b.time);
}

// Tulevat määräajat (myös eilen menneet, jotta myöhästynyt näkyy vielä). Palautetut vain, jos includeDone.
export function upcomingEvents(data, now = Date.now(), includeDone = false) {
  return allEvents(data).filter(e => e.type === "deadline" && e.time >= now - DAY && (includeDone || !e.done));
}

// "Kurssi: Tehtävä" tai pelkkä otsikko, jos kurssia ei ole
export function eventLabel(e) {
  return e.courseName ? `${e.courseName}: ${e.title}` : e.title;
}
