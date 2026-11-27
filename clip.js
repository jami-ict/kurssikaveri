// clip.js – nettisivun tekstin poiminta Markdowniksi (Kurssikaverin oma kevytversio, ei kirjastoja).
//
// Ajetaan avoimeen välilehteen vain, kun käyttäjä painaa ponnahdusikkunassa "Tallenna linkki" (teksti mukana)
// tai "Siisti tulostusversio" (popup.js: chrome.scripting.executeScript, oikeus activeTab).
// Ei muuta sivua eikä lähetä mitään minnekään: palauttaa tuloksen ponnahdusikkunalle.
//
// Kaksi vaihetta, omina funktioinaan, jotta ne voi myöhemmin vaihtaa esim. Readabilityyn ja Turndowniin:
//   1. findContent()  mikä sivulla on varsinaista sisältöä
//        a) käyttäjän maalaama teksti, jos sitä on (ei, kun ponnahdusikkuna pyytää koko sivun)
//        b) sivun omat merkinnät (<article>, <main>, role="main", yleiset nimet kuten #content)
//        c) muuten se osa, jossa on eniten kappaletekstiä ja vähiten linkkejä
//   2. toMarkdown()   sisältö Markdowniksi; sama läpikäynti tekee myös siistin HTML:n tulostusversiota varten
//      (vain sallitut elementit ja attribuutit, ei skriptejä eikä tyylejä)
//
// Palauttaa { title, url, selection, markdown, html, chars } tai { error }.

(() => {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED",
    "FORM", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "NAV", "ASIDE", "FOOTER", "DIALOG", "VIDEO", "AUDIO", "MAP"]);
  const SKIP_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary", "search", "dialog", "menu", "menubar", "toolbar"]);
  // Nimet, jotka viittaavat muuhun kuin sisältöön (sanana, esim. "share-buttons", "cookie_banner")
  const NOISE = /(^|[\s_-])(cookies?|consent|gdpr|banner|share|sharing|social|related|recommended|newsletter|subscribe|comments?|sidebar|advert|ads?|promo|breadcrumbs?|skip|popup|modal|toolbar|pagination|signup)([\s_-]|$)/i;
  const MAIN_SELECTORS = ["article", "main", "[role='main']", "#mw-content-text", ".markdown-body", ".entry-content",
    ".post-content", ".article-body", ".article-content", "#content", "#main", ".content"];

  const text = el => (el.textContent || "").replace(/\s+/g, " ").trim();
  const linkText = el => Array.from(el.querySelectorAll("a")).reduce((sum, a) => sum + text(a).length, 0);

  function absolute(url) {
    if (!url) return "";
    try { return new URL(url, document.baseURI).href; } catch (e) { return ""; }
  }

  // ---------- 1. Sisällön etsiminen ----------

  function selectedContent() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 20) return null;
    const box = document.createElement("div");
    for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
    return box;
  }

  // Ponnahdusikkuna tallentaa aina koko sivun: se asettaa ennen tätä skriptiä merkin __kurssikaveriWholePage.
  // Maalattu osa tallennetaan hiiren oikean painikkeen valikosta (background.js, ilman merkkiä).
  function findContent() {
    const wholePage = window.__kurssikaveriWholePage === true;
    delete window.__kurssikaveriWholePage;
    const selected = wholePage ? null : selectedContent();
    if (selected) return { root: selected, selection: true, live: false };

    // Sivun omat merkinnät: ensimmäinen valitsin, jonka suurimmassa osassa on riittävästi tekstiä
    for (const selector of MAIN_SELECTORS) {
      let best = null, bestLen = 0;
      for (const el of document.querySelectorAll(selector)) {
        const len = text(el).length;
        if (len > bestLen) { best = el; bestLen = len; }
      }
      if (best && bestLen >= 400 && linkText(best) / bestLen < 0.5) return { root: best, selection: false, live: true };
    }

    // Pisteytys: kappaleiden teksti vanhemmalle (täysi) ja isovanhemmalle (puolet), linkkien osuus vähentää
    const scores = new Map();
    for (const p of document.querySelectorAll("p, pre, li, td, blockquote")) {
      const len = text(p).length;
      if (len < 25) continue;
      const add = (el, amount) => { if (el && el !== document.body) scores.set(el, (scores.get(el) || 0) + amount); };
      add(p.parentElement, len);
      add(p.parentElement && p.parentElement.parentElement, len / 2);
    }
    let best = null, bestScore = 0;
    for (const [el, score] of scores) {
      const len = text(el).length || 1;
      const adjusted = score * (1 - Math.min(linkText(el) / len, 1));
      if (adjusted > bestScore) { best = el; bestScore = adjusted; }
    }
    return { root: best || document.body, selection: false, live: true };
  }

  function pageTitle() {
    const og = document.querySelector("meta[property='og:title']");
    const h1 = document.querySelector("h1");
    return ((og && og.content) || (h1 && text(h1)) || document.title || "").replace(/\s+/g, " ").trim();
  }

  // ---------- 2. Muunnos ----------

  function skip(el, ctx) {
    if (el === ctx.root) return false;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.tagName === "HEADER" && !el.querySelector("h1")) return true;
    if (el.getAttribute("aria-hidden") === "true" || el.hidden) return true;
    if (SKIP_ROLES.has(el.getAttribute("role"))) return true;
    const names = `${el.id || ""} ${el.getAttribute("class") || ""}`;
    if (names.trim() && NOISE.test(names) && !el.querySelector("h1")) return true;
    if (ctx.live && el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return true;
    return false;
  }

  const escapeMd = s => s.replace(/([\\`*_[\]])/g, "\\$1");
  const oneLine = s => s.replace(/\s*\n+\s*/g, " ").trim();
  const tidy = s => s.replace(/[ \t]+\n/g, m => (m.startsWith("  ") ? "  \n" : "\n")).replace(/\n{3,}/g, "\n\n");
  const mdUrl = url => url.replace(/[\s()<>]/g, ch => encodeURIComponent(ch).replace("(", "%28").replace(")", "%29"));

  function imageSource(img) {
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    const fromSet = srcset.split(",").map(s => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
    return absolute(img.getAttribute("data-src") || img.getAttribute("src") || fromSet);
  }

  // Markdown. ctx = { root, live, pre }
  function md(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) return ctx.pre ? node.nodeValue : escapeMd(node.nodeValue.replace(/\s+/g, " "));
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    if (skip(el, ctx)) return "";
    const kids = (c = ctx) => Array.from(el.childNodes).map(n => md(n, c)).join("");
    const tag = el.tagName;

    if (/^H[1-6]$/.test(tag)) { const t = oneLine(kids()); return t ? `\n\n${"#".repeat(Number(tag[1]))} ${t}\n\n` : ""; }
    switch (tag) {
      case "BR": return "  \n";
      case "HR": return "\n\n---\n\n";
      case "STRONG": case "B": { const t = kids().trim(); return t ? `**${t}**` : ""; }
      case "EM": case "I": { const t = kids().trim(); return t ? `*${t}*` : ""; }
      case "DEL": case "S": { const t = kids().trim(); return t ? `~~${t}~~` : ""; }
      case "CODE": {
        if (ctx.pre) return el.textContent;
        const t = el.textContent.replace(/\s+/g, " ");
        const fence = t.includes("`") ? "``" : "`";
        return t.trim() ? `${fence}${t}${fence}` : "";
      }
      case "PRE": {
        const code = el.querySelector("code");
        const lang = ((code && code.className) || el.className || "").match(/(?:language|lang)-([\w+-]+)/);
        const t = el.textContent.replace(/\n+$/, "");
        return t.trim() ? `\n\n\`\`\`${lang ? lang[1] : ""}\n${t}\n\`\`\`\n\n` : "";
      }
      case "A": {
        const t = oneLine(kids());
        const href = absolute(el.getAttribute("href"));
        if (!t) return "";
        return /^(https?:|mailto:)/i.test(href) && !href.startsWith(location.href.split("#")[0] + "#") ? `[${t}](${mdUrl(href)})` : t;
      }
      case "IMG": {
        const src = imageSource(el);
        if (!/^https?:/i.test(src)) return "";
        const alt = (el.getAttribute("alt") || "").replace(/[[\]\n]/g, " ").trim();
        return `![${alt}](${mdUrl(src)})`;
      }
      case "UL": case "OL": return list(el, ctx);
      case "BLOCKQUOTE": {
        const t = tidy(kids()).trim();
        return t ? `\n\n${t.split("\n").map(line => (line ? `> ${line}` : ">")).join("\n")}\n\n` : "";
      }
      case "TABLE": return table(el, ctx);
      case "DT": { const t = oneLine(kids()); return t ? `\n\n**${t}**\n` : ""; }
      case "DD": { const t = tidy(kids()).trim(); return t ? `\n${t}\n` : ""; }
      case "FIGCAPTION": { const t = oneLine(kids()); return t ? `\n\n*${t}*\n\n` : ""; }
      case "P": case "DIV": case "SECTION": case "ARTICLE": case "MAIN": case "HEADER": case "FIGURE": case "DETAILS": case "SUMMARY":
      case "DL": case "ADDRESS":
        { const t = kids().trim(); return t ? `\n\n${t}\n\n` : ""; }
      default: return kids();
    }
  }

  function list(el, ctx) {
    const ordered = el.tagName === "OL";
    let n = Number(el.getAttribute("start")) || 1;
    const items = [];
    for (const li of el.children) {
      if (li.tagName !== "LI" || skip(li, ctx)) continue;
      const marker = ordered ? `${n++}.` : "-";
      // Sisäkkäinen lista heti tekstin alle ilman tyhjää riviä
      const inner = tidy(Array.from(li.childNodes).map(c => md(c, ctx)).join("")).trim().replace(/\n\n(?=(?:-|\d+\.) )/g, "\n");
      if (!inner) continue;
      const pad = " ".repeat(marker.length + 1);
      const [first, ...rest] = inner.split("\n");
      items.push(`${marker} ${first}${rest.map(line => (line ? `\n${pad}${line}` : "\n")).join("")}`);
    }
    return items.length ? `\n\n${items.join("\n")}\n\n` : "";
  }

  function table(el, ctx) {
    const rows = Array.from(el.rows || []).filter(r => !skip(r, ctx));
    if (rows.length === 0) return "";
    const cellText = cell => oneLine(tidy(Array.from(cell.childNodes).map(n => md(n, ctx)).join(""))).replace(/\|/g, "\\|");
    // Yhdistetyt solut tai sisäkkäinen taulukko: tekstinä rivi kerrallaan
    if (el.querySelector("[colspan]:not([colspan='1']), [rowspan]:not([rowspan='1']), table")) {
      return `\n\n${rows.map(r => Array.from(r.cells).map(cellText).filter(Boolean).join(" · ")).filter(Boolean).join("\n\n")}\n\n`;
    }
    const cells = rows.map(r => Array.from(r.cells).map(cellText));
    const width = Math.max(...cells.map(r => r.length));
    if (width === 0) return "";
    const pad = r => [...r, ...Array(width - r.length).fill("")];
    const lines = [pad(cells[0]), Array(width).fill("---"), ...cells.slice(1).map(pad)];
    return `\n\n${lines.map(r => `| ${r.join(" | ")} |`).join("\n")}\n\n`;
  }

  // Siisti HTML tulostusversiota varten: vain sallitut elementit ja attribuutit, muut puretaan (sisältö säilyy)
  const ALLOWED = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "UL", "OL", "LI", "A", "STRONG", "B", "EM", "I", "DEL", "S",
    "CODE", "PRE", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "CAPTION", "IMG", "BR", "HR",
    "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "SUP", "SUB"]);

  function cleanHtml(node, ctx, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { out.appendChild(document.createTextNode(child.nodeValue)); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE || skip(child, ctx)) continue;
      if (!ALLOWED.has(child.tagName)) { cleanHtml(child, ctx, out); continue; }
      const copy = document.createElement(child.tagName);
      if (child.tagName === "A") {
        const href = absolute(child.getAttribute("href"));
        if (/^(https?:|mailto:)/i.test(href)) copy.setAttribute("href", href);
      } else if (child.tagName === "IMG") {
        const src = imageSource(child);
        if (!/^https?:/i.test(src)) continue;
        copy.setAttribute("src", src);
        copy.setAttribute("alt", child.getAttribute("alt") || "");
      } else if (child.tagName === "TD" || child.tagName === "TH") {
        for (const name of ["colspan", "rowspan"]) if (child.getAttribute(name)) copy.setAttribute(name, String(Number(child.getAttribute(name)) || 1));
      } else if (child.tagName === "OL" && child.getAttribute("start")) {
        copy.setAttribute("start", String(Number(child.getAttribute("start")) || 1));
      }
      cleanHtml(child, ctx, copy);
      out.appendChild(copy);
    }
    return out;
  }

  function toMarkdown(found) {
    const ctx = { root: found.root, live: found.live, pre: false }; // <pre>-lohkot luetaan textContentina sellaisenaan
    const raw = md(found.root, ctx);
    const markdown = tidy(raw).replace(/^\s+|\s+$/g, "") + "\n";
    const box = cleanHtml(found.root.nodeType === Node.ELEMENT_NODE ? found.root : document.body, ctx, document.createElement("div"));
    return { markdown, html: box.innerHTML };
  }

  try {
    const found = findContent();
    const { markdown, html } = toMarkdown(found);
    const chars = markdown.replace(/\s+/g, "").length;
    if (chars < 20) return { error: "Sivulta ei löytynyt tallennettavaa tekstiä. Maalaa haluamasi kohta ja yritä uudelleen." };
    return { title: pageTitle(), url: location.href, selection: found.selection, markdown: markdown.slice(0, 500000), html: html.slice(0, 1500000), chars };
  } catch (error) {
    return { error: `Tekstin poiminta epäonnistui: ${error.message}` };
  }
})();
