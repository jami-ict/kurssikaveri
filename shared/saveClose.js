// Kuittaus ehtii näkyä ennen onnistuneen tallennusikkunan sulkemista.
// Käyttäjän jatkotoiminto peruu sulkemisen; taustan uudelleenpiirto ei aloita aikaa alusta.
export const SAVE_CLOSE_DELAY = 1500;

export function createSaveClose(target) {
  let timer = null;
  function cancel() {
    if (timer !== null) target.clearTimeout(timer);
    timer = null;
  }
  return {
    cancel,
    start() {
      cancel();
      timer = target.setTimeout(() => { timer = null; target.close(); }, SAVE_CLOSE_DELAY);
    }
  };
}
