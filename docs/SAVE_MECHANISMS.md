# Game Boy save mechanisms and how to recognise them

This is a field guide for the per-game workflow.  The goal is not to know the
game's save format in advance; it is to find the small number of routines and
memory regions that define it.

## The common patterns

### A. Tiny SRAM record with a checksum

Typical for arcade, puzzle and sports games with one save.

```
0xA000: magic/version
0xA001: payload...
0xA0xx: checksum
```

The save routine writes a handful of bytes, computes a sum/hash, and writes the
result.  The load routine recomputes it and falls back to defaults on mismatch.

**Signals in a trace**

- a short burst of writes to a small range (often 8-64 bytes);
- a tight loop reading the same range immediately afterwards;
- a `RET` shortly after the last write;
- a compare against a fixed magic value in the disassembly.

**Patch strategy:** S1 (save-routine hook).

### B. Multi-slot save file

Three or more slots, each a fixed-size struct, with a status byte and a
checksum.  The game may store the slot index in RAM and compute the base as
`0xA000 + index * stride`.

**Signals**

- a multiply/shift of a slot index before `LD HL,0xA000`;
- a validator that is called once per slot in a loop or three times in a row;
- a status byte read every frame on the file-select screen;
- an empty-slot initializer that writes a deliberately invalid checksum.

**Patch strategy:** S1.  Journal the whole slot area, or the single slot if the
index is stable.  Restore before the validator runs.

**Worked example: Super Mario Land 2**

- slots at `0xA000`, `0xA050`, `0xA0A0`, stride `0x50`;
- meaningful size `0x4A` bytes: `0x40` data, five state bytes, checksum at
  offset `0x45`, signature `12 34 56 78` at `0x46-0x49`;
- status/occupied byte at offset `0x42`;
- validator `0x28D9` calls `0x28EC` for each slot;
- writer `0x2934` copies `0xA840` + five state bytes into the selected slot and
  writes the checksum;
- the game uses SRAM as work RAM (stack at `0xA8FF`, hot pages 1, 2, 4, 8), so
  S2 is unsuitable.

### C. SRAM used as work RAM

Some games keep a stack, decompression buffer, tile buffer or level cache in
cartridge SRAM.  This is legal on a battery-backed cart.

**Signals**

- `SP` sampled inside `0xA000-0xBFFF`;
- one or more pages changing every frame;
- writes to SRAM during scrolling/animation, not just at a save;
- a huge number of unique write PCs.

**Consequence:** a whole-SRAM VBlank journal would write constantly and wear
the flash.  Use S1 (hook the save routine) or S3.

**Do not** assume a hot page is the save file.  Trace a real save event.

### D. Save data computed on the fly

The game may hold the canonical save in WRAM and write SRAM only as a copy, or
compute it from multiple structures.

**Signals**

- the save routine reads many non-contiguous WRAM addresses;
- the save data is compressed or encrypted;
- no stable SRAM region exists.

**Patch strategy:** S1 if there is a copy step; S3 if the save is assembled only
at write time.

### E. Password / no-save games

No cartridge RAM and no battery, or the game only shows a password.

**Patch strategy:** out of scope for v1.  Do not try to invent persistence.

### F. RTC saves

MBC3 timer games store a clock in the mapper.  The clock is not battery-backed
on the HC007 unless the board provides one.

**Patch strategy:** S1 plus RTC journaling.  v1 should mark these unsupported
unless the game works without a clock.

## How to map a save format

Work from the dynamic trace backwards:

1. **Find the save burst.**  Trace a real save.  Sort write PCs by count and
   first frame.  A save event is usually a compact burst, not a steady stream.
2. **Find the routine boundaries.**  Disassemble backwards from the hot PC until
   a `RET`/`JP`/alignment; disassemble forwards until the `RET`.
3. **Find the base address.**  Look for `LD HL,0xA000`, `LD DE,0xAxxx`, or an
   index multiply before the first write.
4. **Find the checksum.**  Look for `ADD A,C`, `XOR`, `ADC`, a loop over the
   data, and a final `LD (HL),A`.
5. **Find the signature.**  Look for `CP 0x12`, `CP 0x34`, etc. after the
   checksum.
6. **Find the validator.**  Search for calls to the routine that contains the
   checksum compare; it is often called once per slot at boot or on the file
   select screen.
7. **Find the initializer/delete.**  Find the code that writes an empty slot or
   clears a slot.  Record the exact bytes; the flash journal must be able to
   represent the deleted state.

## Proving the format with a crafted save

This is the highest-value test.  Build an SRAM image with one slot filled and a
correct checksum, boot the game with it, and check whether the menu treats it as
a real save.  If the menu shows the slot as occupied, the format is right.

```powershell
node tools/sram_trace.mjs roms\game.gb `
  --sram games\game\analysis\crafted.sav `
  --script "wait:200;tap:START:30" `
  --shot games\game\analysis\crafted-menu.png
```

Vary one field at a time:

- status byte: does the menu mark the slot used?
- slot index: does it show the data in the expected slot?
- checksum: does a wrong checksum mark it invalid?
- signature: does a wrong magic mark it invalid?

Record the answers in `notes.md`.

## What to record in the case

- save region: base, stride, size, status byte, checksum algorithm, magic;
- write routine: address, bank, calling convention;
- validate routine: address, bank;
- load routine: address, bank;
- delete/init routine: address, bank;
- boot restore point: entry `0x100` or a validator;
- SRAM usage: hot pages, stack, buffers;
- flash log sector and record size;
- code cave / bank plan;
- evidence file names.
