// Aja: node --test tests/fsstore.test.mjs (ei asennettavia riippuvuuksia).
// Tiedoston kirjoituksen uudelleenyritys, kun toinen ohjelma lukitsee juuri luodun tiedoston hetkeksi.
import test from "node:test";
import assert from "node:assert/strict";
import { writeInDir } from "../shared/fsstore.js";

const domError = name => Object.assign(new Error(name), { name });

// failures = montako close-kutsua epäonnistuu ennen onnistumista
function lockedDir(failures, errorName = "InvalidStateError") {
  const files = new Map();
  const log = { closes: 0, aborts: 0 };
  return { files, log,
    getFileHandle: async name => ({
      createWritable: async () => {
        let pending = null;
        return {
          write: async content => { pending = content; },
          close: async () => {
            log.closes++;
            if (failures-- > 0) throw domError(errorName);
            files.set(name, pending);
          },
          abort: async () => { log.aborts++; }
        };
      }
    })
  };
}

const noWait = { waits: [0, 0, 0], sleep: async () => {} };

test("hetkellinen InvalidStateError yritetään uudelleen ja sisältö tallentuu", async () => {
  const dir = lockedDir(2);
  await writeInDir(dir, "Kurssi.md", "# Data", noWait);
  assert.equal(dir.files.get("Kurssi.md"), "# Data");
  assert.equal(dir.log.closes, 3);
  assert.equal(dir.log.aborts, 2);
});

test("myös NoModificationAllowedError yritetään uudelleen", async () => {
  const dir = lockedDir(1, "NoModificationAllowedError");
  await writeInDir(dir, "Kurssi.md", "x", noWait);
  assert.equal(dir.files.get("Kurssi.md"), "x");
});

test("pysyvä lukitus antaa virheen yritysten jälkeen", async () => {
  const dir = lockedDir(10);
  await assert.rejects(writeInDir(dir, "Kurssi.md", "x", noWait), { name: "InvalidStateError" });
  assert.equal(dir.log.closes, 4);
  assert.equal(dir.files.has("Kurssi.md"), false);
});

test("muita virheitä ei yritetä uudelleen", async () => {
  const dir = lockedDir(1, "NotAllowedError");
  await assert.rejects(writeInDir(dir, "Kurssi.md", "x", noWait), { name: "NotAllowedError" });
  assert.equal(dir.log.closes, 1);
});
