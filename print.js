// print.js – siisti tulostusversio nettisivusta (ponnahdusikkunan "Siisti tulostusversio").
// Teksti tulee clip.js:ltä istunnon muistin kautta (chrome.storage.session, häviää selaimen sulkeutuessa).
// HTML on clip.js:n siivoamaa: vain sallitut elementit ja attribuutit. Lisäksi lisäosan sivujen
// tietoturvakäytäntö estää kaikki sivun mukana tulleet skriptit.

const page = document.getElementById("page");
const { printClip: clip } = await chrome.storage.session.get("printClip");

if (!clip || !clip.html) {
  page.className = "empty";
  page.textContent = "Tulostettavaa sivua ei löytynyt. Avaa sivu uudelleen ja paina Kurssikaverin ponnahdusikkunassa Siisti tulostusversio.";
} else {
  let host = "";
  try { host = new URL(clip.url).hostname.replace(/^www\./, ""); } catch (e) { /* ei osoite */ }
  const day = new Date(clip.time);
  document.title = clip.title || host || "Tulostusversio";

  const h1 = document.createElement("h1");
  h1.textContent = clip.title || host;
  const src = document.createElement("p");
  src.className = "src";
  src.append(`Lähde: ${clip.url} · ${day.getDate()}.${day.getMonth() + 1}.${day.getFullYear()}${clip.selection ? " · valittu osa sivusta" : ""}`);
  const article = document.createElement("article");
  article.innerHTML = clip.html;
  // Sama otsikko kahteen kertaan (sivun oma h1 + yläotsikko) → sivun oma pois
  const first = article.querySelector("h1");
  if (first && first.textContent.trim() === h1.textContent.trim()) first.remove();
  page.append(h1, src, article);

  // Tulostusikkuna aukeaa, kun kuvat ovat latautuneet (enintään 3 s odotus)
  const images = Array.from(article.querySelectorAll("img")).filter(img => !img.complete);
  await Promise.race([
    Promise.all(images.map(img => new Promise(done => { img.onload = img.onerror = done; }))),
    new Promise(done => setTimeout(done, 3000))
  ]);
  window.print();
}

document.getElementById("print").addEventListener("click", () => window.print());
