#!/usr/bin/env node
/*
 * REFERENCE ONLY: copied from the Robbo DMG port.
 *
 * It reads Robbo .noi symbols and Robbo ROM paths.  Use it as a pattern for
 * seeding records into a ROM copy at file offset bank*0x4000 + (cpu-0x4000)
 * and testing the reader path; adapt the symbol/ROM paths for this project.
 *
 * Checkpoint 30: HC007 flash save reader.
 *
 * The `-Cart hc007` build targets the bootleg HC007-BGA-V2 cart (M29W640
 * flash, 32 KiB SRAM, no battery).  Progress is also appended to a log inside
 * the flash sector at 0x70000 (see gb/src/gb/flashsave.c).  Emulators drop
 * flash writes, so this test exercises the reader by pre-seeding records into
 * the image's 0xFF padding at file offset 0x72000 (= bank 0x1C, CPU 0x6000):
 *
 * - The image is 512 KiB (header 0x148 = 0x04) with 32 KiB RAM (0x149 = 0x03)
 *   and everything above the 16 game banks is blank padding.
 * - A blank sector means "no save": START begins level 1 without a menu.
 * - A valid record is picked up at boot: START opens the start-level menu at
 *   that level and the second START begins there.
 * - The log is append-only; the last valid record wins.
 * - A tombstone (level 0) deletes the save.
 * - Torn (missing magic) and corrupt (bad inverse/range) records are ignored
 *   and the previous valid record survives.
 *
 * Run: node gb/tests/checkpoint30.mjs
 */
import { loadRom, readMem, holdKey } from '../tools/gb_harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rom = path.join(root, 'roms', 'robbo-hc007.gb');
const noi = path.join(root, 'roms', 'robbo-hc007.noi');
const titleDataC = path.join(root, 'gb', 'src', 'gen', 'title_data.c');
const titleDataH = path.join(root, 'gb', 'src', 'gen', 'title_data.h');

/* File offset of the flash log window used by flashsave.c. */
const FLASH_OFS = 0x72000;
const FS_REC = 8;
const LEVEL_COUNT = 56;

function symbols() {
  const text = fs.readFileSync(noi, 'utf8');
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^DEF _([A-Za-z0-9_]+) (0x[0-9A-Fa-f]+)/);
    if (m) map[m[1]] = parseInt(m[2], 16);
  }
  return map;
}

const S = symbols();
const T = {};
for (const m of fs.readFileSync(titleDataH, 'utf8')
  .matchAll(/#define (TITLE_[A-Z0-9_]+) (\d+)/g)) {
  T[m[1]] = Number(m[2]);
}

const titleC = fs.readFileSync(titleDataC, 'utf8');
const hudDigits = [...titleC.match(
  /const uint8_t title_hud_digits\[10\]\[2\] = \{([\s\S]*?)\};/)
  [1].matchAll(/\{\s*(\d+)\s*,\s*(\d+)\s*\}/g)]
  .map(m => [Number(m[1]), Number(m[2])]);

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

function coreOf(gb) {
  return gb[Object.keys(gb)[0]].gameboy;
}

function lcdc(gb) {
  return readMem(gb, 0xFF40, 1)[0];
}

function runFrames(gb, n) {
  for (let i = 0; i < n; i++) gb.doFrame();
}

function waitFor(gb, fn, max) {
  for (let i = 0; i < max; i++) {
    if (fn()) return true;
    gb.doFrame();
  }
  return fn();
}

function waitForTitle(gb) {
  const core = coreOf(gb);
  core.JoyPad = 0xff;
  for (let i = 0; i < 200; i++) {
    if ((lcdc(gb) & 0x80) === 0) break;
    gb.doFrame();
  }
  for (let i = 0; i < 300; i++) {
    const l = lcdc(gb);
    if ((l & 0x80) && (l & 0x01) && !(l & 0x20)) break;
    gb.doFrame();
  }
}

function levelSettled(gb, core, level) {
  return readMem(gb, S.level_planet, 1)[0] === level &&
    readMem(gb, S.intro_active, 1)[0] === 0 &&
    readMem(gb, S.robbo_busy, 1)[0] === 0 &&
    readMem(gb, S.screws_left, 1)[0] === readMem(gb, S.level_screw, 1)[0] &&
    (lcdc(gb) & 0x80) !== 0 &&
    core.windowY === 128;
}

function waitLevel(gb, core, level) {
  return waitFor(gb, () => levelSettled(gb, core, level), 1800);
}

function waitNewLevel(gb, core, level) {
  if (!waitFor(gb, () => readMem(gb, S.intro_active, 1)[0] === 1, 1800)) return false;
  return waitLevel(gb, core, level);
}

function waitGameStart(gb, core, level) {
  return waitNewLevel(gb, core, level) && (lcdc(gb) & 0x20) !== 0;
}

function titleTile(core, x, y) {
  return core.BGCHRBank1[y * 32 + x];
}

function titleRow(core, y) {
  /* Only need the menu headings; non-text tiles can print as '?'. */
  const font = new Map();
  for (const name of ['title_font_white', 'title_font_gray']) {
    const re = new RegExp(
      `const uint8_t ${name}\\[[^\\]]*\\] = \\{([\\s\\S]*?)\\};`);
    const m = titleC.match(re);
    if (!m) throw new Error(`missing ${name}`);
    const bytes = [...m[1].matchAll(/0x([0-9A-Fa-f]{2})/g)]
      .map(x => parseInt(x[1], 16));
    for (let i = 0; i < 128; i++) if (bytes[i] !== 0xFF) font.set(bytes[i], i);
  }
  const digits = new Set(hudDigits.flat());
  let out = '';
  for (let x = 0; x < 20; x++) {
    const tile = titleTile(core, x, y);
    if (tile === T.TITLE_BLACK_TILE) out += ' ';
    else if (font.has(tile)) out += String.fromCharCode(font.get(tile));
    else if (digits.has(tile)) out += '#';
    else out += '?';
  }
  return out;
}

function titleMenuReady(core) {
  return titleRow(core, 12).includes('STARTING LEVEL') &&
    titleRow(core, 16).includes('DELETE SAVE GAME');
}

function titleLevelDigits(core) {
  const tens = titleTile(core, 9, 13);
  const ones = titleTile(core, 10, 13);
  for (let d = 0; d < 10; d++) {
    if (tens === hudDigits[d][0]) {
      for (let o = 0; o < 10; o++) {
        if (ones === hudDigits[o][0]) return `${d}${o}`;
      }
    }
  }
  return '??';
}

function waitTitleMenu(gb, core) {
  return waitFor(gb, () => titleMenuReady(core), 120);
}

/* ------------------------------------------------------------------ */
/* Flash record helpers                                               */
/* ------------------------------------------------------------------ */

/* The 8-byte record (level 0 = delete tombstone). */
function flashRecord(level) {
  return [
    0x52, 0x46,             /* 'R','F' */
    level & 0xff,
    (level & 0xff) ^ 0xff,  /* inverse */
    0xa5, 0x5a, 0x00, 0x00,
  ];
}

const romImage = fs.readFileSync(rom);

function imageWith(records) {
  const img = Buffer.from(romImage);
  records.forEach((level, i) => {
    Buffer.from(flashRecord(level)).copy(img, FLASH_OFS + i * FS_REC);
  });
  return img;
}

/* Writes one arbitrary slot (used for torn/corrupt cases). */
function imageWithSlot(records, slot, bytes) {
  const img = imageWith(records);
  Buffer.from(bytes).copy(img, FLASH_OFS + slot * FS_REC);
  return img;
}

const tempFiles = [];
function bootImage(img) {
  const file = path.join(os.tmpdir(), `robbo-hc007-ck30-${process.pid}-${tempFiles.length}.gb`);
  fs.writeFileSync(file, img);
  tempFiles.push(file);
  const gb = loadRom(file, undefined, { skipTitle: true });
  waitForTitle(gb);
  runFrames(gb, 40);
  return gb;
}

function cleanup() {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* best effort */ }
  }
}
process.on('exit', cleanup);

/* ------------------------------------------------------------------ */
/* Image layout                                                       */
/* ------------------------------------------------------------------ */

check('HC007 image is 512 KiB', romImage.length === 512 * 1024,
  `${romImage.length} bytes`);
check('ROM header is MBC5+RAM', romImage[0x147] === 0x1b,
  `0x${romImage[0x147].toString(16)}`);
check('ROM header advertises 32 x 16 KiB banks',
  romImage[0x148] === 0x04, `0x${romImage[0x148].toString(16)}`);
check('ROM header advertises 32 KiB RAM', romImage[0x149] === 0x03,
  `0x${romImage[0x149].toString(16)}`);
check('the flash save sector is 0xFF padding in the image',
  romImage.subarray(0x40000).every(b => b === 0xff),
  `0x72000=0x${romImage[FLASH_OFS].toString(16)}`);

/* ------------------------------------------------------------------ */
/* Blank flash: no save                                               */
/* ------------------------------------------------------------------ */

const blank = bootImage(romImage);
const blankCore = coreOf(blank);
holdKey(blank, 'START', 6);
check('blank flash starts level 1 without the start-level menu',
  waitGameStart(blank, blankCore, 1) &&
  !titleMenuReady(blankCore),
  `level=${readMem(blank, S.level_planet, 1)[0]}`);

/* ------------------------------------------------------------------ */
/* A valid record is honoured                                         */
/* ------------------------------------------------------------------ */

const nine = bootImage(imageWith([9]));
const nineCore = coreOf(nine);
holdKey(nine, 'START', 6);
check('a flash record for level 9 opens the start-level menu',
  waitTitleMenu(nine, nineCore), `row12=${JSON.stringify(titleRow(nineCore, 12))}`);
check('the menu shows the flashed level 09',
  titleLevelDigits(nineCore) === '09', titleLevelDigits(nineCore));
holdKey(nine, 'START', 6);
check('START on the menu begins level 9',
  waitGameStart(nine, nineCore, 9),
  `level=${readMem(nine, S.level_planet, 1)[0]}`);

/* ------------------------------------------------------------------ */
/* Append-only log: the last valid record wins                        */
/* ------------------------------------------------------------------ */

const appended = bootImage(imageWith([9, 12]));
const appendedCore = coreOf(appended);
holdKey(appended, 'START', 6);
check('two records: the later level 12 wins',
  waitTitleMenu(appended, appendedCore) &&
  titleLevelDigits(appendedCore) === '12', titleLevelDigits(appendedCore));

/* ------------------------------------------------------------------ */
/* Tombstone deletes the save                                         */
/* ------------------------------------------------------------------ */

const deleted = bootImage(imageWith([9, 12, 0]));
const deletedCore = coreOf(deleted);
holdKey(deleted, 'START', 6);
check('a level-0 tombstone deletes the flash save',
  waitGameStart(deleted, deletedCore, 1) &&
  !titleMenuReady(deletedCore),
  `level=${readMem(deleted, S.level_planet, 1)[0]}`);

/* ------------------------------------------------------------------ */
/* Torn and corrupt records are ignored                               */
/* ------------------------------------------------------------------ */

/* Torn write: constants and level are present, the 'R','F' magic is not. */
const torn = bootImage(imageWithSlot([9], 1, [
  0xff, 0xff, 12, 12 ^ 0xff, 0xa5, 0x5a, 0x00, 0x00,
]));
const tornCore = coreOf(torn);
holdKey(torn, 'START', 6);
check('a record without its magic is ignored, the older save survives',
  waitTitleMenu(torn, tornCore) && titleLevelDigits(tornCore) === '09',
  titleLevelDigits(tornCore));

/* Corrupt record: valid magic but a broken level/inverse pair. */
const corrupt = bootImage(imageWithSlot([9], 1, [
  0x52, 0x46, 12, 0x00, 0xa5, 0x5a, 0x00, 0x00,
]));
const corruptCore = coreOf(corrupt);
holdKey(corrupt, 'START', 6);
check('a corrupt level/inverse pair is ignored',
  waitTitleMenu(corrupt, corruptCore) &&
  titleLevelDigits(corruptCore) === '09', titleLevelDigits(corruptCore));

/* Out-of-range level: the record is well formed but impossible. */
const outOfRange = bootImage(imageWithSlot([], 0, [
  0x52, 0x46, LEVEL_COUNT + 1, (LEVEL_COUNT + 1) ^ 0xff,
  0xa5, 0x5a, 0x00, 0x00,
]));
const outOfRangeCore = coreOf(outOfRange);
holdKey(outOfRange, 'START', 6);
check('a level above LEVEL_COUNT is ignored',
  waitGameStart(outOfRange, outOfRangeCore, 1) &&
  !titleMenuReady(outOfRangeCore),
  `level=${readMem(outOfRange, S.level_planet, 1)[0]}`);

console.log(failures === 0 ? 'Checkpoint 30 passed' : `Checkpoint 30 FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
