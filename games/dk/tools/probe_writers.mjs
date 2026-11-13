#!/usr/bin/env node
/*
 * Dynamic probe of the Donkey Kong save writers (no gameplay needed).
 *
 * Boots to the title/menu so the game's own init has written a valid empty
 * SRAM, then calls each writer routine directly with seeded WRAM and diffs the
 * SRAM.  Optionally dumps the post-call SRAM so it can be reloaded with
 * `sram_trace.mjs --sram` to prove the game accepts it.
 *
 * Usage:
 *   node games/dk/tools/probe_writers.mjs [rom] [--out-dir DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadRom, tapKey } from '../../../tools/gb_harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);
const settings = require(path.join(ROOT, 'tools/serverboy/src/gameboy_core/settings.js'));
const Gameboy = require(path.join(ROOT, 'tools/serverboy'));
settings[2] = true; // DMG

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out-dir');
const OUT = outIdx >= 0 ? args.splice(outIdx, 2)[1] : path.join(ROOT, 'games/dk/analysis');
const ROM = args[0] || path.join(ROOT, 'roms/roms-to-patch/Donkey Kong (Japan, USA) (SGB Enhanced).gb');

const hex = (v, n = 4) => v.toString(16).toUpperCase().padStart(n, '0');
const frame = (gb, n = 1) => { for (let i = 0; i < n; i++) gb.doFrame(); };
const coreOf = (gb) => gb[Object.keys(gb)[0]].gameboy;
const wr = (core, a, v) => core.memoryWriter[a](core, a, v & 0xff);
const rd = (core, a) => core.memoryReader[a](core, a);

function tap(gb, core, key, wait = 30) {
  core.JoyPad = 0xff; gb.pressKey(key); gb.doFrame();
  gb.pressKey(key); gb.doFrame(); core.JoyPad = 0xff; frame(gb, wait);
}

function boot(sram) {
  // Same boot path as tools/sram_trace.mjs --no-title-skip (harness taps START).
  const gb = loadRom(ROM, sram, { skipTitle: false });
  const core = coreOf(gb);
  frame(gb, 300);
  tapKey(gb, 'START', 10);           // second START runs the save validator (bank0:0x1EBB)
  frame(gb, 300);                    // let the game's own init/validate finish
  return { gb, core };
}
/* Call bank:pc with a return into a JR -2 loop at 0xDF00. */
function call(gb, core, bank, pc, label) {
  wr(core, 0xDF00, 0x18); wr(core, 0xDF01, 0xFE);
  wr(core, 0xFFFF, 0);                // no interrupts while borrowing the CPU
  wr(core, 0x2000, bank);             // MBC1 ROM bank
  core.stackPointer = 0xDF80;
  wr(core, 0xDF7E, 0x00); wr(core, 0xDF7F, 0xDF);
  core.stackPointer = 0xDF7E;
  core.programCounter = pc;
  frame(gb, 20);
  const ok = core.programCounter === 0xDF00;
  console.log(`${label}: returned=${ok} PC=${hex(core.programCounter)} bank=${hex(core.ROMBank1offs || 0, 2)}`);
  return ok;
}

function diff(before, after, label) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= before.length; i++) {
    const d = i < before.length && before[i] !== after[i];
    if (d && start < 0) start = i;
    if (!d && start >= 0) { runs.push([start, i - 1]); start = -1; }
  }
  console.log(`${label}: ${runs.length} changed run(s)`);
  for (const [s, e] of runs) {
    console.log(`  ${hex(0xA000 + s)}-${hex(0xA000 + e)} (${e - s + 1} bytes): ` +
      `${Buffer.from(after.slice(s, Math.min(e + 1, s + 32))).toString('hex')}`);
  }
  return runs;
}

fs.mkdirSync(OUT, { recursive: true });
const { gb, core } = boot();
const base = Uint8Array.from(gb.getSaveData());
console.log(`baseline nonzero bytes: ${base.filter((b) => b).length}`);
diff(new Uint8Array(base.length), base, 'init vs zero');
fs.writeFileSync(path.join(OUT, 'menu-init.sav'), base);

/* --- progress record writer: bank 1 0x4CB3 ------------------------------ */
for (const [name, da43] of [['progress-a', 0x05], ['progress-b', 0x0B]]) {
  const t = boot(Buffer.from(base));
  wr(t.core, 0xDA43, da43);
  if (!call(t.gb, t.core, 1, 0x4CB3, name)) continue;
  const after = Uint8Array.from(t.gb.getSaveData());
  diff(base, after, `${name} (DA43=${hex(da43, 2)})`);
  fs.writeFileSync(path.join(OUT, `${name}.sav`), after);
}

/* --- 4-byte record writer: bank 0 0x0EFE (A190 + 4*rank, data from C711) -- */
{
  const t = boot(Buffer.from(base));
  wr(t.core, 0xC85C, 3); wr(t.core, 0xC85D, 0);   // score -> rank loop count
  wr(t.core, 0xC711, 0x12); wr(t.core, 0xC712, 0x34);
  call(t.gb, t.core, 1, 0x0EFE, 'record-a190');
  const after = Uint8Array.from(t.gb.getSaveData());
  diff(base, after, 'record-a190');
  fs.writeFileSync(path.join(OUT, 'record-a190.sav'), after);
}

/* --- acceptance: does init leave a crafted save alone? ------------------- */
for (const name of ['progress-a', 'record-a190']) {
  const sav = fs.readFileSync(path.join(OUT, `${name}.sav`));
  const t = boot(Buffer.from(sav));
  const after = Uint8Array.from(t.gb.getSaveData());
  const same = Buffer.compare(Buffer.from(after), sav) === 0;
  console.log(`accept ${name}: SRAM unchanged by game init = ${same}`);
  if (!same) diff(sav, after, `  ${name} after boot`);
}



/* --- combined: valid progress header + A190 record must both survive ------- */
{
  const prog = fs.readFileSync(path.join(OUT, 'progress-a.sav'));
  const t = boot(Buffer.from(prog));
  wr(t.core, 0xC85C, 3); wr(t.core, 0xC85D, 0);
  wr(t.core, 0xC711, 0x12); wr(t.core, 0xC712, 0x34);
  call(t.gb, t.core, 1, 0x0EFE, 'record on top of progress');
  const combo = Uint8Array.from(t.gb.getSaveData());
  fs.writeFileSync(path.join(OUT, 'progress+record.sav'), combo);
  diff(Uint8Array.from(prog), combo, 'combo vs progress');
  const t2 = boot(Buffer.from(combo));
  const after = Uint8Array.from(t2.gb.getSaveData());
  const same = Buffer.compare(Buffer.from(after), Buffer.from(combo)) === 0;
  console.log(`accept progress+record: SRAM unchanged by game init = ${same}`);
  if (!same) diff(combo, after, '  combo after boot');
}
