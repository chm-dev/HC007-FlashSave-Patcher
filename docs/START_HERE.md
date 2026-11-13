# Start here (new session handoff)

> Short agent entry point: `agents.md`.

## What this project is now

A **per-game Game Boy save investigation and patching workbench** for the
HC007-BGA-V2 bootleg cart.  The old idea of one universal patcher was dropped:
commercial games store saves in different ways, and many use SRAM **and WRAM**
as work RAM.  Each game gets a case folder in `games/<slug>/` with evidence, a
save-format map, a patch recipe, tests and distributable IPS patches.

The hardware write path is already proven:

- M29W640, 8 MiB NOR flash, 64 KiB sectors;
- unlock `0xA9/0x56` (D0/D1 swapped), flash ID `20 00 7D 00`;
- program/erase works in MBC1, MBC3 and MBC5 header modes;
- only SRAM bank 0 (8 KiB) is verified;
- a controlled flash journal survives power cycles.

## Current phase

**Donkey Kong (`games/dk/`) is built and emulator-tested, waiting for its first hardware playtest.**  The workbench is otherwise ready for further games.

The first worked case is **Super Mario Land 2**:

- **hardware-pass** after fixing the level-load/work-RAM reset; save,
  power-cycle/load and delete work on the HC007 cart;
- full case entry point: `games/sml2/README.md`;
- session handoff: `games/sml2/HANDOFF.md`;
- evidence and root cause: `games/sml2/notes.md`.

## Starting a new game

1. **Create the case**:

   ```powershell
   Copy-Item -Recurse games/_template games/<slug>
   ```

2. **Fill `case.json`** immediately: title, SHA-1, mapper, declared ROM/RAM,
   battery/RTC, source path.

3. **Inventory and static recon**:
   `tools/rom_inspect.py`, then `tools/gbdis.py --sram-refs`.  Record free runs,
   blank banks/sectors, entry and vectors.

4. **Trace SRAM and WRAM over a real level load**, not just the menu:
   `tools/sram_trace.mjs` and `tools/wram_trace.mjs`.  Do not assume a page is
   free because the menu is quiet.

5. **Map the save format** and prove it with a crafted save the game accepts.
   Identify write/validate/load/delete/init routines and the empty-slot bytes.

6. **Choose the strategy** (`P1` save-slot journal preferred).  Keep the journal
   code in an appended ROM bank; copy only a small flash/bank helper to WRAM on
   demand and back up/restore the game block it borrows.

7. **Build the recipe** with `patcher/rom_patch.py`, then test:
   - synthetic save/delete/full-log erase;
   - **save after a real level load**;
   - **natural save event** with a NOR-flash model;
   - boot restore, duplicate suppression, delete persistence.

8. **Hardware test**, plus a no-flash debug build if the real flash path is
   unproven.  Record results in `docs/COMPATIBILITY.md` and the case notes.

9. **Generate a distributable IPS** against the original ROM with
   `patcher/rom_ips.py`, verify it by applying it back and comparing SHA-1, and
   keep it with `ips/README.md` and `ips/manifest.json`.

Full procedure: `docs/WORKFLOW.md`.  Tool reference: `docs/TOOLCHAIN.md`.
Save patterns: `docs/SAVE_MECHANISMS.md`.  Recipe format:
`docs/PATCH_RECIPE.md`.  Architecture lessons: `docs/PATCHER_DESIGN.md`.

## General rules learned so far

- **Trace SRAM and WRAM over a real level load.**  A level load can overwrite
  large regions; patch code stored there may be dead by the next save.
- **Keep patch code in ROM, not game RAM.**  Copy only a small helper to WRAM
  on demand; back up/restore the game block.  Prefer a proven-unused location
  for the backup.  A "quiet" page is only quiet over the levels and transitions
  you traced: SML2's backup page `0xB600-0xB8FF` was called quiet from one early
  level, yet the game refills it around map/level transitions.  Trace several
  levels, the map, death and level-complete before trusting any page, and
  restore the borrowed bytes too if you cannot prove it.
- **Test after a real level load and test the natural save event.**  A
  synthetic jump immediately after boot can pass while the real save fails.
- **Restore the caller's bank from fixed bank 0.**  Never put `EI`/`RET` after a
  bank switch inside switchable-bank code; the switch unmaps the following
  instructions.
- **A game may use SRAM as its stack.**  Flash unlock writes disable SRAM, so
  the flash primitive must run from WRAM/fixed bank 0 with no stack access while
  SRAM is disabled, and re-enable SRAM before returning.
- **MBC1 -> MBC5:** retarget every `LD (0x3000),A` bank write to `0x2000`;
  MBC5 uses `0x3000` for ROM bank bit 8.
- **Real batteryless SRAM powers up with garbage; emulators start at zero.**  A game's own init rarely clears every byte it later validates (DK's clears A000-A4AF but not its BE2A checksum/backup).  Journaling that garbage makes the validator wipe the save on the next boot.  Zero the cart RAM at boot restore (and when the log is empty) and add a test with random-filled SRAM + a seeded log, then save and reboot again (games/dk/tools/test_save_emulator.mjs T7).
- **Never move SP into cart SRAM on the HC007 (found on DK, 4 hardware rounds).**  A stub that saved SP, pointed SP at an SRAM scratch stack and pushed/popped there froze the real cart, while the same code passed serverboy and Gearboy.  Graded hardware builds showed that the ROM-bank restore, SRAM variables, log scan and WRAM backup copy are all fine; only the SRAM-resident SP froze.  Run patch code on the game's own HRAM stack (budget ~20 bytes; the stub runs DI so it never adds to ISR depth).  SML2's SRAM stack worked only because it was the game's own, permanent one.
- **Read `docs/FLASH_SAVE_METHOD.md` before laying out flash records, and make the test model enforce it.**  Program/erase data writes must be at CPU `0x6000-0x7FFF` (`0x4000-0x5FFF` is the RAM-bank register).  DK spread records over the whole window; slot 0's first byte hit the register, every DQ7 poll ran to timeout and the cart looked frozen, while a permissive flash model passed 23 checks.  The model in `games/dk/tools/test_save_emulator.mjs` now throws on such a write.
- **Bisect on hardware with graded stub builds**: pass-through stub -> + one piece at a time (bank write, bank restore, SRAM variable round trip, SP switch, scan, WRAM copy).  Each ROM is a few lines of assembler switches and a recipe; four ROMs localised the fault in one round.
- **Randomised power-on state is still worth testing** (`games/dk/tools/test_poweron_garbage.mjs`, unpatched ROM as control; `--hostile4000/--hostile2000` model a mapper that drops cart RAM on bank writes).  It found real hazards, but not the one that bit on hardware, so do not treat it as proof of safety.
- **Keep a no-flash debug build** for hardware isolation.
- **Emulators drop ROM writes by default.**  Use a small NOR-flash model for
  writer-path tests; it does not prove real timing, SRAM disable/re-enable or
  bank mapping.
- **Generate and verify an IPS** before publishing.  The full patch can include
  erased padding so any tool produces the exact image; a minimal patch needs
  explicit `0xFF` padding.

## Case folder layout

```
games/<slug>/
  README.md          # status, outputs, first test
  case.json          # identity, strategy, addresses, status
  notes.md           # full evidence, tests, open questions
  HANDOFF.md         # optional short session handoff
  trace.json         # replayable SRAM/WRAM trace route
  recipe.json        # exact patch edits and blobs
  src/               # patch assembly/source
  tools/             # build and test scripts
  tests/             # case-specific emulator checks (optional)
  ips/               # distributable IPS patches + manifest
  analysis/          # inventory, listings, traces, screenshots, saves
  build/             # generated blobs (git-ignored)
```

## Tools

```powershell
python tools/rom_inspect.py roms/<game>.gb
python tools/gbdis.py roms/<game>.gb --bank 0 --range 0x100:0x180
python tools/gbdis.py roms/<game>.gb --sram-refs

node tools/sram_trace.mjs roms/<game>.gb --script-file games/<slug>/trace.json
node tools/wram_trace.mjs roms/<game>.gb --script-file games/<slug>/trace.json
node tools/joypad_trace.mjs roms/<game>.gb --script-file games/<slug>/trace.json
node tools/sram_activity.mjs roms/<game>.gb 1500

python patcher/rom_patch.py check games/<slug>/recipe.json
python patcher/rom_patch.py apply games/<slug>/recipe.json
python patcher/rom_ips.py make --recipe games/<slug>/recipe.json --patch games/<slug>/ips/<slug>-hc007.ips
python patcher/rom_ips.py apply games/<slug>/ips/<slug>-hc007.ips "roms/<game>.gb" rebuilt.gb --expect-sha1 <output-sha1>
```

## Ground rules

- ROMs and built blobs are git-ignored; do not commit them.
- Never erase a sector that contains code or data.
- Flash code runs from WRAM with interrupts disabled; restore the bank from
  bank 0 before returning to banked code.
- Keep game-specific findings in the case folder; put only reusable lessons in
  `docs/`.
- Record every hook address, test result and evidence file in the case folder.
