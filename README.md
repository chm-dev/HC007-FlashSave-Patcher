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
2. **Trace SRAM and WRAM over a real level load**: find hot pages, the save
   region and the game's work-RAM/stack areas.
3. **Map the save format**: slots, checksum, signature, delete behaviour.
4. **Choose a strategy**: save-routine hook is preferred; SRAM page journaling
   is the fallback.
5. **Patch** with code in an appended ROM bank and a small on-demand WRAM
   helper; restore the caller's bank from fixed bank 0.
6. **Test** synthetic save/delete, then a save after a real level load and a
   natural save event with a NOR-flash model.
7. **Hardware-test** save, power-cycle, load, delete, reflash; keep a no-flash
   debug build for isolation.
8. **Generate and verify an IPS** against the original ROM.
9. **Record** the result in `docs/COMPATIBILITY.md` and the case folder.

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

# 5. Trace WRAM page writes over a real level load
node tools/wram_trace.mjs path\to\game.gb --frames 1500

# 6. Screen a ROM for SRAM-as-work-RAM before choosing a strategy
node tools/sram_activity.mjs path\to\game.gb 1500

# 7. Start a case
Copy-Item -Recurse games/_template games\mygame

# 8. Apply a per-game patch recipe and generate the IPS
python patcher/rom_patch.py check  games\mygame\recipe.json
python patcher/rom_patch.py apply  games\mygame\recipe.json
python patcher/rom_ips.py make --recipe games\mygame\recipe.json `
  --patch games\mygame\ips\mygame-hc007.ips
```

## Worked example: Super Mario Land 2

`games/sml2/` is the first complete case and the reference for the case-folder
layout.  It is **hardware-pass**: the normal build was tested on the HC007
cart (save, power-cycle/load, delete and the life-loss event).

The case demonstrates the recurring rules:

- the game uses SRAM **and** WRAM as work RAM, and a level load overwrote the
  previous manager/journal area;
- the journal now lives in an appended ROM bank, with a small on-demand WRAM
  helper and backup/restore of the game block;
- the caller's bank is restored in fixed bank 0 after the appended-bank code
  returns;
- tests cover a save after a real level load and a natural death/transition
  with a NOR-flash model;
- distributable IPS patches live in `games/sml2/ips/`.

Read `games/sml2/README.md` for status, outputs, the first test to run and the
hardware checklist.  Full evidence: `games/sml2/notes.md`; session handoff:
`games/sml2/HANDOFF.md`.

## Directory map

| Path | Purpose |
|---|---|
| `agents.md` | Short agent entry point and guardrails |
| `games/` | Per-game cases: evidence, notes, recipes |
| `games/sml2/README.md` | SML2 case entry point: status, outputs, tests |
| `games/sml2/HANDOFF.md` | SML2 session handoff |
| `games/sml2/ips/` | SML2 distributable IPS patches + manifest |
| `games/_template/` | Copy this for a new game; includes README, src/tools/tests/ips |
| `tools/rom_inspect.py` | Header / bank / free-space inventory |
| `tools/gbdis.py` | LR35902 disassembler + SRAM-reference finder |
| `tools/sram_trace.mjs` | Dynamic SRAM/mapper trace in serverboy |
| `tools/wram_trace.mjs` | WRAM page write trace (find scratch RAM) |
| `tools/joypad_trace.mjs` | Joypad register read/write PC trace |
| `tools/trace_report.py` | Disassemble around the hot trace PCs |
| `tools/sram_activity.mjs` | Quick "is SRAM used as work RAM?" screen |
| `tools/gb_harness.mjs` | Fast serverboy test harness |
| `games/sml2/tools/` | SML2 blob build, log seeding, save tests and route probe |
| `patcher/rom_patch.py` | Apply/check/diff a JSON patch recipe |
| `patcher/rom_ips.py` | Create/apply IPS patches for distribution |
| `patcher/hc007_patcher.py` | Legacy universal-patcher prototype |
| `patcher/journal/` | Legacy VBlank journal blob |
| `probe/`, `testrom/` | Hardware probe and controlled test ROMs |
| `docs/` | Workflow, toolchain, hardware, testing, compatibility |
| `roms/` | Local ROMs and build outputs (git-ignored) |

## Documentation

- `agents.md` - short entry point for coding agents.

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
- Keep journal code in an appended ROM bank; only the flash primitive needs to
  run from WRAM (or fixed bank 0).  Restore the caller's bank from bank 0 before
  returning to banked code.
- A patch recipe must record the source SHA-1 and the exact hook addresses.
- Hardware is the only oracle for program/erase timing.  Emulators drop ROM
  writes by default; the NOR-flash model is a construction test only.
- Generate the IPS from the original ROM and verify it by applying it back and
  comparing the SHA-1 with the built image.
