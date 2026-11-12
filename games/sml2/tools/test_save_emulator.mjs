#!/usr/bin/env node
/*
 * End-to-end save-path test for the SML2 HC007 patch.
 *
 * Serverboy drops ROM writes, so this script installs a tiny NOR-flash model
 * for the log window (bank 0x20, CPU 0x6000-0x7FFF).  It then calls the
 * patched save hook with a synthetic save, checks the record it builds,
 * checks duplicate suppression and the append path, and finally boots a ROM
 * with the produced log to verify the restore path.
 *
 * Usage:
 *   node games/sml2/tools/test_save_emulator.mjs [roms/sml2-hc007.gb]
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

settings[2] = true; // force DMG

const ROM_PATH = process.argv[2] || path.join(ROOT, 'roms/sml2-hc007.gb');
const LOG_FILE_OFFSET = 0x82000;
const LOG_SIZE = 0x2000;
const REC_SIZE = 0xF6;
const SAVE_SIZE = 0xF0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function saveByte(gb, offset) {
  return gb.getSaveData()[offset];
}

function frame(gb, n = 1) {
  for (let i = 0; i < n; i++) gb.doFrame();
}

function tap(gb, core, key, wait = 30) {
  core.JoyPad = 0xff;
  gb.pressKey(key);
  gb.doFrame();
  gb.pressKey(key);
  gb.doFrame();
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
          if (process.env.DEBUG_FLASH) console.error(`PROG ${off.toString(16)}=${value.toString(16)}`);
          data[off] = value;
          mode = 'read';
          return;
        }
        if (mode === 'erase' && a === 0x6000 && value === 0x30) {
          if (process.env.DEBUG_FLASH) console.error('ERASE');
          data.fill(0xFF);
          mode = 'read';
          return;
        }
      }
      return originalWriter(parent, a, value);
    };
    const originalReader = core.memoryReader[addr];
    core.memoryReader[addr] = function (parent, a) {
      if ((parent.ROMBank1offs || 0) === 0x20) {
        const value = data[a - 0x6000];
        if (process.env.DEBUG_FLASH) console.error(`READ ${(a - 0x6000).toString(16)}=${value.toString(16)} mode=${mode}`);
        return value;
      }
      return originalReader(parent, a);
    };
  }
  return { core, data };
}

function bootToMenu(gb) {
  const core = gb[Object.keys(gb)[0]].gameboy;
  frame(gb, 200);
  tap(gb, core, 'START', 200);
  return core;
}

function syntheticSave(gb, core, slot, seed) {
  core.memoryWriter[0xa2a3](core, 0xa2a3, slot);
  for (let i = 0; i < 0x40; i++) {
    core.memoryWriter[0xa840 + i](core, 0xa840 + i, (i * 3 + seed) & 0xff);
  }
  core.memoryWriter[0xa262](core, 0xa262, 0x12);
  core.memoryWriter[0xa263](core, 0xa263, 0x34);
  core.memoryWriter[0xa2c5](core, 0xa2c5, 0x56);
  core.memoryWriter[0xa22c](core, 0xa22c, 0x78);
  core.memoryWriter[0xa28d](core, 0xa28d, 0x9a);

  // Return to a JR -2 loop in WRAM after the hook.  Use the game's real
  // SRAM stack (SP=0xA8FF at boot); the journal uses the free stack space
  // below SP for its WRAM backup.  The file-select context runs in bank
  // 0x0C, and IE is cleared so a pending VBlank cannot run game code
  // against the synthetic call frame.
  core.memoryWriter[0xdff0](core, 0xdff0, 0x18);
  core.memoryWriter[0xdff1](core, 0xdff1, 0xfe);
  core.memoryWriter[0xa24e](core, 0xa24e, 0x0c);
  core.memoryWriter[0xffff](core, 0xffff, 0);
  core.stackPointer = 0xa8ff;
  core.memoryWriter[0xa8fd](core, 0xa8fd, 0xf0);
  core.memoryWriter[0xa8fe](core, 0xa8fe, 0xdf);
  core.stackPointer = 0xa8fd;
  if (process.env.DEBUG_SAVE) {
    console.error(`before hook: a2a3=${saveByte(gb, 0x2a3).toString(16)} a840=${saveByte(gb, 0x840).toString(16)} ` +
      `slot0 status=${saveByte(gb, 0x42).toString(16)} chk=${saveByte(gb, 0x45).toString(16)}`);
  }
  core.programCounter = 0x1967;
  frame(gb, 30);
  assert(core.programCounter === 0xdff0, `save hook did not return to WRAM (PC 0x${core.programCounter.toString(16)})`);
  assert((core.ROMBank1offs || 0) === saveByte(gb, 0x24e),
    `bank not restored: 0x${(core.ROMBank1offs || 0).toString(16)} != 0x${saveByte(gb, 0x24e).toString(16)}`);
  if (process.env.DEBUG_SAVE) {
    const save = gb.getSaveData();
    console.error(`after hook: slot0 status=${saveByte(gb, 0x42).toString(16)} chk=${saveByte(gb, 0x45).toString(16)} ` +
      `data=${Array.from(save.slice(0, 8)).map(b => b.toString(16)).join(' ')} ` +
      `a840=${save[0x840].toString(16)} bank=${core.currMBCRAMBank} enabled=${core.MBCRAMBanksEnabled}`);
  }
  return Array.from(gb.getSaveData().slice(0, SAVE_SIZE));
}

function syntheticClear(gb, core, slot = 0) {
  core.memoryWriter[0xa2a3](core, 0xa2a3, slot);
  core.memoryWriter[0xdff0](core, 0xdff0, 0x18);
  core.memoryWriter[0xdff1](core, 0xdff1, 0xfe);
  core.memoryWriter[0xa24e](core, 0xa24e, 0x0c);
  core.memoryWriter[0xffff](core, 0xffff, 0);
  core.stackPointer = 0xa8ff;
  core.memoryWriter[0xa8fd](core, 0xa8fd, 0xf0);
  core.memoryWriter[0xa8fe](core, 0xa8fe, 0xdf);
  core.stackPointer = 0xa8fd;
  core.programCounter = 0x197b; // clear trampoline
  frame(gb, 30);
  assert(core.programCounter === 0xdff0,
    `clear hook did not return to WRAM (PC 0x${core.programCounter.toString(16)})`);
  assert((core.ROMBank1offs || 0) === saveByte(gb, 0x24e),
    'clear hook did not restore the game bank');
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
  const core = bootToMenu(gb);

  const flash = installFlashModel(gb);

  if (process.env.DEBUG_SAVE) console.error('--- save 1');
  syntheticSave(gb, core, 0, 1);
  assert(validRecord(flash.data, 0), 'first save did not produce a valid record');
  assert(flash.data[0] === 0x4D && flash.data[1] === 0x4C, 'record magic is wrong');
  assert(flash.data[0xF4] === 0x5A, 'record commit byte is wrong');

  // Same save again: must not append.
  if (process.env.DEBUG_SAVE) console.error('--- save 2 (duplicate)');
  syntheticSave(gb, core, 0, 1);
  assert(flash.data[REC_SIZE] === 0xFF, 'duplicate save appended a record');

  // Changed save: must append at REC_SIZE.
  if (process.env.DEBUG_SAVE) console.error('--- save 3 (append)');
  syntheticSave(gb, core, 0, 2);
  assert(validRecord(flash.data, REC_SIZE), 'second save did not produce a valid record');

  // Fill the log with non-blank junk: the next save must erase and start at 0.
  if (process.env.DEBUG_SAVE) console.error('--- save 4 (erase)');
  flash.data.fill(0x00);
  syntheticSave(gb, core, 0, 3);
  assert(validRecord(flash.data, 0), 'save after erase did not produce a valid record');
  assert(flash.data[REC_SIZE] === 0xFF, 'erase did not clear the rest of the log');

  const recordPayload = Array.from(flash.data.slice(3, 3 + SAVE_SIZE));
  assert(recordPayload[0] === ((0 * 3 + 3) & 0xff),
    'record payload does not contain the last saved data');

  // Reader-path proof: put the produced log into the ROM and boot it.
  const log = flash.data.slice(0, REC_SIZE);
  const seeded = Buffer.from(rom);
  Buffer.from(log).copy(seeded, LOG_FILE_OFFSET);
  const out = path.join(os.tmpdir(), 'sml2-hc007-emu-test.gb');
  fs.writeFileSync(out, seeded);

  const booted = new Gameboy();
  booted.loadRom(seeded);
  bootToMenu(booted);
  const restored = Array.from(booted.getSaveData().slice(0, SAVE_SIZE));
  assert(restored.every((value, index) => value === recordPayload[index]),
    'boot restore did not reproduce the logged save region');
  assert(restored[0x42] !== 0x00, 'restored slot 0 is still marked empty');

  // Delete path: run the relocated file-select CLEAR routine and journal it.
  if (process.env.DEBUG_SAVE) console.error('--- clear');
  syntheticClear(gb, core, 0);
  assert(validRecord(flash.data, REC_SIZE), 'clear did not append a valid record');
  assert(flash.data[REC_SIZE + 3 + 0x42] === 0x00, 'clear record is not empty');

  const deletedRom = Buffer.from(rom);
  Buffer.from(flash.data.slice(0, REC_SIZE)).copy(deletedRom, LOG_FILE_OFFSET);
  Buffer.from(flash.data.slice(REC_SIZE, REC_SIZE * 2)).copy(deletedRom, LOG_FILE_OFFSET + REC_SIZE);
  const deletedPath = path.join(os.tmpdir(), 'sml2-hc007-emu-delete.gb');
  fs.writeFileSync(deletedPath, deletedRom);

  const deleted = new Gameboy();
  deleted.loadRom(deletedRom);
  bootToMenu(deleted);
  const restoredDelete = Array.from(deleted.getSaveData().slice(0, SAVE_SIZE));
  assert(restoredDelete[0x42] === 0x00, 'delete did not persist across boot');

  console.log('save path: OK');
  console.log(`  record 0: ${REC_SIZE} bytes, commit 0x${flash.data[0xF4].toString(16)}`);
  console.log(`  restored slot 0 status 0x${restored[0x42].toString(16)}, checksum 0x${restored[0x45].toString(16)}`);
  console.log(`  delete record: status 0x${flash.data[REC_SIZE + 3 + 0x42].toString(16)}, restored 0x${restoredDelete[0x42].toString(16)}`);
  console.log(`  seeded ROM: ${out}`);
  console.log(`  delete ROM: ${deletedPath}`);
}

main();
