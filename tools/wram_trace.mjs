#!/usr/bin/env node
/*
 * Trace WRAM (0xC000-0xDFFF) writes while a ROM runs.
 *
 * This is a companion to sram_trace.mjs.  It reports which 256-byte WRAM
 * pages are written during a scripted run, so a patch can pick a scratch
 * area that the game does not use.  (Serverboy reads WRAM directly, so only
 * writes are traced reliably.)
 *
 * Usage:
 *   node tools/wram_trace.mjs game.gb --frames 600
 *   node tools/wram_trace.mjs game.gb --script-file games/foo/trace.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRom, savePng } from './gb_harness.mjs';

function coreOf(gb) {
  return gb[Object.keys(gb)[0]].gameboy;
}

function parseScript(text) {
  const steps = [];
  for (const raw of text.split(';')) {
    const part = raw.trim();
    if (!part) continue;
    const [cmd, ...rest] = part.split(':');
    if (cmd === 'wait' || cmd === 'run') {
      steps.push({ op: 'wait', frames: Number(rest[0]) });
    } else if (cmd === 'tap') {
      steps.push({ op: 'tap', key: rest[0], frames: Number(rest[1] || 8) });
    } else if (cmd === 'hold') {
      steps.push({ op: 'hold', keys: rest[0].split(','), frames: Number(rest[1]) });
    } else if (cmd === 'mark') {
      steps.push({ op: 'mark', name: rest.join(':') });
    } else if (cmd === 'shot') {
      steps.push({ op: 'shot', path: rest.join(':') });
    } else {
      throw new Error(`unknown script step: ${raw}`);
    }
  }
  return steps;
}

function loadScript(file) {
  const text = fs.readFileSync(file, 'utf8');
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.steps;
  }
  return parseScript(text);
}

export function traceWram(romPath, options = {}) {
  const gb = loadRom(romPath, undefined, { skipTitle: true });
  const core = coreOf(gb);
  const pageWrites = new Array(32).fill(0);
  const hotWrites = new Map();
  let frame = 0;
  let totalWrites = 0;

  for (let address = 0xC000; address < 0xE000; address++) {
    const originalWrite = core.memoryWriter[address];
    core.memoryWriter[address] = function (parent, addr, value) {
      const page = (addr - 0xC000) >> 8;
      pageWrites[page]++;
      totalWrites++;
      const pc = parent.programCounter & 0xFFFF;
      const key = `${pc.toString(16)}:${addr.toString(16)}`;
      const entry = hotWrites.get(key) || { pc, addr, count: 0 };
      entry.count++;
      hotWrites.set(key, entry);
      return originalWrite(parent, addr, value);
    };
  }

  const steps = options.steps || [];
  for (const step of steps) {
    if (step.op === 'wait' || step.op === 'run') {
      for (let i = 0; i < step.frames; i++) { gb.doFrame(); frame++; }
    } else if (step.op === 'tap') {
      gb.pressKey(step.key);
      gb.doFrame();
      gb.pressKey(step.key);
      gb.doFrame();
      frame += 2;
      for (let i = 0; i < step.frames; i++) { gb.doFrame(); frame++; }
    } else if (step.op === 'hold') {
      for (let i = 0; i < step.frames; i++) {
        gb.pressKeys(step.keys);
        gb.doFrame();
        frame++;
      }
    } else if (step.op === 'shot') {
      savePng(gb.getScreen(), step.path);
    }
  }

  const hot = [...hotWrites.values()].sort((a, b) => b.count - a.count).slice(0, 30);
  return { totalWrites, pageWrites, hot };
}

function main() {
  const argv = process.argv.slice(2);
  let rom, frames = 600, script = null, scriptFile = null, json = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--frames') frames = Number(argv[++i]);
    else if (a === '--script') script = argv[++i];
    else if (a === '--script-file') scriptFile = argv[++i];
    else if (a === '--json') json = argv[++i];
    else if (!rom) rom = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!rom) {
    console.error('usage: node tools/wram_trace.mjs <rom> [--frames N] [--script ...] [--script-file ...] [--json out.json]');
    process.exit(2);
  }
  const steps = scriptFile ? loadScript(scriptFile)
    : script ? parseScript(script)
      : [{ op: 'wait', frames }];
  const result = traceWram(rom, { steps });
  console.log(`WRAM writes ${result.totalWrites}`);
  console.log('page writes:', result.pageWrites.join(' '));
  console.log('hot writes:');
  for (const e of result.hot) {
    console.log(`  pc 0x${e.pc.toString(16).padStart(4, '0')} addr 0x${e.addr.toString(16)} count ${e.count}`);
  }
  if (json) {
    fs.writeFileSync(json, JSON.stringify(result, null, 2) + '\n');
    console.log(`wrote ${json}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
