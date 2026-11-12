#!/usr/bin/env node
/*
 * Drive the SML2 file-select route and try to reach a real life-loss event.
 *
 * The goal is to find a repeatable emulator path that calls the real save
 * writer at 0x3147, so the patched build can be tested against the actual
 * death sequence instead of a forced state-9 write.
 *
 * Usage:
 *   node games/sml2/tools/death_probe.mjs [rom.gb] [--frames N] [--no-right]
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

const args = process.argv.slice(2);
const framesArg = args.indexOf('--frames');
const MAX_FRAMES = framesArg >= 0 ? Number(args[framesArg + 1]) : 12000;
const sramArg = args.indexOf('--sram');
const sramPath = sramArg >= 0 ? args[sramArg + 1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') &&
  !(framesArg >= 0 && i === framesArg + 1) &&
  !(sramArg >= 0 && i === sramArg + 1));
const romPath = positional[0] ||
  path.join(ROOT, 'roms/patch-test-roms/Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb');
const holdRight = !args.includes('--no-right');

const gb = new Gameboy();
gb.loadRom(fs.readFileSync(romPath), sramPath ? fs.readFileSync(sramPath) : undefined);
const core = gb[Object.keys(gb)[0]].gameboy;

// Detect the game's real save writer even when a frame boundary does not
// happen to land inside it. The writer's SRAM stores report a PC inside
// 0x2934..0x2973.
let writerWrites = 0;
let writerPc = -1;
for (let addr = 0xa000; addr < 0xa0f0; addr++) {
  const original = core.memoryWriter[addr];
  core.memoryWriter[addr] = function (parent, a, value) {
    const pc = parent.programCounter & 0xffff;
    if (pc >= 0x2934 && pc <= 0x2973) {
      writerWrites++;
      if (writerPc < 0) writerPc = pc;
    }
    return original(parent, a, value);
  };
}

function mem(addr, len = 1) {
  return Array.from(gb.getMemory(addr, addr + len));
}

function frame(n = 1) {
  for (let i = 0; i < n; i++) gb.doFrame();
}

function tap(key, wait = 30) {
  for (let i = 0; i < 3; i++) {
    core.JoyPad = 0xff;
    gb.pressKeys([key]);
    gb.doFrame();
  }
  core.JoyPad = 0xff;
  frame(wait);
}

function state() {
  return {
    pc: core.programCounter,
    bank: (core.ROMBank1offs || 0) & 0x1ff,
    lives: mem(0xa22c)[0],
    state9b: mem(0xff9b)[0],
    level: mem(0xa201)[0],
    status: mem(0xa2c5)[0],
    slot: mem(0xa2a3)[0],
    a24e: mem(0xa24e)[0],
    lcdc: mem(0xff40)[0],
  };
}

function fmt(s) {
  return `pc=${s.pc.toString(16).padStart(4, '0')} bank=${s.bank.toString(16)} ` +
    `lives=${s.lives.toString(16)} st=${s.state9b.toString(16)} lvl=${s.level.toString(16)} ` +
    `status=${s.status.toString(16)} slot=${s.slot.toString(16)} a24e=${s.a24e.toString(16)} ` +
    `lcdc=${s.lcdc.toString(16)}`;
}

// Title -> file select -> file A -> start.
frame(200);
console.log(`title: ${fmt(state())}`);
tap('START', 120);
console.log(`file select: ${fmt(state())}`);
tap('A', 30);
tap('START', 300);
console.log(`world map: ${fmt(state())}`);
tap('A', 200);
console.log(`level entry: ${fmt(state())}`);

let last = state();
let deaths = 0;
let saveHits = 0;
let deathHits = 0;
let resetHits = 0;

// Watch the two save entry points and the game's life counter.
let lastLives = last.lives;
let lastState9b = last.state9b;
for (let f = 0; f < MAX_FRAMES; f++) {
  if (holdRight) {
    core.JoyPad = 0xff;
    gb.pressKeys(['RIGHT']);
  }
  gb.doFrame();

  const s = state();
  if (f % 100 === 0) console.log(`frame ${f}: ${fmt(s)}`);
  if (s.pc === 0x1967 || s.pc === 0x2934) {
    saveHits++;
    console.log(`frame ${f}: save entry 0x${s.pc.toString(16)} ${fmt(s)}`);
  }
  if (s.pc === 0x3147) {
    deathHits++;
    console.log(`frame ${f}: life-loss save call site ${fmt(s)}`);
  }
  if (s.lives !== lastLives) {
    deaths++;
    console.log(`frame ${f}: lives ${lastLives.toString(16)} -> ${s.lives.toString(16)} ${fmt(s)}`);
    lastLives = s.lives;
  }
  if (s.state9b !== lastState9b) {
    console.log(`frame ${f}: 0xFF9B ${lastState9b.toString(16)} -> ${s.state9b.toString(16)} ${fmt(s)}`);
    lastState9b = s.state9b;
  }
  if (s.pc >= 0x100 && s.pc < 0x150 && (last.pc < 0x100 || last.pc > 0x150)) {
    resetHits++;
    console.log(`frame ${f}: PC entered boot area ${fmt(s)}`);
  }
  last = s;
}
console.log(`done: saveHits=${saveHits} deathHits=${deathHits} livesChanges=${deaths} resetHits=${resetHits} writerWrites=${writerWrites} writerPc=${writerPc >= 0 ? '0x' + writerPc.toString(16) : '-'}`);
console.log(`final: ${fmt(state())}`);
