#!/usr/bin/env node
/*
 * Natural save-path test with a NOR-flash model.
 *
 * Runs the real title -> file select -> level route, lets Mario die, and
 * checks that the game's own save call produced a valid flash record.  This
 * exercises the journal through the real call site (not a synthetic jump)
 * after the level load has overwritten SRAM 0xAD00-0xB0DF.
 *
 * Usage:
 *   node games/sml2/tools/test_death_flash.mjs [roms/sml2-hc007.gb]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);
const settings = require(path.join(ROOT, 'tools/serverboy/src/gameboy_core/settings.js'));
const Gameboy = require(path.join(ROOT, 'tools/serverboy'));

settings[2] = true; // DMG

const ROM_PATH = process.argv[2] || path.join(ROOT, 'roms/sml2-hc007.gb');
const REC_SIZE = 0xF6;

function frame(gb, n = 1) { for (let i = 0; i < n; i++) gb.doFrame(); }
function tap(gb, core, key, wait = 30) {
  for (let i = 0; i < 3; i++) {
    core.JoyPad = 0xff;
    gb.pressKeys([key]);
    gb.doFrame();
  }
  core.JoyPad = 0xff;
  frame(gb, wait);
}

function installFlashModel(gb) {
  const core = gb[Object.keys(gb)[0]].gameboy;
  const data = new Uint8Array(0x2000).fill(0xFF);
  let mode = 'read';
  const originalIdReader = core.memoryReader[0x0000];
  core.memoryReader[0x0000] = function (parent, a) {
    if (mode === 'id') return 0x20;
    return originalIdReader(parent, a);
  };
  const wrap = (addr, fn) => {
    const original = core.memoryWriter[addr];
    core.memoryWriter[addr] = function (parent, a, value) {
      fn(value, parent);
      return original(parent, a, value);
    };
  };
  wrap(0x0AAA, (value) => {
    if (value === 0xA0) mode = 'program';
    else if (value === 0x80) mode = 'erase';
    else if (value === 0x90) mode = 'id';
  });
  wrap(0x4000, (value) => { if (value === 0xF0) mode = 'read'; });
  for (let addr = 0x6000; addr < 0x8000; addr++) {
    const originalWriter = core.memoryWriter[addr];
    core.memoryWriter[addr] = function (parent, a, value) {
      if ((parent.ROMBank1offs || 0) === 0x20) {
        const off = a - 0x6000;
        if (mode === 'program') {
          data[off] = value;
          mode = 'read';
          return;
        }
        if (mode === 'erase' && a === 0x6000 && value === 0x30) {
          data.fill(0xFF);
          mode = 'read';
          return;
        }
      }
      return originalWriter(parent, a, value);
    };
    const originalReader = core.memoryReader[addr];
    core.memoryReader[addr] = function (parent, a) {
      if ((parent.ROMBank1offs || 0) === 0x20) return data[a - 0x6000];
      return originalReader(parent, a);
    };
  }
  return { core, data };
}

function validRecord(data, off) {
  if (data[off] !== 0x4D || data[off + 1] !== 0x4C || data[off + 2] !== 0xF0) return false;
  let sum = 0;
  for (let i = 0; i < 0xF3; i++) sum = (sum + data[off + i]) & 0xff;
  return data[off + 0xF3] === sum && data[off + 0xF4] === 0x5A;
}

function main() {
  const gb = new Gameboy();
  gb.loadRom(fs.readFileSync(ROM_PATH));
  const core = gb[Object.keys(gb)[0]].gameboy;
  const flash = installFlashModel(gb);

  frame(gb, 200);
  tap(gb, core, 'START', 120);
  tap(gb, core, 'A', 30);
  tap(gb, core, 'START', 300);
  tap(gb, core, 'A', 200);
  const state = Array.from(gb.getMemory(0xff9b, 0xff9c))[0];
  console.log(`level entry: state=0x${state.toString(16)}`);
  if (state !== 0x04 && state !== 0x09) {
    throw new Error(`expected a level state, got 0x${state.toString(16)}`);
  }

  // Walk right until the death/game-over transition and give the save hook
  // time to run.
  let lastState = state;
  for (let f = 0; f < 3000; f++) {
    core.JoyPad = 0xff;
    gb.pressKeys(['RIGHT']);
    gb.doFrame();
    const now = Array.from(gb.getMemory(0xff9b, 0xff9c))[0];
    if (now !== lastState) {
      console.log(`  state 0x${lastState.toString(16)} -> 0x${now.toString(16)} at frame ${f} (PC 0x${core.programCounter.toString(16)})`);
      lastState = now;
    }
  }
  core.JoyPad = 0xff;

  if (!validRecord(flash.data, 0)) {
    throw new Error('natural death/level transition did not write a valid flash record');
  }
  console.log('natural save path: OK');
  console.log(`  record 0: ${REC_SIZE} bytes, commit 0x${flash.data[0xF4].toString(16)}`);
  console.log(`  final state=0x${Array.from(gb.getMemory(0xff9b, 0xff9c))[0].toString(16)}`);
}

main();
