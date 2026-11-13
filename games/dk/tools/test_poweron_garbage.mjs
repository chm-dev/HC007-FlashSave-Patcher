#!/usr/bin/env node
/*
 * Hardware-realism test: real carts and consoles power up with random WRAM,
 * HRAM, VRAM, OAM and SRAM and an unknown RAM-bank register; emulators start
 * at zero.  Boot the ROM many times with randomised power-on state and check
 * that it reaches Select File and then a level.
 *
 *   node games/dk/tools/test_poweron_garbage.mjs [rom] [runs]
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadRom, tapKey } from '../../../tools/gb_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROM = process.argv[2] || path.join(ROOT, 'roms/dk-hc007.gb');
const RUNS = Number(process.argv[3] || 6);
// --hostile4000: a write to 0x4000-0x5FFF disables cart RAM (SML2's flash helper always re-enables it afterwards).
// --hostile2000: the same for ROM-bank writes (0x2000-0x3FFF).
const HOSTILE4000 = process.argv.includes('--hostile4000');
const HOSTILE2000 = process.argv.includes('--hostile2000');
const coreOf = (gb) => gb[Object.keys(gb)[0]].gameboy;
const frame = (gb, n) => { for (let i = 0; i < n; i++) gb.doFrame(); };
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed >>> 24; };

function pixelsText(gb) { // crude "is the select-file screen showing" signature: count distinct dark pixels
  const px = gb.getScreen(); let dark = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 100) dark++;
  return dark;
}

let bad = 0;
for (let run = 0; run < RUNS; run++) {
  const sram = Buffer.alloc(0x8000); for (let i = 0; i < sram.length; i++) sram[i] = rnd();
  const gb = loadRom(ROM, sram, { skipTitle: true });
  const core = coreOf(gb);
  for (let a = 0xC000; a < 0xE000; a++) core.memoryWriter[a](core, a, rnd());
  for (let a = 0xFF80; a < 0xFFFF; a++) core.memoryWriter[a](core, a, rnd());
  for (let a = 0x8000; a < 0xA000; a++) core.memoryWriter[a](core, a, rnd());
  const bankMode = run % 3;                            // RAM bank register power-on value
  if (bankMode) core.memoryWriter[0x4000](core, 0x4000, bankMode === 1 ? 0x03 : 0x0F);
  const hostile = (lo, hi) => { for (let a = lo; a < hi; a++) { const ow = core.memoryWriter[a]; core.memoryWriter[a] = (p, ad, v) => { p.MBCRAMBanksEnabled = false; return ow(p, ad, v); }; } };
  if (HOSTILE4000) hostile(0x4000, 0x6000);
  if (HOSTILE2000) hostile(0x2000, 0x3000);
  frame(gb, 300);
  tapKey(gb, 'START', 10); frame(gb, 400);
  tapKey(gb, 'START', 10); frame(gb, 400);
  const sig = [core.MBCRam[0x1FFA], core.MBCRam[0x1FFB]];
  tapKey(gb, 'A', 120); tapKey(gb, 'A', 200); tapKey(gb, 'A', 300); frame(gb, 200);
  const ok = pixelsText(gb) > 500;
  const pc = core.programCounter.toString(16);
  console.log(`run ${run} ramBankMode=${bankMode} sig=${sig.map((v) => v.toString(16))} dark=${pixelsText(gb)} PC=${pc} bank=${core.ROMBank1offs} -> ${ok ? 'alive' : 'SUSPECT'}`);
  if (!ok) bad++;
}
console.log(bad ? `${bad} suspect run(s)` : 'all runs alive');
process.exit(bad ? 1 : 0);
