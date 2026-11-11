#!/usr/bin/env node
/*
 * Screen a ROM for batteryless-save suitability by watching its SRAM in the
 * emulator.  The journal detects "a save happened" by polling SRAM pages, so a
 * game that uses cart RAM as work RAM (hot pages, stack in 0xA000..0xBFFF)
 * cannot be journaled by polling.
 *
 *   node tools/sram_activity.mjs path/to/game.gb [frames]
 *
 * Presses START/A/RIGHT periodically (no real gameplay), then reports:
 *   - the CPU stack pointer (SP inside 0xA000..0xBFFF = SRAM used as WRAM),
 *   - per 256-byte page of bank 0: bytes in use and how often it changed.
 */
import { loadRom, tapKey } from './gb_harness.mjs';

const rom = process.argv[2];
const frames = Number(process.argv[3] || 1500);
if (!rom) {
  console.error('usage: node tools/sram_activity.mjs game.gb [frames]');
  process.exit(2);
}

const gb = loadRom(rom, undefined, { skipTitle: true });
const core = gb[Object.keys(gb)[0]].gameboy;
const ram = () => core.MBCRam;

const changed = new Array(32).fill(0);
let samples = 0;
let prev = Uint8Array.from(ram().slice(0, 0x2000));
const keys = ['START', 'A', 'START', 'A', 'RIGHT', 'A'];
let spInSram = 0;
let spSamples = 0;

for (let i = 0; i < frames; i++) {
  gb.doFrame();
  if (i % 40 === 10) tapKey(gb, keys[((i / 40) | 0) % keys.length], 4);
  if (i % 3 === 0) {
    const cur = ram();
    samples++;
    for (let p = 0; p < 32; p++) {
      for (let k = 0; k < 256; k++) {
        if (cur[p * 256 + k] !== prev[p * 256 + k]) { changed[p]++; break; }
      }
    }
    prev = Uint8Array.from(cur.slice(0, 0x2000));
    spSamples++;
    const sp = core.stackPointer;
    if (sp >= 0xA000 && sp < 0xC000) spInSram++;
  }
}

const cur = ram();
const used = [];
for (let p = 0; p < 32; p++) {
  let n = 0;
  for (let k = 0; k < 256; k++) if (cur[p * 256 + k]) n++;
  used.push(n);
}
const hot = changed.filter((c) => c > samples * 0.2).length;

console.log(`ROM: ${rom}`);
console.log(`frames=${frames} samples=${samples}`);
console.log(`SP in SRAM: ${spInSram}/${spSamples} samples`);
console.log('page    :', Array.from({ length: 32 }, (_, p) => p.toString(16).padStart(3)).join(' '));
console.log('in use  :', used.map((n) => String(n).padStart(3)).join(' '));
console.log('changed :', changed.map((n) => String(n).padStart(3)).join(' '));
console.log(`hot pages (changed in >20% of samples): ${hot}`);
if (spInSram > 0 || hot > 2) {
  console.log('VERDICT: poor candidate - SRAM is used as work RAM; polling cannot find the save.');
} else {
  console.log('VERDICT: SRAM looks quiet; polling-based journaling should work.');
}
