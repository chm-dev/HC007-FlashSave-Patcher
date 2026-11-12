#!/usr/bin/env node
/*
 * Trace cartridge-SRAM and mapper-register accesses while a ROM runs.
 *
 * This is the main dynamic tool for per-game save investigation.  It wraps
 * serverboy's memory readers/writers, records (pc, ROM bank, SRAM bank,
 * address) for every 0xA000..0xBFFF access, and reports the hottest PCs.  The
 * hot write PCs are usually the game's save routine (or its checksum/verify
 * helper); the hot read PCs are the load/verify path.
 *
 * Usage:
 *   node tools/sram_trace.mjs game.gb --frames 600
 *   node tools/sram_trace.mjs game.gb --script "wait:200;tap:START:30;tap:A:60;hold:RIGHT:600"
 *   node tools/sram_trace.mjs game.gb --script-file games/foo/trace.json --json out.json
 *   node tools/sram_trace.mjs game.gb --sram save.sav --dump-sram after.sav
 *
 * Script steps (semicolon separated):
 *   wait:N                 run N frames
 *   tap:KEY:N              hold KEY for 2 frames, then run N frames
 *   hold:KEY[,KEY]:N       hold keys for N frames
 *   mark:NAME              record the current frame as a marker
 *   shot:PATH              save a PNG screenshot
 *
 * Keys: RIGHT LEFT UP DOWN A B SELECT START
 *
 * The emulator drops ROM writes, so this tool finds *SRAM* behaviour only.
 * Flash programming is tested on the real cart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRom, savePng } from './gb_harness.mjs';

function coreOf(gb) {
  return gb[Object.keys(gb)[0]].gameboy;
}

function usage() {
  console.error(`usage: node tools/sram_trace.mjs <rom> [options]

  --frames N            run N frames when no script is given
  --script "steps"      scripted input (see the header of this file)
  --script-file PATH    read a script from a file (JSON array or text)
  --sram PATH           load initial SRAM bytes
  --dump-sram PATH      write SRAM after the run
  --json PATH           write the full trace report as JSON
  --shot PATH           save a screenshot after the run
  --no-mapper           do not trace mapper-register writes
  --all                 print every event, not just the top 40
  --no-title-skip       boot normally (do not pass skipTitle to the harness)

The harness defaults to DMG mode.  Set GB_CGB=1 in the environment for CGB.`);
  process.exit(2);
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

export function traceRom(romPath, options = {}) {
  const saveData = options.sram ? fs.readFileSync(options.sram) : undefined;
  const gb = loadRom(romPath, saveData, {
    skipTitle: options.skipTitle !== false,
    cgb: options.cgb || process.env.GB_CGB === '1',
  });
  const core = coreOf(gb);

  const read = new Map();       // key -> aggregate
  const write = new Map();
  const mapper = new Map();     // key -> aggregate
  const pageWrites = new Array(32).fill(0);
  const pageReads = new Array(32).fill(0);
  const events = [];            // optional detailed stream
  const markers = [];
  let frame = 0;
  let totalReads = 0;
  let totalWrites = 0;
  let totalMapperWrites = 0;

  function bankOf(obj) {
    if (typeof obj.ROMBank1offs === 'number') return obj.ROMBank1offs;
    if (typeof obj.currentROMBank === 'number') return obj.currentROMBank >> 14;
    return 0;
  }

  function record(map, type, parent, address, value) {
    const pc = parent.programCounter & 0xFFFF;
    // 0x0000-0x3FFF is always bank 0 regardless of the bank register.
    const romBank = pc < 0x4000 ? 0 : bankOf(parent);
    const sramBank = (parent.currMBCRAMBank || 0) & 0xFF;
    const key = `${type}:${pc.toString(16)}:${romBank.toString(16)}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        type, pc, romBank, sramBank,
        count: 0,
        minAddr: address,
        maxAddr: address,
        firstFrame: frame,
        lastFrame: frame,
        values: [],
        enabled: 0,
      };
      map.set(key, entry);
    }
    entry.count++;
    entry.lastFrame = frame;
    entry.sramBank = sramBank;
    if (address < entry.minAddr) entry.minAddr = address;
    if (address > entry.maxAddr) entry.maxAddr = address;
    if (entry.values.length < 8 && !entry.values.includes(value)) {
      entry.values.push(value);
    }
    if (parent.MBCRAMBanksEnabled) entry.enabled++;
    const page = (address - 0xA000) >> 8;
    if (type === 'write') pageWrites[page]++;
    else pageReads[page]++;
    if (options.events) {
      events.push({ frame, type, pc, romBank, sramBank, address, value });
    }
  }

  // Wrap every SRAM reader and writer.  This catches both explicit reads and
  // opcode fetches from SRAM (rare, but the wrapper stays correct).
  for (let address = 0xA000; address < 0xC000; address++) {
    const originalRead = core.memoryReader[address];
    const originalWrite = core.memoryWriter[address];
    core.memoryReader[address] = function (parent, addr) {
      const value = originalRead(parent, addr);
      totalReads++;
      record(read, 'read', parent, addr, value);
      return value;
    };
    core.memoryWriter[address] = function (parent, addr, data) {
      totalWrites++;
      record(write, 'write', parent, addr, data);
      return originalWrite(parent, addr, data);
    };
  }

  // Optional mapper-register trace.  These writes explain RAM enable/disable
  // and banking around a save, and the PC is often inside the save routine.
  const mapperRanges = [
    [0x0000, 0x1FFF, 'ram-enable'],
    [0x2000, 0x3FFF, 'rom-bank'],
    [0x4000, 0x5FFF, 'ram-bank'],
    [0x6000, 0x7FFF, 'mode/latch'],
  ];
  if (options.mapper !== false) {
    for (const [start, end, name] of mapperRanges) {
      for (let address = start; address <= end; address++) {
        const original = core.memoryWriter[address];
        core.memoryWriter[address] = function (parent, addr, data) {
          const pc = parent.programCounter & 0xFFFF;
          const key = `${name}:${pc.toString(16)}:${data.toString(16)}`;
          let entry = mapper.get(key);
          if (!entry) {
            entry = {
              type: name, pc, value: data,
              count: 0, firstFrame: frame, lastFrame: frame,
            };
            mapper.set(key, entry);
          }
          entry.count++;
          entry.lastFrame = frame;
          totalMapperWrites++;
          return original(parent, addr, data);
        };
      }
    }
  }

  function tick(count = 1) {
    for (let i = 0; i < count; i++) {
      gb.doFrame();
      frame++;
    }
  }

  function step(op) {
    if (op.op === 'wait' || op.op === 'run') {
      tick(op.frames);
    } else if (op.op === 'tap') {
      for (let i = 0; i < 2; i++) {
        gb.pressKeys([op.key]);
        tick(1);
      }
      tick(op.frames);
    } else if (op.op === 'hold') {
      for (let i = 0; i < op.frames; i++) {
        gb.pressKeys(op.keys);
        tick(1);
      }
    } else if (op.op === 'mark') {
      markers.push({ frame, name: op.name });
    } else if (op.op === 'shot') {
      savePng(gb.getScreen(), op.path);
    }
  }

  if (Array.isArray(options.steps)) {
    for (const op of options.steps) step(op);
  } else {
    tick(options.frames ?? 600);
  }

  const result = {
    rom: romPath,
    frames: frame,
    totalReads,
    totalWrites,
    totalMapperWrites,
    pageWrites,
    pageReads,
    markers,
    reads: [...read.values()].sort((a, b) => b.count - a.count),
    writes: [...write.values()].sort((a, b) => b.count - a.count),
    mapper: [...mapper.values()].sort((a, b) => b.count - a.count),
    events: options.events ? events : undefined,
    sram: options.dumpSram
      ? Array.from(core.MBCRam.slice(0, 0x8000))
      : undefined,
  };

  if (options.dumpSram) {
    fs.writeFileSync(options.dumpSram, Buffer.from(core.MBCRam.slice(0, 0x8000)));
  }
  if (options.shot) {
    savePng(gb.getScreen(), options.shot);
  }
  return { gb, core, result };
}

function fmtEvent(entry) {
  const range = entry.minAddr === entry.maxAddr
    ? `0x${entry.minAddr.toString(16).toUpperCase().padStart(4, '0')}`
    : `0x${entry.minAddr.toString(16).toUpperCase().padStart(4, '0')}-`
      + `0x${entry.maxAddr.toString(16).toUpperCase().padStart(4, '0')}`;
  const values = entry.values.map((v) => v.toString(16).padStart(2, '0')).join(' ');
  return `  0x${entry.pc.toString(16).toUpperCase().padStart(4, '0')}  `
    + `bank ${entry.romBank.toString(16).toUpperCase().padStart(2, '0')}  `
    + `${String(entry.count).padStart(7)}  ${range.padEnd(11)} `
    + `frames ${String(entry.firstFrame).padStart(5)}-${String(entry.lastFrame).padEnd(5)} `
    + `vals ${values}`;
}

function printReport(result, all) {
  console.log(`ROM: ${result.rom}`);
  console.log(`frames=${result.frames} SRAM reads=${result.totalReads} `
    + `writes=${result.totalWrites} mapper writes=${result.totalMapperWrites}`);
  if (result.markers.length) {
    console.log('markers: ' + result.markers
      .map((m) => `${m.name}@${m.frame}`).join(', '));
  }
  console.log();
  console.log('SRAM page writes:', Array.from({ length: 32 }, (_, p) =>
    `${p.toString(16).padStart(2, '0')}:${String(result.pageWrites[p]).padStart(5)}`).join(' '));
  console.log('SRAM page reads :', Array.from({ length: 32 }, (_, p) =>
    `${p.toString(16).padStart(2, '0')}:${String(result.pageReads[p]).padStart(5)}`).join(' '));

  const limit = all ? result.writes.length : 40;
  console.log(`\nTop SRAM write PCs (${Math.min(limit, result.writes.length)} of ${result.writes.length}):`);
  console.log(`  pc      bank    count  address      frames               values`);
  for (const entry of result.writes.slice(0, limit)) console.log(fmtEvent(entry));

  const readLimit = all ? result.reads.length : 40;
  console.log(`\nTop SRAM read PCs (${Math.min(readLimit, result.reads.length)} of ${result.reads.length}):`);
  console.log(`  pc      bank    count  address      frames               values`);
  for (const entry of result.reads.slice(0, readLimit)) console.log(fmtEvent(entry));

  const mapperLimit = all ? result.mapper.length : 30;
  console.log(`\nMapper-register writes (${Math.min(mapperLimit, result.mapper.length)} of ${result.mapper.length}):`);
  for (const entry of result.mapper.slice(0, mapperLimit)) {
    console.log(`  0x${entry.pc.toString(16).toUpperCase().padStart(4, '0')}  `
      + `${entry.type.padEnd(10)} value 0x${entry.value.toString(16).padStart(2, '0')} `
      + `count ${String(entry.count).padStart(6)} frames ${entry.firstFrame}-${entry.lastFrame}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--frames') args.frames = Number(argv[++i]);
    else if (a === '--script') args.script = argv[++i];
    else if (a === '--script-file') args.scriptFile = argv[++i];
    else if (a === '--sram') args.sram = argv[++i];
    else if (a === '--dump-sram') args.dumpSram = argv[++i];
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--shot') args.shot = argv[++i];
    else if (a === '--no-mapper') args.mapper = false;
    else if (a === '--all') args.all = true;
    else if (a === '--events') args.events = true;
    else if (a === '--no-title-skip') args.skipTitle = false;
    else if (a === '--rom') args.rom = argv[++i];
    else if (!args.rom && !a.startsWith('-')) args.rom = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    usage();
  }
  if (!args.rom) usage();
  if (args.scriptFile) args.steps = loadScript(args.scriptFile);
  else if (args.script) args.steps = parseScript(args.script);
  args.events = args.events || false;
  const { result } = traceRom(args.rom, args);
  printReport(result, args.all);
  if (args.json) {
    const out = { ...result };
    delete out.sram;
    fs.mkdirSync(path.dirname(args.json), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify(out, null, 2) + '\n');
    console.log(`\nwrote ${args.json}`);
  }
  if (args.shot) console.log(`saved ${args.shot}`);
}
