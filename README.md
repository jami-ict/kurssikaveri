# Kurssikaveri

Kurssikaveri on Chrome-lisäosa SAMKin Moodlelle. Se pitää kurssien materiaalit järjestyksessä omalla koneellasi ja kertoo, mitä on uutta ja mitä on tekemättä.

> **Beta-versio.** Lisäosa toimii vain SAMKin Moodlessa (`moodle5.samk.fi`). Se ei ole SAMKin eikä Moodlen virallinen tuote.

## Mitä Kurssikaveri tekee

- **Tallentaa materiaalit kurssikansioihin.** Moodlen kurssisivulle tulee palkki ja Tallenna-painikkeet. Tiedostot menevät valitsemaasi opintokansioon kurssin ja Moodlen välilehden mukaan. Tavallinen lataus Moodlesta menee myös oikeaan kansioon.
- **Näyttää, mitä on uutta ja mitä puuttuu.** Uudet kohteet on merkitty, ja palkki kertoo, onko kaikki tallennettu. Jos opettaja vaihtaa jo tallennetun tiedoston, Kurssikaveri huomaa sen ja säilyttää vanhan version rinnalla.
- **Kokoaa määräajat.** Tänään-sivu ja kalenteri näyttävät Moodlen tehtävien ja tenttien määräajat. Voit lisätä kalenteriin myös omia merkintöjä. Palautetut tehtävät poistuvat tulevista.
- **Tallentaa linkkejä ja tekstiä.** Minkä tahansa nettisivun voi tallentaa kurssille linkkinä, ja videolinkit tunnistetaan. Maalatun tekstin tai koko sivun tekstin voi tallentaa Markdown-tiedostona kurssin kansioon.
- **Ponnahdusikkuna** työkalupalkissa näyttää lähimmän määräajan ja avoimen sivun tallennuksen.
- **Värimaailmat.** Voit valita valmiin värimaailman tai tehdä oman.

## Optimoitu Obsidianille

Kurssikaveri tallentaa kaiken tavallisina tiedostoina ja Markdown-muodossa, joten opintokansion voi käyttää Obsidian-holvina.

- Opintokansio voi olla holvin juuri. Kurssikaveri tunnistaa olemassa olevan holvin tai voi valmistella tavallisen kansion holviksi (Asetukset → Obsidian).
- Jokaisella kurssilla on oma `Kurssin tiedot.md`, jossa on kurssin perustiedot ominaisuuksina, omat linkit ja Moodlen materiaaliluettelo. Kurssin nimi on tiedoston aliaksena, joten Obsidianin pikahaku löytää kurssin nimellä. `Opinnot.md` on kaikkien kurssien hakemisto.
- Tallennetut tekstit ovat omina Markdown-tiedostoinaan kansiossa `Omat tallennukset`. Niihin voi lisätä huomautuksen ja tagit, jotka tallentuvat Obsidianin `tags`-ominaisuuteen.
- YouTube-videot voi näyttää upotettuina Kurssin tiedot.md -tiedostossa.
- Obsidianin voi ottaa käyttöön tai pois käytöstä myöhemminkin. Tiedostoja ei poisteta.

Jotta PowerPoint- ja Excel-tiedostot näkyvät Obsidianin tiedostolistassa, laita Obsidianin asetuksista (Files and links) päälle **Detect all file extensions**.

## Asennus

Kurssikaveri toimii Chromessa ja muissa Chromium-selaimissa (Edge, Brave, Opera, Vivaldi). Lisäosa ei ole Chrome Web Storessa, joten se asennetaan kansiosta.

1. Lataa lisäosa jommallakummalla tavalla:
   - **ZIP:** avaa repon sivulta **Code → Download ZIP** ja pura paketti.
   - **Git:** `git clone https://github.com/jami-ict/kurssikaveri.git`
2. Avaa selaimessa `chrome://extensions`.
3. Laita oikeasta yläkulmasta päälle **Kehittäjätila** (Developer mode).
4. Paina **Lataa pakkaamaton** (Load unpacked) ja valitse kansio, jonka sisällä näkyy suoraan `manifest.json`.
5. Aloitusopas aukeaa. Valitse siinä opintokansio, johon materiaalit tallennetaan, ja anna selaimelle lupa muokata kansiota. Kiinnitä Kurssikaveri työkalupalkkiin palapelikuvakkeesta.

**Älä poista kansiota asennuksen jälkeen**, koska selain käyttää sitä. Päivitä lisäosa lataamalla uudet tiedostot samaan kansioon ja painamalla `chrome://extensions`-sivulla Kurssikaverin kohdalla ↻-painiketta.

**Älä poista lisäosaa päivittääksesi sen.** Poisto tyhjentää lisäosan muistin (kurssit, omat merkinnät, asetukset ja tiedon tallennetuista tiedostoista). Kurssikaveri kopioi tiedot opintokansioon, ja aloitusopas voi palauttaa ne uudelleenasennuksen jälkeen. Tallennetut tiedostot säilyvät kansiossa.

## Lisenssi

[MIT](LICENSE). Kolmannen osapuolen osien merkinnät ovat tiedostossa [THIRD-PARTY.md](THIRD-PARTY.md).
