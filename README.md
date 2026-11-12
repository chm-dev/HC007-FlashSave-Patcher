# HC007 Game Boy Save Workbench

A per-game investigation and patching workbench for adding **batteryless saves**
to Game Boy / Game Boy Color ROMs on the bootleg **HC007-BGA-V2** cartridge
(M29W640 8 MiB NOR flash, 8 KiB usable SRAM, no battery).

This is **not** a universal patcher.  Every game stores saves differently, so
each game gets a case folder under `games/` containing its evidence, save-format
notes, hook addresses and patch recipe.  The tools automate the repetitive parts:
header inventory, disassembly, SRAM tracing, save-format discovery, patch
application and emulator checks.

The previous universal VBlank-journal prototype is still in `patcher/` as a
reference.  It proved the hardware write path, but it is not the default path
for commercial games: many games use SRAM as work RAM or save through a compact
routine that is better hooked directly.

## What is proven on the real cart

- Flash program/erase works.  Unlock bytes are **`0xA9/0x56`** (D0/D1 swapped).
- Flash ID: `20 00 7D 00` (ST/Numonyx M29W640, 8 MiB, 64 KiB sectors).
- Flash writes work with **MBC1, MBC3 and MBC5** headers; the game can keep its
  original mapper byte.
- Only **SRAM bank 0 (8 KiB)** is verified.  Treat 32 KiB games as unsupported
  until banked SRAM is proven.
- A controlled flash journal has persisted across power cycles on the cart.
- The boot trampoline must switch to a WRAM stack before running C code.

## Workflow at a glance

1. **Inventory** the ROM: mapper, RAM, space, vectors, hashes.
2. **Trace SRAM** in the emulator: find the hot read/write PCs and the save data
   region.
3. **Map the save format**: slots, checksum, signature, delete behaviour.
4. **Choose a strategy**: save-routine hook is preferred; SRAM page journaling
   is the fallback.
5. **Patch** with a JSON recipe, then verify boot/load in emulators.
6. **Test** save, power-cycle, load, delete, reflash on hardware.
7. **Record** the result in `docs/COMPATIBILITY.md`.

Full procedure: `docs/WORKFLOW.md`.  Tool reference: `docs/TOOLCHAIN.md`.

## Quick start

```powershell
# 1. Inventory any ROM (no dependencies)
python tools/rom_inspect.py path\to\game.gb

# 2. Disassemble an entry point or a bank
python tools/gbdis.py path\to\game.gb --bank 0 --range 0x100:0x180
python tools/gbdis.py path\to\game.gb --bank 3 --range 0x4000:0x4100

# 3. Find every SRAM operand / pointer in the ROM (static hints)
python tools/gbdis.py path\to\game.gb --sram-refs --limit 80

# 4. Trace actual SRAM reads/writes while the emulator runs
node tools/sram_trace.mjs path\to\game.gb --frames 600
node tools/sram_trace.mjs path\to\game.gb --script "wait:200;tap:START:30;hold:RIGHT:600"

# 5. Screen a ROM for SRAM-as-work-RAM before choosing a strategy
node tools/sram_activity.mjs path\to\game.gb 1500

# 6. Apply a per-game patch recipe
python patcher/rom_patch.py check  games\mygame\recipe.json
python patcher/rom_patch.py apply  games\mygame\recipe.json
```

## First case: Super Mario Land 2

`games/sml2/` is the first worked case.  It is an MBC1, 512 KiB, 8 KiB-SRAM
game with three 0x50-byte save slots at `0xA000`, `0xA050`, `0xA0A0`.

The investigation found:

- the game uses SRAM as **work RAM** (stack at `0xA8FF`, hot buffers in pages 1,
  2, 4 and 8), so a generic whole-SRAM journal is a poor fit;
- the save-slot writer is **`0x2934`** in bank 0 (copies `0xA840` plus five
  state bytes into the current slot, then writes a checksum);
- the save-slot validator is **`0x28D9`** / **`0x28EC`** (checks the checksum and
  the `12 34 56 78` signature);
- the slot status byte is at offset `0x42` of each slot;
- the save routine is called from `0x2862` and `0x3147` (and a few banked
  paths), so a save-routine hook is the sensible strategy.

Read `games/sml2/analysis.md` for the evidence and the proposed recipe.

## Directory map

| Path | Purpose |
|---|---|
| `games/` | Per-game cases: evidence, notes, recipes |
| `games/_template/` | Copy this for a new game |
| `tools/rom_inspect.py` | Header / bank / free-space inventory |
| `tools/gbdis.py` | LR35902 disassembler + SRAM-reference finder |
| `tools/sram_trace.mjs` | Dynamic SRAM/mapper trace in serverboy |
| `tools/trace_report.py` | Disassemble around the hot trace PCs |
| `tools/sram_activity.mjs` | Quick "is SRAM used as work RAM?" screen |
| `tools/gb_harness.mjs` | Fast serverboy test harness |
| `patcher/rom_patch.py` | Apply/check/diff a JSON patch recipe |
| `patcher/hc007_patcher.py` | Legacy universal-patcher prototype |
| `patcher/journal/` | Legacy VBlank journal blob |
| `probe/`, `testrom/` | Hardware probe and controlled test ROMs |
| `docs/` | Workflow, toolchain, hardware, testing, compatibility |
| `roms/` | Local ROMs and build outputs (git-ignored) |

## Documentation

- `docs/START_HERE.md` - short handoff for a new session.
- `docs/WORKFLOW.md` - the per-game investigation and patch procedure.
- `docs/SAVE_MECHANISMS.md` - common GB save patterns and how to recognise them.
- `docs/TOOLCHAIN.md` - every tool, option and output format.
- `docs/PATCH_RECIPE.md` - the JSON recipe format.
- `docs/PATCHER_DESIGN.md` - patch architecture and hook strategies.
- `docs/TESTING.md` - emulator and hardware test procedures.
- `docs/HARDWARE.md` - HC007 board facts and probe results.
- `docs/MAPPER_MODES.md` - mapper register maps and flash-write conflicts.
- `docs/FLASH_SAVE_METHOD.md` - proven low-level WRAM flash driver method.
- `docs/COMPATIBILITY.md` - per-game status matrix.

## Ground rules

- ROMs are **not** committed; `roms/` and `tests/fixtures/` are ignored.
- Never place the flash log in a sector that contains ROM code.  The 64 KiB
  erase is destructive.
- Every flash routine must run from WRAM (or fixed bank 0) and must restore the
  ROM bank before returning to banked code.
- A patch recipe must record the source SHA-1 and the exact hook addresses.
- Hardware is the only oracle for program/erase.  Emulators drop ROM writes.
