#!/usr/bin/env node
/*
 * Regression test for the real SML2 failure mode.
 *
 * A level load overwrites SRAM 0xAD00-0xB0DF, which the previous patch used
 * for its manager and journal source.  The next save then executed game data
 * and reset the Game Boy.  This test boots the patched ROM, enters a level so
 * the game overwrites that SRAM, and then calls the save hook.
 *
 * The journal code now lives in ROM bank 0x24 and only borrows WRAM, so the
 * save must still produce a valid record after the level load.
 *
 * Usage:
 *   node games/sml2/tools/test_save_after_level.mjs [roms/sml2-hc007.gb]
 */
import fs from 'node:fs';
import os from 'node:os';
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
const LOG_FILE_OFFSET = 0x82000;
const LOG_SIZE = 0x2000;
const REC_SIZE = 0xF6;
const SAVE_SIZE = 0xF0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function frame(gb, n = 1) {
  for (let i = 0; i < n; i++) gb.doFrame();
}

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
  const data = new Uint8Array(LOG_SIZE).fill(0xFF);
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
  wrap(0x4000, (value) => {
    if (value === 0xF0) mode = 'read';
  });
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
  return data;
}

function validRecord(data, off) {
  if (data[off] !== 0x4D || data[off + 1] !== 0x4C || data[off + 2] !== 0xF0) return false;
  let sum = 0;
  for (let i = 0; i < 0xF3; i++) sum = (sum + data[off + i]) & 0xff;
  return data[off + 0xF3] === sum && data[off + 0xF4] === 0x5A;
}

function main() {
  const rom = fs.readFileSync(ROM_PATH);
  const gb = new Gameboy();
  gb.loadRom(rom);
  const core = gb[Object.keys(gb)[0]].gameboy;

  frame(gb, 200);
  tap(gb, core, 'START', 120);
  tap(gb, core, 'A', 30);
  tap(gb, core, 'START', 300);

  // Count writes to the old manager area after the file-select setup, then
  // enter the level.  This proves the level load really touches the area the
  // previous patch used for its manager/journal source.
  let sramWorkWrites = 0;
  for (let a = 0xad00; a <= 0xb0df; a++) {
    const original = core.memoryWriter[a];
    core.memoryWriter[a] = function (parent, addr, value) {
      sramWorkWrites++;
      return original(parent, addr, value);
    };
  }
  tap(gb, core, 'A', 200);
  const stateAfterEntry = Array.from(gb.getMemory(0xff9b, 0xff9c))[0];
  console.log(`level entry: PC=0x${core.programCounter.toString(16)} state=0x${stateAfterEntry.toString(16)}`);
  assert(stateAfterEntry === 0x04 || stateAfterEntry === 0x09,
    `expected a level state, got 0x${stateAfterEntry.toString(16)}`);

  // Let the level load and gameplay overwrite SRAM 0xAD00-0xB0DF.  The old
  // patch stored its manager there; the new journal must not depend on it.
  frame(gb, 800);
  assert(sramWorkWrites > 0, 'level load did not write SRAM 0xAD00-0xB0DF');
  const overwritten = Array.from(gb.getSaveData()).slice(0xad00 - 0xa000, 0xad00 - 0xa000 + 8);
  console.log(`SRAM AD00-B0DF writes after entry: ${sramWorkWrites}`);
  console.log(`SRAM AD00 after level: ${overwritten.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

  // Install the NOR-flash model; its ID probe makes the journal use the
  // programming path.
  const flash = installFlashModel(gb);

  // Synthetic save fields (the original writer uses these).
  core.memoryWriter[0xa2a3](core, 0xa2a3, 0);
  for (let i = 0; i < 0x40; i++) {
    core.memoryWriter[0xa840 + i](core, 0xa840 + i, (i * 3 + 1) & 0xff);
  }
  core.memoryWriter[0xa262](core, 0xa262, 0x12);
  core.memoryWriter[0xa263](core, 0xa263, 0x34);
  core.memoryWriter[0xa2c5](core, 0xa2c5, 0x56);
  core.memoryWriter[0xa22c](core, 0xa22c, 0x78);
  core.memoryWriter[0xa28d](core, 0xa28d, 0x9a);

  // Snapshot the WRAM helper block; the save must restore it so the game's
  // level state survives the journal call.
  const wramBefore = Array.from(gb.getMemory(0xc100, 0xc400));

  // Return to a JR -2 loop, using the game's real SRAM stack.
  core.memoryWriter[0xdff0](core, 0xdff0, 0x18);
  core.memoryWriter[0xdff1](core, 0xdff1, 0xfe);
  core.memoryWriter[0xffff](core, 0xffff, 0);
  core.stackPointer = 0xa8ff;
  core.memoryWriter[0xa8fd](core, 0xa8fd, 0xf0);
  core.memoryWriter[0xa8fe](core, 0xa8fe, 0xdf);
  core.stackPointer = 0xa8fd;

  core.programCounter = 0x1967;
  frame(gb, 120);
  assert(core.programCounter === 0xdff0,
    `save hook did not return to WRAM (PC 0x${core.programCounter.toString(16)})`);
  assert(validRecord(flash, 0), 'post-level save did not produce a valid record');
  const wramAfter = Array.from(gb.getMemory(0xc100, 0xc400));
  assert(wramAfter.every((value, index) => value === wramBefore[index]),
    'save journal did not restore the game\'s WRAM helper block');

  const payload = Array.from(flash.slice(3, 3 + SAVE_SIZE));
  const seeded = Buffer.from(rom);
  Buffer.from(flash.slice(0, REC_SIZE)).copy(seeded, LOG_FILE_OFFSET);
  const out = path.join(os.tmpdir(), 'sml2-hc007-after-level.gb');
  fs.writeFileSync(out, seeded);

  const booted = new Gameboy();
  booted.loadRom(seeded);
  const bootedCore = booted[Object.keys(booted)[0]].gameboy;
  frame(booted, 200);
  tap(booted, bootedCore, 'START', 200);
  const restored = Array.from(booted.getSaveData().slice(0, SAVE_SIZE));
  assert(restored.every((value, index) => value === payload[index]),
    'post-level boot restore did not reproduce the logged save region');
  assert(restored[0x42] !== 0x00, 'restored slot 0 is still marked empty');

  console.log('post-level save path: OK');
  console.log(`  SRAM AD00 overwritten: ${overwritten.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`  record 0: ${REC_SIZE} bytes, commit 0x${flash[0xF4].toString(16)}`);
  console.log(`  restored slot 0 status 0x${restored[0x42].toString(16)}, checksum 0x${restored[0x45].toString(16)}`);
  console.log(`  seeded ROM: ${out}`);
}

main();
