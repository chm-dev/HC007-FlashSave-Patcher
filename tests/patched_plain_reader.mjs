#!/usr/bin/env node
/*
 * Reader-path regression for the patched plain ROM.
 *
 * The patcher injects the journal blob into plain-mbc5.gb (boot restore +
 * VBlank hook).  Emulators have no flash model, so the hook skips writes; this
 * test seeds page records into the log and checks the boot restore.
 *
 * Log: bank 0x18, CPU 0x6000 -> file offset 0x62000.
 * Record: 'J','P', page, 256 data, checksum, 0x5A.
 *
 * Run: node tests/patched_plain_reader.mjs
 */
import { loadRom, readMem, holdKey } from '../tools/gb_harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rom = path.join(root, 'roms', 'plain-mbc5-patched.gb');
const noi = path.join(root, 'roms', 'plain-mbc5.noi');
const LOG_OFS = 0x62000;
const REC = 261;

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

/* The plain ROM's save record lives at 0xA100, i.e. page 1 offset 0. */
function pageData(value) {
  const data = Buffer.alloc(256, 0);
  const lo = value & 0xff;
  const hi = (value >> 8) & 0xff;
  data[0] = 0x50; data[1] = 0x53;          // 'P','S'
  data[2] = lo; data[3] = hi;
  data[4] = (lo ^ hi ^ 0xa5) & 0xff;
  data[5] = 0x5a;
  return data;
}

function pageRecord(page, data, checksumOverride = null) {
  const rec = Buffer.alloc(REC, 0);
  rec[0] = 0x4a; rec[1] = 0x50; rec[2] = page;
  data.copy(rec, 3);
  let sum = (page ^ 0xa5) & 0xff;
  for (const b of data) sum = (sum + b) & 0xff;
  rec[259] = checksumOverride === null ? sum : checksumOverride;
  rec[260] = 0x5a;
  return rec;
}

function imageWith(records) {
  const img = Buffer.from(fs.readFileSync(rom));
  records.forEach((rec, i) => rec.copy(img, LOG_OFS + i * REC));
  return img;
}

const tempFiles = [];
function boot(img) {
  const file = path.join(os.tmpdir(), `hc007-plain-${process.pid}-${tempFiles.length}.gb`);
  fs.writeFileSync(file, img);
  tempFiles.push(file);
  const gb = loadRom(file, undefined, { skipTitle: true });
  for (let i = 0; i < 240; i++) gb.doFrame();
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

/* ------------------------------------------------------------------ */
/* Boot restore                                                       */
/* ------------------------------------------------------------------ */

const blank = boot(imageWith([]));
check('blank log: counter starts at 1', u16(blank, S.counter) === 1,
  `counter=${u16(blank, S.counter)}`);
check('blank log: SRAM is empty', u16(blank, S.sram_value) === 0,
  `sram=${u16(blank, S.sram_value)}`);

const restored = boot(imageWith([pageRecord(1, pageData(0x1234))]));
check('page 1 record restores the save', u16(restored, S.counter) === 0x1234 &&
  u16(restored, S.sram_value) === 0x1234,
  `counter=${u16(restored, S.counter).toString(16)} sram=${u16(restored, S.sram_value).toString(16)}`);

const lastWins = boot(imageWith([
  pageRecord(1, pageData(0x1111)),
  pageRecord(1, pageData(0x2222)),
]));
check('the later page record wins', u16(lastWins, S.counter) === 0x2222,
  `counter=${u16(lastWins, S.counter).toString(16)}`);

const badSum = boot(imageWith([pageRecord(1, pageData(0x1234), 0x00)]));
check('a bad page checksum is ignored', u16(badSum, S.counter) === 1,
  `counter=${u16(badSum, S.counter)}`);

const badPage = boot(imageWith([pageRecord(32, pageData(0x1234))]));
check('an out-of-range page is ignored', u16(badPage, S.counter) === 1,
  `counter=${u16(badPage, S.counter)}`);

const torn = imageWith([]);
Buffer.from([0x4a, 0x50, 1, 0x34, 0x12, 0x83, 0x5a, 0]).copy(torn, LOG_OFS);
const tornGb = boot(torn);
check('a short/torn record is ignored', u16(tornGb, S.counter) === 1,
  `counter=${u16(tornGb, S.counter)}`);

/* ------------------------------------------------------------------ */
/* SRAM path                                                          */
/* ------------------------------------------------------------------ */

const save = boot(imageWith([]));
holdKey(save, 'A', 6);
for (let i = 0; i < 10; i++) save.doFrame();
check('A increments the counter', u16(save, S.counter) === 2,
  `counter=${u16(save, S.counter)}`);
check('A writes the SRAM copy', u16(save, S.sram_value) === 2,
  `sram=${u16(save, S.sram_value)}`);

const seededSave = boot(imageWith([pageRecord(1, pageData(0x1234))]));
holdKey(seededSave, 'A', 6);
for (let i = 0; i < 10; i++) seededSave.doFrame();
check('A increments a restored save', u16(seededSave, S.counter) === 0x1235,
  `counter=${u16(seededSave, S.counter).toString(16)}`);
check('the restored save is written to SRAM', u16(seededSave, S.sram_value) === 0x1235,
  `sram=${u16(seededSave, S.sram_value).toString(16)}`);

console.log(failures === 0 ? 'Patched plain reader passed' : `Patched plain reader FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
