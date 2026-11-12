#!/usr/bin/env node
/*
 * Trace reads/writes of the joypad register (0xFF00) and record the PCs.
 *
 * Useful for finding a game's input/menu handler.  Run a script that stops on
 * the menu, then inspect the hot PCs with tools/gbdis.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRom } from './gb_harness.mjs';

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

export function traceJoypad(romPath, options = {}) {
  const gb = loadRom(romPath, options.sram ? fs.readFileSync(options.sram) : undefined, {
    skipTitle: true,
  });
  const core = coreOf(gb);
  const reads = new Map();
  const writes = new Map();
  let frame = 0;

  function wrapRead(original) {
    return function (parent, addr) {
      const value = original(parent, addr);
      const pc = parent.programCounter & 0xFFFF;
      const key = `${pc.toString(16)}:${value.toString(16)}`;
      const entry = reads.get(key) || { pc, value, count: 0, first: frame, last: frame };
      entry.count++;
      entry.last = frame;
      reads.set(key, entry);
      return value;
    };
  }
  function wrapWrite(original) {
    return function (parent, addr, value) {
      const pc = parent.programCounter & 0xFFFF;
      const key = `${pc.toString(16)}:${value.toString(16)}`;
      const entry = writes.get(key) || { pc, value, count: 0, first: frame, last: frame };
      entry.count++;
      entry.last = frame;
      writes.set(key, entry);
      return original(parent, addr, value);
    };
  }
  const reader = core.memoryHighReader[0x00];
  core.memoryHighReader[0x00] = wrapRead(reader);
  const writer = core.memoryHighWriter[0x00];
  core.memoryHighWriter[0x00] = wrapWrite(writer);
  if (core.memoryReader[0xFF00]) core.memoryReader[0xFF00] = wrapRead(core.memoryReader[0xFF00]);
  if (core.memoryWriter[0xFF00]) core.memoryWriter[0xFF00] = wrapWrite(core.memoryWriter[0xFF00]);

  for (const step of options.steps || []) {
    if (step.op === 'wait') {
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
    }
  }

  return {
    reads: [...reads.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    writes: [...writes.values()].sort((a, b) => b.count - a.count).slice(0, 40),
  };
}

function main() {
  const argv = process.argv.slice(2);
  let rom, script = null, scriptFile = null, sram = null, json = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--script') script = argv[++i];
    else if (a === '--script-file') scriptFile = argv[++i];
    else if (a === '--sram') sram = argv[++i];
    else if (a === '--json') json = argv[++i];
    else if (!rom) rom = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!rom) {
    console.error('usage: node tools/joypad_trace.mjs <rom> [--script ...] [--script-file ...] [--sram file] [--json out]');
    process.exit(2);
  }
  const steps = scriptFile ? loadScript(scriptFile) : parseScript(script || 'wait:300');
  const result = traceJoypad(rom, { steps, sram });
  console.log('JOYPAD READS');
  for (const e of result.reads) {
    console.log(`  pc 0x${e.pc.toString(16).padStart(4, '0')} value 0x${e.value.toString(16).padStart(2, '0')} count ${e.count} frames ${e.first}-${e.last}`);
  }
  console.log('JOYPAD WRITES');
  for (const e of result.writes) {
    console.log(`  pc 0x${e.pc.toString(16).padStart(4, '0')} value 0x${e.value.toString(16).padStart(2, '0')} count ${e.count} frames ${e.first}-${e.last}`);
  }
  if (json) {
    fs.writeFileSync(json, JSON.stringify(result, null, 2) + '\n');
    console.log(`wrote ${json}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
