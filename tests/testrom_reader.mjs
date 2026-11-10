#!/usr/bin/env node
/*
 * Reader-path regression for the HC007 test ROM.
 *
 * Emulators drop flash writes, so this test only exercises the log reader:
 * it seeds records into the ROM image at the log's file offset and checks the
 * test ROM's `flash_value`/`counter` globals after boot.
 *
 * Log: bank 0x18, CPU 0x6000 -> file offset 0x62000.
 *
 * Run: node tests/testrom_reader.mjs
 */
import { loadRom, readMem, holdKey } from '../tools/gb_harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rom = path.join(root, 'roms', 'testrom-mbc5.gb');
const noi = path.join(root, 'roms', 'testrom-mbc5.noi');
const LOG_OFS = 0x62000;
const REC = 8;

function symbols() {
  const map = {};
  for (const line of fs.readFileSync(noi, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^DEF _([A-Za-z0-9_]+) (0x[0-9A-Fa-f]+)/);
    if (m) map[m[1]] = parseInt(m[2], 16);
  }
  return map;
}
const S = symbols();

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

function record(value) {
  const lo = value & 0xff;
  const hi = (value >> 8) & 0xff;
  return [0x54, 0x46, lo, hi, (lo ^ hi ^ 0xa5) & 0xff, 0x5a, 0, 0];
}

function imageWith(records) {
  const img = Buffer.from(fs.readFileSync(rom));
  records.forEach((value, i) => {
    Buffer.from(record(value)).copy(img, LOG_OFS + i * REC);
  });
  return img;
}

const tempFiles = [];
function boot(img) {
  const file = path.join(os.tmpdir(), `hc007-testrom-${process.pid}-${tempFiles.length}.gb`);
  fs.writeFileSync(file, img);
  tempFiles.push(file);
  const gb = loadRom(file, undefined, { skipTitle: true });
  for (let i = 0; i < 60; i++) gb.doFrame();
  return gb;
}
process.on('exit', () => {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* best effort */ }
  }
});

function u16(gb, addr) {
  const b = readMem(gb, addr, 2);
  return b[0] | (b[1] << 8);
}
function u8(gb, addr) { return readMem(gb, addr, 1)[0]; }

/* ------------------------------------------------------------------ */
/* Blank log                                                          */
/* ------------------------------------------------------------------ */

const blank = boot(imageWith([]));
check('blank log: counter starts at 1', u16(blank, S.counter) === 1,
  `counter=${u16(blank, S.counter)}`);
check('blank log: no flash value', u16(blank, S.flash_value) === 0,
  `flash=${u16(blank, S.flash_value)}`);
check('blank log: save state is unknown', u8(blank, S.save_state) === 0,
  `state=${u8(blank, S.save_state)}`);

/* ------------------------------------------------------------------ */
/* Seeded records                                                     */
/* ------------------------------------------------------------------ */

const one = boot(imageWith([0x1234]));
check('seeded 1234 is read from flash', u16(one, S.flash_value) === 0x1234,
  `flash=${u16(one, S.flash_value).toString(16)}`);
check('seeded 1234 becomes the counter', u16(one, S.counter) === 0x1234,
  `counter=${u16(one, S.counter).toString(16)}`);

const two = boot(imageWith([0x1111, 0x2222]));
check('last valid record wins', u16(two, S.flash_value) === 0x2222,
  `flash=${u16(two, S.flash_value).toString(16)}`);

const tomb = boot(imageWith([0x1111, 0]));
check('a level-0 tombstone clears the value', u16(tomb, S.flash_value) === 0 &&
  u16(tomb, S.counter) === 1,
  `flash=${u16(tomb, S.flash_value)} counter=${u16(tomb, S.counter)}`);

/* Torn record: first magic byte present, second missing. */
const tornImg = imageWith([]);
Buffer.from([0x54, 0xff, 0x34, 0x12, 0x83, 0x5a, 0, 0]).copy(tornImg, LOG_OFS);
const torn = boot(tornImg);
check('a record without its full magic is ignored', u16(torn, S.flash_value) === 0,
  `flash=${u16(torn, S.flash_value)}`);

/* Corrupt checksum. */
const badImg = imageWith([]);
Buffer.from([0x54, 0x46, 0x34, 0x12, 0x00, 0x5a, 0, 0]).copy(badImg, LOG_OFS);
const bad = boot(badImg);
check('a corrupt checksum is ignored', u16(bad, S.flash_value) === 0,
  `flash=${u16(bad, S.flash_value)}`);

/* ------------------------------------------------------------------ */
/* SRAM path (works in serverboy)                                     */
/* ------------------------------------------------------------------ */

const save = boot(imageWith([]));
holdKey(save, 'A', 6);
for (let i = 0; i < 10; i++) save.doFrame();
check('A increments the counter', u16(save, S.counter) === 2,
  `counter=${u16(save, S.counter)}`);
check('A writes the SRAM copy', u16(save, S.sram_value) === 2,
  `sram=${u16(save, S.sram_value)}`);
check('A fails fast when no flash is present', u8(save, S.save_state) === 2,
  `state=${u8(save, S.save_state)}`);
check('no flash value is created in the emulator', u16(save, S.flash_value) === 0,
  `flash=${u16(save, S.flash_value)}`);

const seededSave = boot(imageWith([0x1234]));
holdKey(seededSave, 'A', 6);
for (let i = 0; i < 10; i++) seededSave.doFrame();
check('A increments a restored flash value', u16(seededSave, S.counter) === 0x1235,
  `counter=${u16(seededSave, S.counter).toString(16)}`);
check('the seeded flash value survives the failed write',
  u16(seededSave, S.flash_value) === 0x1234,
  `flash=${u16(seededSave, S.flash_value).toString(16)}`);

console.log(failures === 0 ? 'Test ROM reader passed' : `Test ROM reader FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
