# Project status (2026-11-12)

## TL;DR

- The project goal is a **per-game save investigation and patching workbench**.
  See `docs/WORKFLOW.md`.
- The HC007 write path is proven on hardware: flash ID, program, erase, and a
  controlled journal persisted across power cycles.
- **The workbench is ready for the next game; none has been chosen yet.**
  Start with `games/_template/` and `docs/WORKFLOW.md`.
- The first case, Super Mario Land 2, is **hardware-pass** after fixing a
  level-load/work-RAM reset.  Save, load, delete and the life-loss event work
  on the HC007 cart.  Game-specific details live in `games/sml2/`.
- SML2 build `5a9378...` passes synthetic save/delete/full-log tests, a save
  after a real level load, and a natural death/transition with a NOR-flash
  model.  A no-flash debug build and verified IPS patches are in the case
  folder.

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

## Cases

| Case | Status | Outputs | Case folder |
|---|---|---|---|
| Super Mario Land 2 | hardware-pass | `roms/sml2-hc007.gb` (`5a9378...`), `games/sml2/ips/` | `games/sml2/` |

### Super Mario Land 2

- Root cause of the old life-loss reset: a level load overwrote the previous
  SRAM manager/journal source at `0xAD00-0xB0DF`.  The redesign keeps all code
  in ROM bank `0x24` and copies only a small helper to WRAM on demand.
- Emulator tests pass: synthetic save/delete/full-log erase, a save after a
  real level load, and a natural death/transition with a NOR-flash model.
- The normal build passed on the HC007 cart: boot, life-loss save without a
  reset, power-cycle/load and delete.  A no-flash debug build remains for
  future regression isolation.
- Entry point: `games/sml2/README.md`; handoff: `games/sml2/HANDOFF.md`;
  evidence: `games/sml2/notes.md`; distribution:
  `games/sml2/ips/README.md`.

## Next game

No next game has been chosen.  To start one:

1. `Copy-Item -Recurse games/_template games/<slug>`.
2. Fill `case.json` and `README.md`.
3. Follow `docs/WORKFLOW.md`, including SRAM **and** WRAM tracing over a real
   level load.
4. Keep game-specific findings in `games/<slug>/`; put reusable lessons in
   `docs/PATCHER_DESIGN.md` or `docs/WORKFLOW.md`.
5. Generate and verify an IPS before publishing.

## Toolchain added in this transition

- `tools/rom_inspect.py` - header, hashes, banks, free space.
- `tools/gbdis.py` - LR35902 disassembler + SRAM-reference finder.
- `tools/sram_trace.mjs` - SRAM and mapper-register trace with scripted input.
- `tools/wram_trace.mjs` - WRAM page write/read trace, for picking scratch RAM.
- `tools/joypad_trace.mjs` - joypad-read/write PC trace, for finding input code.
- `tools/trace_report.py` - disassemble around the hot trace PCs.
- `patcher/rom_patch.py` - JSON patch recipe apply/check/diff.
- `patcher/rom_ips.py` - create/apply IPS patches for distribution.
- `games/_template/` - case scaffold with README, src/tools/tests/ips.
- `games/sml2/` - first worked case and reference implementation.
- `games/sml2/tools/` - example blob build, log seeding, save tests and route
  probe (case-specific).

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
- VBlank budget is tight; long flash work should be interrupt-disabled and
  kept to a short save window.

## Last known-good builds

- `roms/testrom-mbc1.gb`, `-mbc3.gb`, `-mbc5.gb`: hardware pass.
- `roms/plain-mbc5-patched.gb`: hardware pass with the legacy journal.
- `roms/sml2-hc007.gb` (`5a9378...`): **hardware-pass**; emulator tests include
  a save after a level load and a natural death/transition.
- `roms/sml2-hc007-noflash.gb` (`fa8557...`): debug build that skips journal
  flash writes, for hardware isolation.
- `games/sml2/ips/`: full/minimal IPS patches; applying the full patch to the
  original ROM reproduces `5a9378...` / `fa8557...` exactly.
- Reader tests: `tests/testrom_reader.mjs`, `tests/patched_plain_reader.mjs`,
  `games/sml2/tools/test_save_emulator.mjs`,
  `games/sml2/tools/test_save_after_level.mjs`,
  `games/sml2/tools/test_death_flash.mjs`.
