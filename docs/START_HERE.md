# Start here (new session handoff)

## What this project is now

A **per-game Game Boy save investigation and patching workbench** for the
HC007-BGA-V2 bootleg cart.  The old idea of one universal patcher was dropped:
commercial games store saves in different ways, and many use SRAM as work RAM.
Each game now gets a case folder in `games/` with evidence, a save-format map
and a patch recipe.

The hardware write path is already proven:

- M29W640, 8 MiB NOR flash, 64 KiB sectors;
- unlock `0xA9/0x56` (D0/D1 swapped), flash ID `20 00 7D 00`;
- program/erase works in MBC1, MBC3 and MBC5 header modes;
- only SRAM bank 0 (8 KiB) is verified;
- a controlled flash journal survives power cycles.

## Current phase

**Transition complete.  First case (Super Mario Land 2) investigated; patch
implementation is next.**

### Super Mario Land 2 - findings

`games/sml2/` is the handoff package.  Key facts:

- MBC1, 512 KiB, 8 KiB SRAM, SHA-1 `bba408539ecbf8d322324956d859bc86e2a9977b`.
- The game uses SRAM as **work RAM**:
  - stack at `SP=0xA8FF`;
  - hot buffers in pages 1, 2, 4 and 8;
  - a whole-SRAM VBlank journal is unsuitable.
- Save slots: `0xA000`, `0xA050`, `0xA0A0`, stride `0x50`, 3 slots.
- Slot layout:
  - `0x00-0x3F`: data copied from `0xA840`;
  - `0x40,0x41,0x43,0x44`: state bytes from `0xA262`, `A263`, `A22C`, `A28D`;
  - `0x42`: status/occupied byte (0 = empty);
  - `0x45`: checksum = sum of bytes `0x00..0x44`;
  - `0x46-0x49`: magic `12 34 56 78`.
- Writer: `0x2934` (bank 0), returns at `0x2973`.
- Validator: `0x28D9` calls `0x28EC` for each slot.
- Writer call sites: `0x2862`, `0x3147`, plus banked paths `0x0F41F4`,
  `0x0F6F15`, `0x0F6F21`, `0x0F6F27`, `0x0F7040`, `0x0F714D`, `0x0F73AB`,
  `0x18470D`, `0x184EAB`.
- Code caves: bank 0 `0x1967` (44 bytes), bank `0x1A` CPU `0x52CA`
  (518 bytes).
- No blank 64 KiB sector.  The plan is a **mapper conversion to MBC5**
  (`0x147 = 0x1B`) plus padding to 1 MiB and a log at `0x80000` (bank `0x20`).
  The game only uses MBC1 mode-0 bank writes, so the conversion is compatible in
  principle; the patched test image boots to the file-select screen in serverboy.

The crafted-save proof works: `games/sml2/tools/make-save.py` builds an SRAM
image that the file-select screen accepts (see
`games/sml2/analysis/crafted-menu.png`).

## Next actions

1. **Trace a real save.**  Get the game to a save event (level clear or the
   pause/save path) and capture `trace-save.json`.  Confirm the writer call site
   and the mapper bank value at that moment.
2. **Find the delete path.**  Use a crafted save, choose `CLEAR` on the
   file-select screen, and trace what writes the slot.  Hook it too if it does
   not go through `0x2934`.
3. **Build the S1 journal blob.**  Small save-slot record (0x50 or 0xF0
   payload), flash primitives from `testrom/flashlib.c`, code in bank `0x1A` or
   an appended bank.
4. **Write the hooks:**
   - boot restore at `0x28D9` (preferred) or entry `0x100`;
   - `CALL 0x2934` sites -> save hook;
   - verify bank save/restore.
5. **Fill in `games/sml2/recipe.json`** and run
   `python patcher/rom_patch.py check/apply`.
6. **Emulator reader test** with a seeded log, then **hardware test**.

## Tools

```powershell
python tools/rom_inspect.py game.gb
python tools/gbdis.py game.gb --bank 0 --range 0x100:0x180
python tools/gbdis.py game.gb --sram-refs
node tools/sram_trace.mjs game.gb --script-file games\sml2\trace.json
python tools/trace_report.py game.gb games\sml2\analysis\trace-play.json --top 16
node tools/sram_activity.mjs game.gb 1500
python patcher/rom_patch.py check games\sml2\recipe.json
python patcher/rom_patch.py apply games\sml2\recipe.json
```

Full procedure: `docs/WORKFLOW.md`.
Tool reference: `docs/TOOLCHAIN.md`.
Save patterns: `docs/SAVE_MECHANISMS.md`.
Recipe format: `docs/PATCH_RECIPE.md`.

## Ground rules

- ROMs and built blobs are git-ignored; do not commit them.
- Never erase a sector that contains code or data.
- Flash code runs from WRAM with interrupts disabled; restore the bank before
  returning to banked code.
- Emulators drop ROM writes; only the reader path can be tested there.
- The cart is the only writer-path oracle.
- Record every hook address and evidence file in the game's case folder.
