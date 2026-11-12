# Project status (2026-11-12)

## TL;DR

- The project goal changed from a **universal patcher** to a **per-game save
  investigation and patching workbench**.  See `docs/WORKFLOW.md`.
- The HC007 write path is proven on hardware: flash ID, program, erase, and a
  controlled journal persisted across power cycles.
- The first case, **Super Mario Land 2**, is investigated.  Its save format and
  writer/validator routines are mapped.  Patch implementation is next.
- No SML2 patch has been written or tested on hardware yet.

## Verified on the real cart

| Item | Result |
|---|---|
| Flash ID | `20 00 7D 00` (ST/Numonyx M29W640) |
| Unlock bytes | `0xA9/0x56` (D0/D1 swapped); `0xAA/0x55` fails |
| Program | `PROG err=00 rd=5A` |
| Erase | `ERASE err=00 rd=FF` |
| Mapper modes | MBC1, MBC3, MBC5 headers all boot/play and program/erase |
| SRAM | only bank 0 (8 KiB) verified; 4-bank test fails |
| Journal | controlled test ROM persisted; patched plain MBC5 ROM persisted |

Reference: `docs/HARDWARE.md`, `docs/MAPPER_MODES.md`,
`docs/FLASH_SAVE_METHOD.md`.

## Current case: Super Mario Land 2

Folder: `games/sml2/`.

### What is known

- MBC1 + RAM + battery, 512 KiB ROM, 8 KiB SRAM, SHA-1
  `bba408539ecbf8d322324956d859bc86e2a9977b`.
- **SRAM is work RAM.**  `SP=0xA8FF` at boot; pages 1, 2, 4 and 8 are hot during
  normal play.  A whole-SRAM VBlank journal would write constantly.
- Save slots: `0xA000`, `0xA050`, `0xA0A0`; stride `0x50`; 3 slots.
- Slot: 0x40 data bytes from `0xA840`, 5 state bytes, checksum at `0x45`,
  magic `12 34 56 78` at `0x46-0x49`; status byte at `0x42`.
- Writer `0x2934` (bank 0), `RET` at `0x2973`.
- Validator `0x28D9` / `0x28EC` (bank 0).
- Call sites: `0x2862`, `0x3147`, plus banked paths in banks `0x0F` and `0x18`.
- Code caves: bank 0 `0x1967` (44 bytes), bank `0x1A` CPU `0x52CA`
  (518 bytes).
- No blank 64 KiB sector.  Plan: convert the header to MBC5 (`0x147 = 0x1B`),
  pad to 1 MiB, and put the log at `0x80000` (bank `0x20`).  The game only uses
  MBC1 mode-0 bank writes and never touches `0x4000`/`0x6000`; a converted test
  image boots to the file-select screen in serverboy.
- Crafted save accepted by the file-select screen
  (`games/sml2/analysis/crafted-menu.png`).

### What is not known yet

- Which routine deletes a slot (`CLEAR`), and whether it goes through `0x2934`.
- The mapper bank value at a real save event.
- Whether the game tolerates restoring bank 1 after a save hook.
- Whether the free runs have xrefs.
- Whether the boot validator is the best restore point or file select re-reads
  the slots later.

## Next concrete actions

1. Trace a real save and a real delete on SML2.
2. Build the S1 save-slot journal blob.
3. Implement the boot restore and save hook.
4. Fill `games/sml2/recipe.json`, apply, and run the emulator reader test.
5. Hardware test: save, power-cycle, load, delete, power-cycle, reflash.

## Toolchain added in this transition

- `tools/rom_inspect.py` - header, hashes, banks, free space.
- `tools/gbdis.py` - LR35902 disassembler + SRAM-reference finder.
- `tools/sram_trace.mjs` - SRAM and mapper-register trace with scripted input.
- `tools/trace_report.py` - disassemble around the hot trace PCs.
- `patcher/rom_patch.py` - JSON patch recipe apply/check/diff.
- `games/_template/` - case scaffold.
- `games/sml2/` - first worked case.

## Legacy prototype

The universal prototype (`patcher/hc007_patcher.py`, `patcher/journal/`) still
exists and its hardware path is valuable:

- boot trampoline with WRAM stack;
- mapper-aware bank select;
- WRAM flash primitives;
- append-only page journal;
- staged hardware isolation tests.

It is not the default for commercial games.  Keep it for reference and for
controlled test ROMs.

## Known hardware limits

- 8 KiB SRAM bank 0 only.
- MBC1/MBC3/MBC5; no MBC2/MMM01/MBC6/MBC7/HuC/TAMA5.
- RTC not supported in v1.
- 8 MiB images have no spare sector.
- VBlank budget is tight; the old page journal needed 32-byte chunks.

## Last known-good builds

- `roms/testrom-mbc1.gb`, `-mbc3.gb`, `-mbc5.gb`: hardware pass.
- `roms/plain-mbc5-patched.gb`: hardware pass with the legacy journal.
- Reader tests: `tests/testrom_reader.mjs`, `tests/patched_plain_reader.mjs`.
