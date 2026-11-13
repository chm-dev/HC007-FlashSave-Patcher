#!/usr/bin/env node
/*
 * Emulator tests for the Donkey Kong HC007 save patch.
 *
 * serverboy drops ROM writes, so a small NOR-flash model covers the 64 KiB
 * log sector (banks 0x20-0x23, CPU 0x4000-0x7FFF).  It models record
 * construction, not real chip timing.
 *
 *   node games/dk/tools/test_save_emulator.mjs [roms/dk-hc007.gb]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadRom, tapKey, savePng } from '../../../tools/gb_harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ROM = process.argv[2] || path.join(ROOT, 'roms/dk-hc007.gb');
const OUT = path.join(ROOT, 'games/dk/analysis');
const require = createRequire(import.meta.url);

const SLOT = 0x400, PAY = 0x366;
const SLOTS = Number(process.env.DK_SLOTS || 32);   // 32 = 8 slots per bank in the 0x6000-0x7FFF window
/* offset of slot s inside the 64 KiB log sector model */
const slotBase = (s) => (process.env.DK_SLOTS === '64') ? s * SLOT : (s >> 3) * 0x4000 + 0x2000 + (s & 7) * SLOT;
const coreOf = (gb) => gb[Object.keys(gb)[0]].gameboy;
const wr = (c, a, v) => c.memoryWriter[a](c, a, v & 0xff);
const rd = (c, a) => c.memoryReader[a](c, a);
const frame = (gb, n = 1) => { for (let i = 0; i < n; i++) gb.doFrame(); };
const hex = (v, n = 4) => v.toString(16).toUpperCase().padStart(n, '0');
let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
}

/* ---- NOR flash model ------------------------------------------------- */
function installFlash(gb, seed) {
  const core = coreOf(gb);
  const data = new Uint8Array(0x10000).fill(0xFF);
  if (seed) data.set(seed.subarray(0, 0x10000));
  const st = { mode: 'read', programs: 0, erases: 0, stubEntries: [] };
  const inLog = (p) => (p.ROMBank1offs || 0) >= 0x20 && (p.ROMBank1offs || 0) <= 0x23;
  const off = (p, a) => ((p.ROMBank1offs || 0) - 0x20) * 0x4000 + (a - 0x4000);

  const idRead = core.memoryReader[0x0000];
  core.memoryReader[0x0000] = (p, a) => (st.mode === 'id' ? 0x20 : idRead(p, a));
  const w0 = core.memoryWriter[0x0AAA];
  core.memoryWriter[0x0AAA] = (p, a, v) => {
    if (v === 0xA0) st.mode = 'program';
    else if (v === 0x80) st.mode = 'erase';
    else if (v === 0x90) st.mode = 'id';
    return w0(p, a, v);
  };
  for (let a = 0x4000; a < 0x8000; a++) {
    const ow = core.memoryWriter[a];
    core.memoryWriter[a] = (p, ad, v) => {
      if (ad === 0x4000 && v === 0xF0) st.mode = 'read';
      /* On the HC007 (MBC5 header) 0x4000-0x5FFF is the RAM-bank register: a flash
       * program/erase data write there never reaches the chip (docs/FLASH_SAVE_METHOD.md).
       * Fail loudly instead of letting the DQ7 poll spin for minutes. */
      if (ad < 0x6000 && inLog(p) && (st.mode === 'program' || st.mode === 'erase')) {
        throw new Error(`flash ${st.mode} data write to 0x${ad.toString(16)} in bank 0x${(p.ROMBank1offs || 0).toString(16)} hits the RAM-bank register, not the chip`);
      }
      if (inLog(p)) {
        if (st.mode === 'program') {
          data[off(p, ad)] &= v;           // NOR: programming can only clear bits
          st.programs++; st.mode = 'read'; return;
        }
        if (st.mode === 'erase' && v === 0x30) {
          data.fill(0xFF); st.erases++; st.mode = 'read'; return;
        }
      }
      return ow(p, ad, v);
    };
    const or = core.memoryReader[a];
    core.memoryReader[a] = (p, ad) => (inLog(p) ? data[off(p, ad)] : or(p, ad));
  }
  /* log what the commit stub sees on entry */
  const orig = core.memoryReader[0x3910];
  core.memoryReader[0x3910] = (p, ad) => {
    st.stubEntries.push({ ime: core.IME, shadow: rd(core, 0xFF8C), bank: core.ROMBank1offs || 0, sp: core.stackPointer });
    return orig(p, ad);
  };
  return { core, data, st };
}

function boot(sram, flashSeed, { startTaps = 2 } = {}) {
  const gb = loadRom(ROM, sram, { skipTitle: true });
  const f = installFlash(gb, flashSeed);
  frame(gb, 300);
  for (let i = 0; i < startTaps; i++) { tapKey(gb, 'START', 10); frame(gb, 400); }
  return { gb, ...f };
}

const sramOf = (core) => Uint8Array.from(core.MBCRam.slice(0, 0x2000));
const payloadOf = (sram) => {
  const p = new Uint8Array(PAY);
  p.set(sram.subarray(0x0000, 0x0190), 0);
  p.set(sram.subarray(0x1E2A, 0x2000), 0x190);
  return p;
};
function slots(data) {
  const out = [];
  for (let s = 0; s < SLOTS; s++) {
    const b = slotBase(s);
    if (data[b] === 0xFF) { out.push({ s, state: 'free' }); continue; }
    const ok = data[b] === 0x44 && data[b + 1] === 0x4B && data[b + 0x3FE] === 0x5A && data[b + 0x3FF] === 0xA5;
    out.push({ s, state: ok ? 'valid' : 'torn' });
  }
  return out;
}
const validSlots = (d) => slots(d).filter((x) => x.state === 'valid').map((x) => x.s);
const slotPayload = (d, s) => d.subarray(slotBase(s) + 4, slotBase(s) + 4 + PAY);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* call a routine as if from the game: bank/shadow set, return into WRAM loop */
function call(gb, core, bank, pc, frames = 400) {
  wr(core, 0xDF00, 0x18); wr(core, 0xDF01, 0xFE);
  wr(core, 0x0000, 0x0A);                     // SRAM enabled (inside the bracket)
  core.memoryWriter[0xC86A](core, 0xC86A, 0x0A);
  wr(core, 0xFFFF, 0);
  wr(core, 0x2000, bank); wr(core, 0xFF8C, bank);
  core.stackPointer = 0xFFF0;
  wr(core, 0xFFEE, 0x00); wr(core, 0xFFEF, 0xDF);
  core.stackPointer = 0xFFEE;
  core.IME = true;
  core.programCounter = pc;
  frame(gb, frames);
  return core.programCounter === 0xDF00;
}

const emptyShot = (gb, name) => savePng(gb.getScreenPixels ? gb.getScreenPixels() : gb.getScreen(), path.join(OUT, name));

/* ====================================================================== */
console.log(`ROM: ${ROM}`);
fs.mkdirSync(OUT, { recursive: true });

/* T1: boot to file select with an empty log */
let t = boot(undefined, undefined);
let sram = sramOf(t.core);
check(sram[0x1FFA] === 0x09 && sram[0x1FFB] === 0x04, 'T1 empty boot: game init wrote the BFFA signature');
let v = validSlots(t.data);
check(v.length >= 1, `T1 init tail is hooked: log has ${v.length} valid record(s) after first boot`);
check(t.st.programs > 0, `T1 flash programmed (${t.st.programs} byte programs)`);
check(t.st.stubEntries.every((e) => e.shadow === e.bank), `T1 FF8C == mapped bank at every stub entry (${t.st.stubEntries.length} entries)`);
console.log('    stub entries:', JSON.stringify(t.st.stubEntries.slice(0, 4)));
const base1 = v.length;

/* T3: progress writer via its real tail, slot 0 selected */
wr(t.core, 0xCE20, 0);                         // selected file 0
wr(t.core, 0xDA43, 0x05);
const n0 = validSlots(t.data).length;
check(call(t.gb, t.core, 1, 0x4CB3), 'T3 progress writer 4CB3 returned to caller');
check((t.core.ROMBank1offs || 0) === 1, 'T3 caller bank restored (1)');
check(t.core.IME === true, 'T3 interrupts re-enabled after the stub');
let v3 = validSlots(t.data);
check(v3.length === n0 + 1, `T3 exactly one new record appended (${n0} -> ${v3.length})`);
sram = sramOf(t.core);
check(sram[0x1FBF] !== 0 || sram[0x1FC0] === 0x01, 'T3 BFBF/BFC0 slot data present in SRAM');
check(eq(slotPayload(t.data, v3[v3.length - 1]), payloadOf(sram)), 'T3 newest record payload == SRAM payload');
check(sram[0x1FD8] === 0x02 && sram[0x1FD9] === 0x07, 'T3 02/07 marker written by the game');

/* T5: duplicate suppression */
const programsBefore = t.st.programs;
call(t.gb, t.core, 1, 0x4CB3);
check(validSlots(t.data).length === v3.length, 'T5 identical state -> no new record');
check(t.st.programs === programsBefore, 'T5 no flash programming for an identical state');

/* T4: reboot with garbage SRAM + seeded log */
const flashSeed = Uint8Array.from(t.data);
fs.mkdirSync(path.join(ROOT, 'games/dk/build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'games/dk/build/test-flash-progress.bin'), flashSeed);
const garbage = new Uint8Array(0x8000);
for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 2654435761 >>> 7) & 0xFF;
const expected = payloadOf(sram);
const t4 = boot(Buffer.from(garbage), flashSeed);
const s4 = sramOf(t4.core);
check(eq(payloadOf(s4), expected), 'T4 reboot with garbage SRAM: payload restored from the log');
check(s4.subarray(0x190, 0x4B0).every((b) => b === 0), 'T4 A190-A4AF zero after restore (as after a clean init)');
check(s4.subarray(0x14C0, 0x1E2A).every((b) => b === 0), 'T4 non-payload SRAM zeroed (no garbage reaches the game)');
check(t4.st.programs === 0, 'T4 reboot with a valid log did not rewrite flash');
emptyShot(t4.gb, 'dk-test-reboot.png');

/* T7: power-on garbage must not poison the journal (hardware-only failure).
 * Real SRAM powers up with garbage; init only zeroes A000-A4AF and BFBE-BFFF,
 * so BE2A-BFBD (score checksum + backup table) keeps the garbage.  If that is
 * journaled, the validator's A000-sum vs BE2A check fails after the next
 * restore and the game wipes the save. */
const garbageSram = (seed) => { const g = new Uint8Array(0x8000); for (let i = 0; i < g.length; i++) g[i] = ((i + seed) * 2654435761 >>> 7) & 0xFF; return g; };
{
  const a = boot(Buffer.from(garbageSram(1)), undefined);       // garbage SRAM, empty log
  wr(a.core, 0xCE20, 0); wr(a.core, 0xDA43, 0x05);
  call(a.gb, a.core, 1, 0x4CB3);
  const b = boot(Buffer.from(garbageSram(77)), Uint8Array.from(a.data));   // fresh garbage, saved log
  const sb = sramOf(b.core);
  check(sb[0x1FD8] === 0x02 && sb[0x1FD9] === 0x07, 'T7 save survives a reboot from garbage SRAM (02/07 marker intact after validator)');
  check(b.st.programs === 0, 'T7 validator accepted the restored save (no re-init commit)');
  emptyShot(b.gb, 'dk-test-garbage-reboot.png');
}
/* T6: sector wrap: force many distinct states */
const w = boot(undefined, undefined);
let wrapOk = true, lastCount = 0, sawErase = false;
for (let i = 1; i <= 70; i++) {
  wr(w.core, 0xBFC0 - 0xA000 + 0xA000, 0); // no-op keep addresses explicit
  w.core.MBCRam[0x1FC1] = i & 0x0F;        // change a payload byte
  w.core.MBCRam[0x0000] = (i >> 2) & 0x0F;
  const ok = call(w.gb, w.core, 1, 0x3910 + 0, 200);
  const c = validSlots(w.data).length;
  if (w.st.erases > 0) sawErase = true;
  if (!ok) { wrapOk = false; break; }
  lastCount = c;
}
check(wrapOk, 'T6 70 forced commits all returned to the caller');
check(sawErase, `T6 sector erased when full (erases=${w.st.erases})`);
const vs = validSlots(w.data);
const swram = sramOf(w.core);
check(vs.length >= 1 && eq(slotPayload(w.data, vs[vs.length - 1]), payloadOf(swram)), 'T6 newest record matches SRAM after wrap');
check(slots(w.data).every((x) => x.state !== 'torn'), 'T6 no torn records');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
