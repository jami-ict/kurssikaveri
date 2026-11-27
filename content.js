// content.js – ajetaan Moodlen sivuilla.
//
// 1. Tulkitsee kurssisivun: välilehdet, väliotsikot (label), aktiviteetit, kansiot ja upotetut videot.
// 2. Kertoo sisällön taustaskriptille → kirjaston Linkit-osio ja kurssin Sisalto.md.
// 3. Lisää sivulle Kurssikaveri-palkin ja Tallenna-painikkeet tiedostojen ja kansioiden viereen.
// 4. Selvittää linkkien kohdeosoitteet ja tiedostojen latausosoitteet.
// 5. Merkitsee sivulle uudet kohteet ("Uusi") ja tehtävien määräajat.
//
// Rakenne on tehty SAMKin Moodlen (välilehtimuotoinen "onetopic"-kurssisivu) mukaan.
// Värit ladataan yhteisestä värimoduulista kurssisivulla.

(() => {
  const DEFAULT_MOODLE = "https://moodle5.samk.fi";
  const logoUrl = chrome.runtime.getURL("icons/kurssikaveri-merkki-valkoinen.svg");
  const reloadNote = "Kurssikaverin yhteys katkesi. Lataa Moodle-sivu uudelleen.";
  let disconnected = false;
  let base = DEFAULT_MOODLE;
  let settings = {};
  let current = null;     // tämän sivun tulkinta
  let status = null;      // taustaskriptin vastaus: onko kurssi Kurssikaverissa, mitkä tiedostot tallennettu
  const busy = new Map(); // tallennus kesken: avain → tilateksti
  let texts = null;       // palkin tilaviestit (shared/barState.js), ladataan käynnistyksessä

  // ---------- Apufunktiot ----------

  const text = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

  // Moodle (ainakin välilehtien title ja data-activityname) voi koodata &-merkin attribuuttiin kahdesti:
  // selain purkaa siitä vain toisen kerran, ja nimeen jää "&amp;". Puretaan jäljelle jäänyt koodaus.
  // DOMParserin dokumentti on eristetty: se ei aja skriptejä eikä lataa mitään, ja siitä luetaan vain teksti.
  function decodeEntities(value) {
    const str = String(value || "");
    if (!/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/i.test(str)) return str;
    return (new DOMParser().parseFromString(str, "text/html").documentElement.textContent || "").trim();
  }
  const attr = (el, name) => decodeEntities(el.getAttribute(name) || "");

  // Laajennuksen päivitys voi jättää vanhan sisältöskriptin auki olevalle kurssisivulle.
  function connected() {
    if (disconnected) return false;
    if (chrome.runtime?.id) return true;
    disconnected = true;
    const bar = document.getElementById("studyhub-bar");
    if (bar) {
      bar.className = "studyhub-bar studyhub-neutral";
      bar.innerHTML = barShell(reloadNote);
    }
    for (const el of document.querySelectorAll(".studyhub-control, .studyhub-marks")) el.remove();
    return false;
  }

  function send(message) {
    return new Promise(resolve => {
      if (!connected()) { resolve({ ok: false, error: reloadNote }); return; }
      try {
        chrome.runtime.sendMessage(message, response => {
          if (!connected()) { resolve({ ok: false, error: reloadNote }); return; }
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(response || { ok: false, error: "Ei vastausta" });
        });
      } catch (error) {
        resolve({ ok: false, error: "Lisäosa on päivitetty – lataa sivu uudelleen." });
      }
    });
  }

  function escapeHtml(value) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(value ?? "").replace(/[&<>"']/g, ch => map[ch]);
  }

  // Sama avain kuin shared/contents.js:n fileKey
  const fileKey = (cmid, subpath = "", name = "") => (name ? `${cmid}:${subpath}${name}` : String(cmid));

  function courseIdOf(doc) {
    const match = doc.body && doc.body.className.match(/\bcourse-(\d+)\b/);
    return match && match[1] !== "1" ? Number(match[1]) : null;
  }

  function courseTitleOf(doc) {
    const heading = doc.querySelector(".page-header-headings h1, #page-header h1");
    if (heading) return text(heading);
    // <title>Topic: Aihe | Esimerkkikurssi XY220201-3008 | Moodle5</title>
    const parts = doc.title.split("|").map(s => s.trim());
    return (parts.length >= 3 ? parts[parts.length - 2] : parts[0]).replace(/^Course:\s*/, "");
  }

  // Välilehdet (onetopic-muoto): [{ name, url, active, closed, dimmed }]
  // closed: opiskelijalta suljettu välilehti (Moodle: li.disabled, esim. "Piilotettu opiskelijoilta"). Sitä ei voi
  // avata eikä kerätä, joten se jätetään kokonaan pois. Kun opettaja avaa välilehden, disabled poistuu.
  // dimmed: himmennetty välilehti (esim. aukeaa myöhemmin tai opettajalle piilotettu). Se yritetään lukea, mutta
  // Moodle ei välttämättä näytä sen sisältöä, joten se ei saa pitää kurssia "tarkistamattomana" (dimTabs).
  function tabsOf(doc) {
    return [...doc.querySelectorAll(".format_onetopic-tabs a.nav-link")].map(a => ({
      name: (attr(a, "title") || text(a)).trim(),
      url: new URL(a.getAttribute("href") || "", location.href).href.split("#")[0],
      active: a.classList.contains("active"),
      closed: a.classList.contains("disabled") || Boolean(a.closest("li.disabled")),
      dimmed: a.classList.contains("dimmed") || Boolean(a.closest("li.dimmed"))
    })).filter(tab => tab.name);
  }

  function iconOf(li) {
    const img = li.querySelector("img.activityicon, .activityiconcontainer img");
    const match = img && (img.getAttribute("src") || "").match(/\/f\/([a-z0-9_-]+)/i);
    return match ? match[1].toLowerCase() : "";
  }

  function durationOf(name) {
    const match = String(name).match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    return match ? match[1] : "";
  }

  function kindOf(modtype, icon, name) { // sama sääntö kuin shared/contents.js
    if (modtype === "url") return "link";
    if (modtype === "resource") return icon === "video" || icon === "mpeg" ? "video" : "file";
    if (modtype === "lti") return /\d{1,2}:\d{2}/.test(name) ? "video" : "tool";
    if (modtype === "folder") return "folder";
    if (modtype === "assign") return "assignment";
    if (modtype === "page" || modtype === "book") return "page";
    return "activity";
  }

  // ---------- Videot ----------

  // Palvelu videon osoitteesta. YouTube-osoitteet yhtenäistetään muotoon youtube.com/watch?v=…
  function describeVideo(url) {
    const youtube = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
    if (youtube) return { service: "YouTube", url: `https://www.youtube.com/watch?v=${youtube[1]}` };
    if (/vimeo\.com/.test(url)) return { service: "Vimeo", url };
    if (url.startsWith(base) && /pluginfile\.php/.test(url)) return { service: "Moodle-video", url };
    return { service: "Video", url };
  }

  // Tekstilohkoihin ja kuvauksiin upotetut videot (YouTube-upotus, Moodlen videosoitin)
  function embeddedVideos(container) {
    const found = new Map();
    container.querySelectorAll("iframe[src], a.mediafallbacklink[href], video[src], video source[src], [data-setup-lazy], [data-setup]").forEach(el => {
      let url = el.getAttribute("src") || el.getAttribute("href") || "";
      const setup = el.getAttribute("data-setup-lazy") || el.getAttribute("data-setup");
      if (setup) {
        try {
          const parsed = JSON.parse(setup);
          const source = Array.isArray(parsed.sources) ? parsed.sources[0] : parsed.sources;
          if (source && source.src) url = source.src;
        } catch (e) { /* ei JSON-muotoa */ }
      }
      if (!url) return;
      try { url = new URL(url, location.href).href; } catch (e) { return; }
      if (el.tagName === "IFRAME" && !/youtu|vimeo|video|player|stream|panopto|kaltura/i.test(url)) return; // muut upotukset ohitetaan
      const video = describeVideo(url);
      if (!found.has(video.url)) found.set(video.url, { ...video, title: attr(el, "title") });
    });
    return [...found.values()];
  }

  // ---------- Kansiot ----------

  // Kansiopuun tiedostot: pluginfile.php/…/mod_folder/content/0/alikansio/tiedosto.png
  function folderFiles(container) {
    const files = new Map();
    container.querySelectorAll("a[href*='/mod_folder/content/']").forEach(a => {
      const href = new URL(a.getAttribute("href"), location.href);
      const match = href.pathname.match(/\/mod_folder\/content\/\d+\/(.+)$/);
      if (!match) return;
      const parts = match[1].split("/").map(p => decodeURIComponent(p));
      const name = parts.pop();
      const subpath = parts.length ? parts.join("/") + "/" : "";
      href.search = "";
      href.searchParams.set("forcedownload", "1"); // ladataan aina, ei avata selaimeen
      files.set(href.href, { name, subpath, url: href.href });
    });
    return [...files.values()];
  }

  // ---------- 1. Sivun tulkinta ----------

  const SECTION_SELECTOR = "li.section[data-for='section'], li.section.course-section, li.section.main";

  // Osion oma otsikko, ei sen sisällä olevan aliosion otsikko
  function ownTitle(sectionEl) {
    return [...sectionEl.querySelectorAll(".sectionname, [data-for='section_title'] h3")]
      .find(title => title.closest(SECTION_SELECTOR) === sectionEl) || null;
  }

  function parsePage(doc) {
    const allTabs = tabsOf(doc);                  // järjestysnumerot lasketaan kaikista, myös suljetuista
    const tabs = allTabs.filter(t => !t.closed);  // luettavat välilehdet
    const activeTab = tabs.find(t => t.active);
    // Aliosiot (Moodle 4.5: osio aktiviteettina toisen osion sisällä) kuuluvat ylemmän osion välilehteen.
    // Niistä ei tehdä omia osioita: muuten samanniminen aliosio kahdella välilehdellä ("Luentovideot")
    // kirjoittaisi toisen välilehden sisällön yli. Aliosion nimi on sen kohteiden väliotsikko.
    const allSectionEls = [...new Set(doc.querySelectorAll(SECTION_SELECTOR))];
    const sectionEls = allSectionEls.filter(el => !el.parentElement || !el.parentElement.closest(SECTION_SELECTOR));
    const sections = [];

    sectionEls.forEach((el, index) => {
      const number = Number(el.getAttribute("data-number") ?? index);
      let name = text(ownTitle(el));
      const onlyTab = sectionEls.length === 1 && activeTab;
      if (!name && onlyTab) name = activeTab.name;
      if (!name) name = number === 0 ? "Yleistä" : `Osio ${number}`;
      const order = onlyTab ? allTabs.indexOf(activeTab) : number;

      const items = [];
      let label = null; // viimeisin väliotsikko
      let subsection = el; // osio, jonka sisällä edellinen kohde oli
      el.querySelectorAll("li.activity").forEach(li => {
        const modtype = (li.className.match(/modtype_(\w+)/) || [])[1] || "";
        if (modtype === "subsection") return; // aliosion kohteet luetaan sen sisältä
        const inSection = li.closest(SECTION_SELECTOR) || el;
        if (inSection !== subsection) {
          subsection = inSection;
          label = inSection === el ? null : (text(ownTitle(inSection)) || null);
        }
        const cmid = Number(li.getAttribute("data-id") || (li.id.match(/module-(\d+)/) || [])[1]);
        const card = li.querySelector("[data-activityname]");
        const name = ((card ? attr(card, "data-activityname") : text(li.querySelector(".instancename"))) || "").trim();
        if (!cmid) return;

        if (modtype === "label") {
          const content = li.querySelector(".activity-altcontent") || li;
          const heading = text(content.querySelector("h1, h2, h3, h4, h5, strong, p")) || text(content) || name;
          label = heading.slice(0, 80);
          embeddedVideos(content).forEach((video, i) => items.push({
            cmid, key: `${cmid}#v${i}`, modtype: "video", kind: "video", embedded: true,
            name: video.title || (i ? `${label} (video ${i + 1})` : label), service: video.service,
            duration: "", target: video.url, moodleUrl: video.url, label, description: ""
          }));
          return;
        }

        const isFolder = modtype === "folder";
        if (!isFolder && !li.querySelector("a[href*='/mod/']")) return;
        const icon = iconOf(li);
        const kind = kindOf(modtype, icon, name);
        const description = li.querySelector(".activity-description");
        const item = {
          cmid, key: String(cmid), modtype, icon, kind, name, label,
          description: text(description).slice(0, 400),
          moodleUrl: `${base}/mod/${modtype}/view.php?id=${cmid}`
        };
        if (kind === "video") {
          item.duration = durationOf(name);
          item.service = modtype === "lti" ? "Moodlen videopalvelu" : "Moodle-video";
        }
        if (isFolder) {
          // Kansiopuu näkyy suoraan sivulla, tai kansio aukeaa omalle sivulleen (haetaan tallennettaessa)
          item.files = li.querySelector(".foldertree, .filemanager") ? folderFiles(li) : null;
        }
        items.push(item);
        if (description) {
          embeddedVideos(description).forEach((video, i) => items.push({
            cmid, key: `${cmid}#v${i}`, modtype: "video", kind: "video", embedded: true,
            name: video.title || `${name} (video)`, service: video.service, duration: "",
            target: video.url, moodleUrl: video.url, label, description: ""
          }));
        }
      });
      sections.push({ name, order, items });
    });

    return {
      moodleId: courseIdOf(doc),
      title: courseTitleOf(doc),
      tabs: tabs.map(t => t.name),
      dimTabs: tabs.filter(t => t.dimmed).map(t => t.name),
      tabUrls: tabs,
      activeSection: activeTab ? activeTab.name : (sections.length === 1 ? sections[0].name : null),
      activeOrder: activeTab ? allTabs.indexOf(activeTab) : (sections.length === 1 ? sections[0].order : null),
      sections
    };
  }

  // ---------- 2. Osoitteiden selvitys ----------

  // Tiedoston todellinen osoite: Moodle ohjaa view.php?id=…&redirect=1 → pluginfile.php/…
  // forcedownload=1 pakottaa latauksen, vaikka selain osaisi näyttää tiedoston (PDF).
  async function resolveFileUrl(cmid) {
    const viewUrl = `${base}/mod/resource/view.php?id=${cmid}&redirect=1`;
    let url = null;
    try {
      const head = await fetch(viewUrl, { method: "HEAD", credentials: "include" });
      if (/pluginfile\.php/.test(head.url)) url = head.url;
    } catch (e) { /* kokeillaan alla */ }
    if (!url) {
      const page = await fetch(`${base}/mod/resource/view.php?id=${cmid}`, { credentials: "include" });
      if (/pluginfile\.php/.test(page.url)) url = page.url;
      else {
        const match = (await page.text()).match(/https?:[^"'\s<>]*pluginfile\.php[^"'\s<>]+/);
        if (match) url = match[0].replace(/&amp;/g, "&");
      }
    }
    if (!url) throw new Error("Tiedoston osoitetta ei löytynyt.");
    const parsed = new URL(url);
    parsed.searchParams.set("forcedownload", "1");
    return parsed.href;
  }

  // Linkin kohde: Moodlen linkkisivulla (ilman redirect-parametria) on linkki kohteeseen
  async function resolveLinkTarget(cmid) {
    const response = await fetch(`${base}/mod/url/view.php?id=${cmid}`, { credentials: "include" });
    if (!response.url.startsWith(base)) return response.url;
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const link = doc.querySelector(".urlworkaround a[href], #region-main .resourcecontent iframe[src], #region-main object[data]");
    if (!link) return null;
    const target = link.getAttribute("href") || link.getAttribute("src") || link.getAttribute("data");
    return target && /^https?:/.test(target) && !target.startsWith(base) ? target : null;
  }

  async function resolveMissingTargets(moodleId, cmids) {
    const targets = {};
    for (const cmid of cmids.slice(0, 25)) { // enintään 25 kerralla, ettei Moodlea kuormiteta
      try {
        const target = await resolveLinkTarget(cmid);
        if (target) targets[cmid] = target;
      } catch (e) { /* jätetään Moodle-osoitteen varaan */ }
    }
    if (Object.keys(targets).length > 0) await send({ action: "linkTargets", moodleId, targets });
  }

  // Omalle sivulleen aukeavien kansioiden sisältö haetaan uudelleen enintään 6 tunnin välein,
  // jotta kansioon lisätyt tiedostot huomataan. Hakuaika muistetaan Moodle-sivuston omaan tallennustilaan.
  const FOLDER_REFRESH_MS = 6 * 60 * 60 * 1000;
  async function refreshSeparateFolders() {
    const folders = current.sections.flatMap(s => s.items).filter(i => i.kind === "folder" && !i.files).slice(0, 8);
    let changed = false;
    for (const item of folders) {
      const key = `studyhub-folder-${item.cmid}`;
      let last = 0;
      try { last = Number(localStorage.getItem(key) || 0); } catch (e) { /* ei tallennustilaa */ }
      if (Date.now() - last < FOLDER_REFRESH_MS) continue;
      try {
        await loadFolderFiles(item);
        try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* ei tallennustilaa */ }
        changed = true;
      } catch (e) { /* kansiota ei saatu, yritetään seuraavalla kerralla */ }
    }
    if (changed) await report(current, location.href, true);
  }

  // Kansio, joka aukeaa omalle sivulleen: haetaan sivu ja luetaan kansiopuu
  async function loadFolderFiles(item) {
    if (item.files) return item.files;
    const response = await fetch(`${base}/mod/folder/view.php?id=${item.cmid}`, { credentials: "include" });
    if (/\/login\//.test(response.url) || new URL(response.url).origin !== new URL(base).origin) {
      throw new Error("Moodle pyysi kirjautumista. Kirjaudu Moodleen ja yritä uudelleen.");
    }
    if (!response.ok) throw new Error(`Kansion haku epäonnistui (HTTP ${response.status}).`);
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    if (doc.querySelector('[name="logintoken"], #page-login-index')) {
      throw new Error("Moodle pyysi kirjautumista. Kirjaudu Moodleen ja yritä uudelleen.");
    }
    if (!doc.querySelector(".foldertree")) {
      throw new Error("Kansion tiedostolistaa ei löytynyt. Avaa kansio Moodlessa ja tarkista käyttöoikeus.");
    }
    item.files = folderFiles(doc);
    return item.files;
  }

  // ---------- 3. Raportointi taustaskriptille ----------

  async function report(parsed, url, isCurrent) {
    const response = await send({
      action: "pageContent",
      moodleId: parsed.moodleId,
      title: parsed.title,
      url,
      isCurrent,
      section: parsed.activeSection,
      sectionOrder: parsed.activeOrder,
      tabs: parsed.tabs,
      dimTabs: parsed.dimTabs,
      sections: parsed.sections
    });
    const result = response.ok ? response.result : null;
    if (result && result.missingTargets && result.missingTargets.length) await resolveMissingTargets(parsed.moodleId, result.missingTargets);
    return result;
  }

  // Hakee muut välilehdet taustalla ja tulkitsee ne (sama sivusto, ei erillistä kirjautumista)
  async function collectAllTabs(onProgress) {
    const others = current.tabUrls.filter(t => !t.active);
    let count = 0;
    for (const tab of others) {
      if (!connected()) break;
      onProgress(`Kerätään ${tab.name}…`);
      let response;
      try { response = await fetch(tab.url, { credentials: "include" }); } catch (error) { throw new Error(texts.problemText(null)); }
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      // Kirjautumissivu tai virhevastaus keskeyttää tarkistuksen: muuten tyhjä sivu näyttäisi onnistuneelta tarkistukselta
      const problem = texts.pageProblem(response, doc);
      if (problem) throw new Error(texts.problemText(problem));
      const parsed = parsePage(doc);
      for (const item of parsed.sections.flatMap(s => s.items).filter(i => i.kind === "folder" && !i.files).slice(0, 8)) {
        try { await loadFolderFiles(item); } catch (e) { /* haetaan, kun välilehti avataan */ }
      }
      await report(parsed, tab.url, false);
      count += parsed.sections.reduce((sum, s) => sum + s.items.length, 0);
    }
    return { tabs: others.length, items: count };
  }

  // ---------- 4. Kurssikaveri-palkki ja Tallenna-painikkeet ----------

  // Tallennettavat kohteet: tiedostoaktiviteetit ja kansiot välilehden järjestyksessä
  function savables() {
    return current.sections.flatMap(s => s.items
      .filter(i => i.kind === "file" || i.kind === "folder")
      .map(i => ({ item: i, section: s.name, sectionOrder: s.order })));
  }

  function folderProgress(item) {
    const files = item.files || [];
    const saved = files.filter(f => status.saved[fileKey(item.cmid, f.subpath, f.name)]).length;
    return { total: files.length, saved, known: Boolean(item.files) };
  }

  async function refreshStatus() {
    const response = await send({ action: "pageStatus", moodleId: current.moodleId });
    status = response.ok ? response.result : null;
    render();
  }

  function render() {
    if (!connected() || !status || !texts || settings.moodleButtons === false) return;
    renderBar();
    renderButtons();
    renderMarks();
  }

  // Samat piirrokset kuin shared/icons.js (sisältöskripti ei voi käyttää import-lausetta)
  const ICON_CLOCK = '<svg class="studyhub-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const ICON_CHECK = '<svg class="studyhub-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
  const ICON_DOWNLOAD = '<svg class="studyhub-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>';
  const ICON_REFRESH = '<svg class="studyhub-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/></svg>';
  const ICON_LOCK = '<svg class="studyhub-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const ICON_PLUS = '<svg class="studyhub-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const ICON_NEW = '<svg class="studyhub-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2 5.5L19.5 10.5 14 12.5 12 18l-2-5.5L4.5 10.5 10 8.5z"/></svg>';
  const WEEKDAYS = ["su", "ma", "ti", "ke", "to", "pe", "la"];

  function clock(ms) { const d = new Date(ms); return `${d.getHours()}.${String(d.getMinutes()).padStart(2, "0")}`; }
  function dayText(ms) { const d = new Date(ms); return `${WEEKDAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; }

  // Määräaikamerkki: tavallinen, tänään (huomioväri) tai myöhässä (punainen reunus)
  function deadlineMark(deadline) {
    if (deadline.submitted) return `<span class="studyhub-deadline studyhub-done">${ICON_CHECK} Palautettu</span>`;
    const now = Date.now();
    const today = new Date(deadline.time).toDateString() === new Date(now).toDateString();
    if (deadline.overdue || deadline.time < now) {
      return `<span class="studyhub-deadline studyhub-late">${ICON_CLOCK} Myöhässä · oli ${dayText(deadline.time)}</span>`;
    }
    const when = today ? `tänään klo ${clock(deadline.time)}` : `${dayText(deadline.time)} klo ${clock(deadline.time)}`;
    return `<span class="studyhub-deadline${today ? " studyhub-soon" : ""}">${ICON_CLOCK} ${escapeHtml(deadline.label)} ${when}</span>`;
  }

  // "Uusi"-merkit ja määräajat kohteiden viereen
  function renderMarks() {
    if (!status.mapped) return;
    const fresh = status.fresh || {};
    const deadlines = status.deadlines || {};
    const marks = {};
    for (const item of current.sections.flatMap(s => s.items)) {
      const m = marks[item.cmid] || (marks[item.cmid] = { isNew: false, files: 0, deadline: null });
      const f = fresh[item.key || item.cmid];
      if (f === "item") m.isNew = true;
      else if (f) m.files += f;
      if (deadlines[item.cmid] && !item.embedded) m.deadline = deadlines[item.cmid];
    }
    for (const [cmid, m] of Object.entries(marks)) {
      const li = document.getElementById(`module-${cmid}`);
      if (!li) continue;
      const host = li.querySelector(".activity-item") || li;
      let span = host.querySelector(":scope > .studyhub-marks");
      const html = [
        m.isNew ? `<span class="studyhub-new">Uusi</span>` : "",
        !m.isNew && m.files ? `<span class="studyhub-new">${m.files} uutta tiedostoa</span>` : "",
        m.deadline ? deadlineMark(m.deadline) : ""
      ].join("");
      if (!html) { if (span) span.remove(); continue; }
      if (!span) {
        span = document.createElement("span");
        span.className = "studyhub-marks";
        host.insertBefore(span, host.firstChild);
      }
      if (span.innerHTML !== html) span.innerHTML = html;
    }
  }

  // Sama tumma kieleke ja avoin kansiopinta kuin Asetuksissa ja kurssisivulla.
  function barShell(content) {
    return `
      <span class="studyhub-back" aria-hidden="true"></span>
      <span class="studyhub-tab"><img class="studyhub-logo" src="${logoUrl}" alt="">Kurssikaveri</span>
      <div class="studyhub-front">${content}</div>`;
  }

  function renderBar() {
    if (!connected() || !status) return;
    let bar = document.getElementById("studyhub-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "studyhub-bar";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "Kurssikaveri");
      const anchor = document.querySelector(".course-content") || document.querySelector("#region-main") || document.body.firstElementChild;
      anchor.parentNode.insertBefore(bar, anchor);
      bar.addEventListener("click", onBarClick);
    }
    const message = bar.dataset.message || "";
    if (!status.mapped) {
      bar.className = "studyhub-bar studyhub-neutral";
      bar.innerHTML = barShell(`
        <div class="studyhub-heading-row"><span class="studyhub-course">Tämä kurssi ei ole vielä Kurssikaverissa.</span>
          <button type="button" class="studyhub-btn studyhub-primary" data-sh="add-course">${ICON_PLUS}Lisää kurssi Kurssikaveriin</button></div>
        ${message ? `<span class="studyhub-msg">${escapeHtml(message)}</span>` : ""}`);
      return;
    }

    let total = 0, saved = 0, unknownFolders = 0;
    for (const { item } of savables()) { // tämä välilehti
      if (item.kind === "file") { total++; if (status.saved[fileKey(item.cmid)]) saved++; }
      else if (item.files) { const p = folderProgress(item); total += p.total; saved += p.saved; }
      else unknownFolders++;
    }
    const unsaved = total - saved + unknownFolders;
    const tabs = current.tabUrls.length > 1;
    const freshCount = Object.keys(status.fresh || {}).length;
    const pendingCount = Object.keys(status.pending || {}).length;
    const course = status.course || { unsaved: 0, unknownFolders: 0, total: 0, saved: 0 };
    const courseUnsaved = course.unsaved + course.unknownFolders;
    const busyCourse = course.saving || courseBusy;
    // Kurssin painike vain, jos kurssilla on tallennettavaa muuallakin kuin tällä välilehdellä
    const showCourse = current.tabUrls.length > 1 && courseUnsaved > unsaved;
    const color = status.color || 1;

    // Tiedostojen tilanne koko kurssilta (shared/barState.js). Jos kurssin lukuja ei vielä ole, käytetään tätä välilehteä.
    let progress = "";
    if (pendingCount) {
      progress = `<span class="studyhub-wait">${ICON_LOCK}Tallennus odottaa opintokansion käyttölupaa (${pendingCount} ${pendingCount === 1 ? "tiedosto" : "tiedostoa"})</span>`;
    } else if (busyCourse) {
      progress = `<span class="studyhub-prog">Tallennetaan kurssin tiedostoja…</span>`;
    } else {
      const state = texts.progressState({
        total: course.total || total, saved: course.total ? course.saved : saved,
        downloading: course.downloading || 0, unknownFolders: Math.max(unknownFolders, course.unknownFolders || 0),
        unchecked: Boolean(course.unchecked)
      });
      progress = state.kind === "done" ? `<span class="studyhub-saved">${ICON_CHECK}${state.text}</span>`
        : state.pct !== undefined ? `<span class="studyhub-prog"><span class="studyhub-pbar"><i style="width:${state.pct}%"></i></span>${escapeHtml(state.text)}</span>`
        : `<span class="studyhub-prog">${escapeHtml(state.text)}</span>`;
    }
    const note = texts.checkNote({ reading, lastOk: lastRead(), error: checkError });
    const canRefresh = current.tabUrls.length > 1 && !reading;
    const check = note || canRefresh ? `<div class="studyhub-upd${checkError && !reading ? " studyhub-upd-error" : ""}">
      ${note ? `<span role="status">${escapeHtml(note)}</span>` : ""}${canRefresh
        ? `<button type="button" class="studyhub-btn studyhub-small" data-sh="refresh-course">${ICON_REFRESH}Tarkista sisältö</button>` : ""}</div>` : "";
    const actions = `${pendingCount ? `<button type="button" class="studyhub-btn studyhub-primary" data-sh="open-library">Avaa Kurssikaveri ja anna lupa</button>` : ""}
      ${unsaved > 0 && !pendingCount ? `<button type="button" class="studyhub-btn studyhub-primary" data-sh="save-all">${ICON_DOWNLOAD}${texts.savePageLabel({ unsaved, unknownFolders, tabs })}</button>` : ""}
      ${showCourse && !pendingCount ? `<button type="button" class="studyhub-btn${unsaved > 0 ? "" : " studyhub-primary"}" data-sh="save-course" ${busyCourse ? "disabled" : ""}>${ICON_DOWNLOAD}${busyCourse ? "Tallennetaan…" : texts.saveCourseText(course)}</button>` : ""}`;
    const hasActions = Boolean(pendingCount || unsaved > 0 || showCourse);

    bar.className = `studyhub-bar studyhub-k${color}`;
    bar.innerHTML = barShell(`
      <div class="studyhub-heading-row"><div class="studyhub-course"><span class="studyhub-title"><span class="studyhub-dot"></span>${escapeHtml(status.courseName)}</span>
        <button type="button" class="studyhub-open" data-sh="open-course">Avaa Kurssikaverissa ↗</button></div></div>
      <div class="studyhub-state-row"><div class="studyhub-state-group">${progress}
        ${freshCount ? `<span class="studyhub-tag studyhub-tag-new">${ICON_NEW}${freshCount} uutta kurssilla</span>` : ""}
        ${course.updated ? `<span class="studyhub-tag studyhub-tag-updated">${ICON_REFRESH}${course.updated} ${course.updated === 1 ? "tiedosto" : "tiedostoa"} päivitetty Moodlessa</span>` : ""}
      </div>${hasActions ? "" : check}</div>
      ${hasActions ? `<div class="studyhub-action-row"><div class="studyhub-save-actions">${actions}</div>${check}</div>` : ""}
      ${message ? `<span class="studyhub-msg" role="status">${escapeHtml(message)}</span>` : ""}
      ${failureList()}`);
  }

  function renderButtons() {
    if (!connected() || !status?.mapped) return;
    for (const { item, section, sectionOrder } of savables()) {
      const li = document.getElementById(`module-${item.cmid}`);
      if (!li) continue;
      const host = li.querySelector(".activity-item") || li;
      let control = host.querySelector(":scope > .studyhub-control");
      if (!control) {
        control = document.createElement("span");
        control.className = "studyhub-control";
        host.appendChild(control);
        control.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          if (!connected()) return;
          const target = event.target.closest("[data-sh]");
          if (!target) return;
          if (target.dataset.sh === "save-update") { saveUpdates(item, (target.dataset.ids || "").split(",").filter(Boolean)); return; }
          if (target.dataset.sh !== "save") return;
          if (item.kind === "folder") saveFolder(item, section, sectionOrder);
          else saveResource(item, section, sectionOrder);
        });
      }
      const key = String(item.cmid);
      if (busy.has(key)) { control.innerHTML = `<span class="studyhub-wait">${escapeHtml(busy.get(key))}</span>`; continue; }

      if (item.kind === "file" && status.pending && status.pending[fileKey(item.cmid)]) {
        control.innerHTML = `<span class="studyhub-wait">${ICON_LOCK}Odottaa kansiolupaa</span>`;
      } else if (item.kind === "file" && status.updated && status.updated[fileKey(item.cmid)]) {
        control.innerHTML = `<button type="button" class="studyhub-btn studyhub-small studyhub-primary" data-sh="save-update" data-ids="${escapeHtml(status.updated[fileKey(item.cmid)])}" title="Opettaja on vaihtanut tiedoston. Vanha versio jää talteen.">${ICON_DOWNLOAD}Päivitetty – tallenna uusi versio</button>`;
      } else if (item.kind === "file") {
        control.innerHTML = status.saved[fileKey(item.cmid)]
          ? `<span class="studyhub-saved" title="${escapeHtml(status.saved[fileKey(item.cmid)])}">${ICON_CHECK}Tallennettu</span>`
          : `<button type="button" class="studyhub-btn studyhub-small" data-sh="save">${ICON_DOWNLOAD}Tallenna</button>`;
      } else {
        const p = folderProgress(item);
        const updatedIds = Object.entries(status.updated || {}).filter(([k]) => k.startsWith(`${item.cmid}:`)).map(([, id]) => id);
        if (updatedIds.length) control.innerHTML = `<button type="button" class="studyhub-btn studyhub-small studyhub-primary" data-sh="save-update" data-ids="${escapeHtml(updatedIds.join(","))}" title="Opettaja on vaihtanut kansion tiedostoja. Vanhat versiot jäävät talteen.">${ICON_DOWNLOAD}${updatedIds.length} päivitetty – tallenna uudet versiot</button>`;
        else if (p.known && p.total > 0 && p.saved === p.total) control.innerHTML = `<span class="studyhub-saved">${ICON_CHECK}Kansio tallennettu (${p.total})</span>`;
        else if (p.saved > 0) control.innerHTML = `<button type="button" class="studyhub-btn studyhub-small" data-sh="save">${ICON_DOWNLOAD}Tallenna puuttuvat (${p.total - p.saved})</button>`;
        else control.innerHTML = `<button type="button" class="studyhub-btn studyhub-small" data-sh="save">${ICON_DOWNLOAD}Tallenna kansio${p.known ? ` (${p.total})` : ""}</button>`;
      }
    }
  }

  function setMessage(message, fails = []) {
    failures = fails;
    const bar = document.getElementById("studyhub-bar");
    if (bar) { bar.dataset.message = message; renderBar(); }
  }

  // Tallentamatta jääneet tiedostot palkissa: nimi, paikka kurssilla, syy ja linkki materiaaliin Moodlessa
  let failures = [];
  const MAX_FAILURES = 5;
  function failureList() {
    if (failures.length === 0) return "";
    const rows = failures.slice(0, MAX_FAILURES).map(f => {
      const link = /^https?:\/\//.test(f.url || "") ? ` <a class="studyhub-link" href="${escapeHtml(f.url)}">Avaa Moodlessa</a>` : "";
      return `<li><b>${escapeHtml(f.name)}</b>${f.where ? ` · ${escapeHtml(f.where)}` : ""} – ${escapeHtml(f.reason)}.${link}</li>`;
    }).join("");
    const more = failures.length > MAX_FAILURES ? `<li>… ja ${failures.length - MAX_FAILURES} muuta</li>` : "";
    return `<div class="studyhub-fails" role="alert">
      <b>${failures.length} ${failures.length === 1 ? "tiedosto jäi" : "tiedostoa jäi"} tallentamatta:</b>
      <ul>${rows}${more}</ul></div>`;
  }

  async function saveResource(item, section, sectionOrder) {
    const key = String(item.cmid);
    if (busy.has(key)) return;
    busy.set(key, "Tallennetaan…");
    renderButtons();
    try {
      const url = await resolveFileUrl(item.cmid);
      const response = await send({
        action: "saveFile", moodleId: current.moodleId, cmid: item.cmid, fileKey: fileKey(item.cmid),
        name: item.name, section, sectionOrder, url
      });
      if (!response.ok) throw new Error(response.error);
      setMessage("");
    } catch (error) {
      setMessage(`${item.name}: ${error.message}`);
    } finally {
      busy.delete(key);
      await refreshStatus();
    }
  }

  // Päivitettyjen tiedostojen uudet versiot (background.js: saveUpdate)
  async function saveUpdates(item, ids) {
    const key = String(item.cmid);
    if (busy.has(key) || ids.length === 0) return;
    let done = 0;
    try {
      for (const id of ids) {
        busy.set(key, ids.length > 1 ? `Tallennetaan ${done + 1}/${ids.length}…` : "Tallennetaan…");
        renderButtons();
        const response = await send({ action: "saveUpdate", id });
        if (!response.ok) throw new Error(response.error);
        done++;
      }
      setMessage(done === 1 ? `${item.name}: uusi versio tallennettu, vanha jäi talteen.` : `${item.name}: ${done} uutta versiota tallennettu, vanhat jäivät talteen.`);
    } catch (error) {
      setMessage(`${item.name}: ${error.message}`);
    } finally {
      busy.delete(key);
      await refreshStatus();
    }
  }

  async function saveFolder(item, section, sectionOrder) {
    const key = String(item.cmid);
    if (busy.has(key)) return;
    busy.set(key, "Haetaan kansion sisältöä…");
    renderButtons();
    try {
      const files = await loadFolderFiles(item);
      const todo = files.filter(f => !status.saved[fileKey(item.cmid, f.subpath, f.name)]);
      let done = 0;
      for (const file of todo) {
        busy.set(key, `Tallennetaan ${++done}/${todo.length}…`);
        renderButtons();
        const response = await send({
          action: "saveFile", moodleId: current.moodleId, cmid: item.cmid,
          fileKey: fileKey(item.cmid, file.subpath, file.name),
          name: file.name, keepName: true, folder: item.name, subpath: file.subpath,
          section, sectionOrder, url: file.url
        });
        if (!response.ok) throw new Error(`${file.name}: ${response.error}`);
      }
      // Kerrotaan taustalle kansion tiedostot (Sisalto.md)
      await report(current, location.href, true);
      setMessage("");
    } catch (error) {
      setMessage(`${item.name}: ${error.message}`);
    } finally {
      busy.delete(key);
      await refreshStatus();
    }
  }

  async function onBarClick(event) {
    if (!connected()) return;
    const target = event.target.closest("[data-sh]");
    const action = target && target.dataset.sh;
    if (target && target.disabled) return;
    if (!action) return;
    event.preventDefault();
    if (action === "add-course") {
      const response = await send({ action: "addCourseFromPage", moodleId: current.moodleId, title: current.title });
      if (!response.ok) setMessage(response.error);
      await refreshStatus();
    }
    if (action === "save-all") {
      for (const { item, section, sectionOrder } of savables()) {
        if (!connected() || !status) break;
        if (item.kind === "file" && !status.saved[fileKey(item.cmid)]) await saveResource(item, section, sectionOrder);
        if (item.kind === "folder") {
          const p = folderProgress(item);
          if (!p.known || p.saved < p.total) await saveFolder(item, section, sectionOrder);
        }
      }
    }
    if (action === "refresh-course") await readCourse(true);
    if (action === "open-library") await send({ action: "openLibrary" });
    if (action === "open-course") await send({ action: "openLibrary", courseId: status.courseId });
    if (action === "save-course") {
      courseBusy = true;
      renderBar();
      const response = await send({ action: "saveCourseFiles", moodleId: current.moodleId });
      courseBusy = false;
      if (!response.ok) setMessage(response.error);
      else if (response.result.failed.length) setMessage(`Tallennettiin ${response.result.done}/${response.result.total} tiedostoa.`, response.result.failed);
      else setMessage(texts.savedMessage(response.result.done, response.result.total));
      await refreshStatus();
    }
  }

  // ---------- Värimaailma ----------
  let palette;
  const SKIN_VARS = ["--kk-accent", "--kk-on-accent", "--kk-text", "--kk-muted", "--kk-faint", "--kk-bg", "--kk-line",
    "--kk-surface", "--kk-accent-soft", "--kk-accent-ink", "--kk-topbar", "--kk-topbar-ink", "--kk-fold-border",
    "--kk-new-bg", "--kk-new-ink", "--kk-warn", "--kk-warn-soft", "--kk-on-warn"];
  for (let n = 1; n <= 7; n++) SKIN_VARS.push(`--kk-k${n}-bg`, `--kk-k${n}-dot`, `--kk-k${n}-ink`);

  function applySkin() {
    if (!palette) return;
    const vars = palette.moodleVars(palette.getSkin(settings)) || {};
    const style = document.documentElement.style;
    for (const name of SKIN_VARS) {
      const value = vars[name];
      if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) style.setProperty(name, value);
      else style.removeProperty(name);
    }
  }

  // ---------- Käynnistys ----------

  async function start() {
    const stored = await chrome.storage.local.get("settings");
    if (!connected()) return;
    settings = stored.settings || {};
    base = DEFAULT_MOODLE;
    if (!location.href.startsWith(base)) return;

    // Määräajat päivitetään taustalla, jos edellisestä hausta on yli puoli tuntia. Palautustehtävän sivulla heti
    // (enintään minuutin välein), jotta palautettu tehtävä poistuu Kurssikaverin listoilta palautuksen jälkeen.
    send(/\/mod\/assign\//.test(location.pathname) ? { action: "refreshMoodle", maxAge: 60 * 1000 } : { action: "refreshMoodle" });

    const moodleId = courseIdOf(document);
    if (!moodleId) return; // ei kurssisivu
    import(chrome.runtime.getURL("shared/skins.js")).then(module => {
      palette = module;
      applySkin();
    }).catch(() => { /* CSS:n perusvärit toimivat myös päivityksen aikana. */ });
    current = parsePage(document);
    await report(current, location.href, true);
    try { texts = await import(chrome.runtime.getURL("shared/barState.js")); } catch (e) { return; } // lisäosa päivittyi kesken

    if (current.sections.length > 0) await refreshStatus(); // painikkeet vain kurssisivuilla
    if (!connected()) return;

    // Kun tallennus valmistuu, kurssi lisätään tai määräajat päivittyvät, päivitetään palkki ja merkit
    chrome.storage.onChanged.addListener(changes => {
      if (changes.settings) { settings = changes.settings.newValue || {}; applySkin(); }
      if ((changes.downloads || changes.moodleMap || changes.courses || changes.deadlines || changes.courseContent) && current.sections.length > 0) refreshStatus();
    });
    refreshSeparateFolders().catch(() => {});
    readCourse(false).catch(() => {});
  }

  // ---------- Koko kurssin lukeminen ----------
  // Kun kurssin sivu avataan, Kurssikaveri lukee kurssin muut välilehdet taustalla (enintään 4 tunnin välein),
  // jotta kurssin sisältö, uudet materiaalit ja "Tallenna kurssin kaikki tiedostot" kattavat koko kurssin.
  const READ_INTERVAL_MS = 4 * 60 * 60 * 1000;
  let reading = false;
  let courseBusy = false;

  function readKey() { return `studyhub-read-${current.moodleId}`; }
  function lastRead() { try { return Number(localStorage.getItem(readKey()) || 0); } catch (e) { return 0; } }

  // Viimeisimmän tarkistusyrityksen virhe (tyhjä, jos onnistui). Onnistumisaika (lastRead) säilyy virheen yli,
  // eikä epäonnistunut tarkistus poista aiemmin kerättyä sisältöä: välilehti raportoidaan vasta onnistuneen haun jälkeen.
  let checkError = "";

  async function readCourse(force) {
    if (reading || !status || !status.mapped || current.tabUrls.length < 2) return;
    if (!force && Date.now() - lastRead() < READ_INTERVAL_MS) return;
    reading = true;
    setMessage(""); // edellisen toiminnon kuittaus (esim. "Tallennettiin 2 tiedostoa.") pois, piirtää palkin
    try {
      await collectAllTabs(() => {});
      if (!connected()) return;
      checkError = "";
      try { localStorage.setItem(readKey(), String(Date.now())); } catch (e) { /* ei tallennustilaa */ }
    } catch (error) {
      checkError = error.message;
    } finally {
      reading = false;
      renderBar();
    }
  }

  start().catch(error => { if (connected()) throw error; });
})();
