#!/usr/bin/env node
/*
 * MBC1 -> MBC5 lockstep test.
 *
 * Runs the original ROM and a copy whose only change is the cartridge type
 * (0x147: 0x03 -> 0x1B) side by side over the scripted level route, and
 * compares WRAM, VRAM, OAM and HRAM every frame.  Any divergence means the
 * game relies on an MBC1 quirk (bank 0 -> 1 remap, 5-bit bank mask).
 *
 *   node games/dk/tools/test_mbc5_lockstep.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRom, readMem } from '../../../tools/gb_harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ORIG = path.join(ROOT, 'roms/roms-to-patch/Donkey Kong (Japan, USA) (SGB Enhanced).gb');
const rom = fs.readFileSync(ORIG);
const m5 = Buffer.from(rom);
m5[0x147] = 0x1B;
// header checksum
let c = 0; for (let i = 0x134; i <= 0x14C; i++) c = (c - m5[i] - 1) & 0xFF; m5[0x14D] = c;
const tmp = path.join(os.tmpdir(), 'dk-mbc5-only.gb');
fs.writeFileSync(tmp, m5);

const a = loadRom(ORIG, undefined, { skipTitle: true });
const b = loadRom(tmp, undefined, { skipTitle: true });
const coreOf = (gb) => gb[Object.keys(gb)[0]].gameboy;
const ca = coreOf(a), cb = coreOf(b);

const REGIONS = [[0xC000, 0x2000, 'WRAM'], [0x8000, 0x2000, 'VRAM'], [0xFE00, 0xA0, 'OAM'], [0xFF80, 0x7F, 'HRAM']];
let first = null, frames = 0, bankValues = new Set();
for (const core of [ca, cb]) {
  const ow = core.memoryWriter[0x2000];
  // log every ROM-bank value written (through any address in 0x2000-0x3FFF)
}
const watch = (core, set) => {
  for (let ad = 0x2000; ad < 0x4000; ad++) {
    const ow = core.memoryWriter[ad];
    core.memoryWriter[ad] = (p, x, v) => { set.add(v); return ow(p, x, v); };
  }
};
watch(cb, bankValues);

function step(n) {
  for (let i = 0; i < n; i++) {
    a.doFrame(); b.doFrame(); frames++;
    for (const [s, l, name] of REGIONS) {
      const x = readMem(a, s, l), y = readMem(b, s, l);
      for (let k = 0; k < l; k++) if (x[k] !== y[k]) { if (!first) first = { frame: frames, name, addr: s + k, a: x[k], b: y[k] }; return false; }
    }
  }
  return true;
}
function key(core, gb, name, n) { // hold a key for n frames, lockstep
  const KEY = { RIGHT: 0, LEFT: 1, UP: 2, DOWN: 3, A: 4, B: 5, SELECT: 6, START: 7 };
  for (let i = 0; i < n; i++) {
    for (const g of [a, b]) { coreOf(g).JoyPad = 0xff; g.pressKeys([name]); }
    if (!step(1)) return false;
  }
  for (const g of [a, b]) coreOf(g).JoyPad = 0xff;
  return step(2);
}

const route = [['wait', 300], ['START', 2], ['wait', 400], ['A', 2], ['wait', 120], ['A', 2], ['wait', 200], ['A', 2], ['wait', 300],
  ['RIGHT', 90], ['A', 2], ['wait', 30], ['LEFT', 120], ['A', 2], ['wait', 30], ['RIGHT', 200], ['A', 2], ['wait', 30], ['UP', 100],
  ['RIGHT', 200], ['A', 2], ['wait', 300]];
let ok = true;
for (const [k, n] of route) {
  ok = k === 'wait' ? step(n) : key(ca, a, k, n);
  if (!ok) break;
}
console.log(`frames compared: ${frames}`);
console.log(`bank values written (MBC5 run): ${[...bankValues].sort((x, y) => x - y).map((v) => '0x' + v.toString(16)).join(' ')}`);
const bad = [...bankValues].filter((v) => v === 0 || v > 0x1F);
console.log(bad.length ? `WARNING: bank writes of 0 or >0x1F: ${bad.join(',')}` : 'no bank write of 0 or >0x1F');
if (first) { console.log('DIVERGED', JSON.stringify(first)); process.exit(1); }
console.log('PASS  MBC5-only build is frame-identical to the MBC1 original over the route');
