# Super Mario Land 2: 6 Golden Coins

## Identity

- ROM: `roms/roms-to-patch/Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb`
- SHA-1: `bba408539ecbf8d322324956d859bc86e2a9977b`
- CRC32: `d5ec24e4`
- Mapper: MBC1 + RAM + battery (`0x03`)
- ROM: 512 KiB
- SRAM: 8 KiB declared
- CGB: no
- RTC: no

## Inventory

- No blank 64 KiB sector and no blank 16 KiB bank in the original image.
- Entry `0x100 -> 0x0150`.
- VBlank vector `0x40 -> 0x0154`.
- Bank 0 has only small free `0xFF` runs: `0x1967` (44), `0x1AFF` (27),
  `0x1930` (23), `0x1A40` (18), `0x191B` (17).
- Bank `0x1A` has a 518-byte `0xFF` run at CPU `0x52CA`.

Evidence: `analysis/inventory.json`.

## SRAM usage

The game uses cartridge SRAM as work RAM, not just as a save file:

- `SP=0xA8FF` at boot (`0x0205`), so page 8 (`0xA800-0xA8FF`) is the stack.
- A 160-byte buffer at `0xA100-0xA19F` is cleared every frame
  (`0x411B`, bank 5 code).
- Pages 1, 2, 4 and 8 show thousands of accesses during normal play.
- Pages 9-12 (`0xA900-0xACFF`) are used by the level decompressor; the VBlank
  decompressor at `0x0AFB` reads its stream from `0xA9FF`.
- Page 0 (`0xA000-0xA0EF`) is quiet except for save-slot writes.

**Consequence:** a whole-SRAM VBlank journal is a poor fit.  Use a save-routine
hook (S1).

Evidence: `analysis/trace-menu.json`, `analysis/trace-play.json`.

## Save format

Three slots of 0x50 bytes:

| Slot | Base |
|---|---|
| 0 | `0xA000` |
| 1 | `0xA050` |
| 2 | `0xA0A0` |

Each slot:

```
+0x00..0x3F  0x40 bytes copied from 0xA840 (game state)
+0x40        byte from 0xA262
+0x41        byte from 0xA263
+0x42        status/occupied byte (from 0xA2C5); 0 = empty, nonzero = used
+0x43        byte from 0xA22C
+0x44        byte from 0xA28D
+0x45        checksum = sum of bytes 0x00..0x44 (mod 256)
+0x46..0x49  magic 12 34 56 78
```

The empty-slot initializer at `0x2918` writes 0x40 zeros followed by
`00 00 00 05 00 02 12 34 56 78`; the checksum `0x02` deliberately does not
match the sum `0x05`, marking the slot empty.

The validator at `0x28D9` checks all three slots in order:

```
28D9: LD HL,0xA000
28DC: CALL 0x28EC
28DF: LD HL,0xA050
28E2: CALL 0x28EC
28E5: LD HL,0xA0A0
28E8: CALL 0x28EC
28EB: RET
```

`0x28EC` sums 0x45 bytes, compares the result with byte `0x45`, then checks
`12 34 56 78` at `0x46..0x49`.

The writer at `0x2934`:

```
HL = 0xA000 + slot * 0x50       ; slot = A2A3
copy 0x40 bytes from 0xA840
copy A262, A263, A2C5, A22C, A28D
store checksum at offset 0x45
RET at 0x2973
```

Call sites: `0x2862` (after a level) and `0x3147` (another save path), plus
banked calls at `0x0F41F4`, `0x0F6F15`, `0x0F6F21`, `0x0F6F27`, `0x0F7040`,
`0x0F714D`, `0x0F73AB`, `0x18470D`, `0x184EAB`.

The file-select **CLEAR** path is separate.  The menu handler at bank `0x0C`
`0x41C6` computes the selected slot into `0xA2A3`, and when clear mode is armed
(`0xA2C6 != 0`) branches to bank `0x0C` `0x4227`:

```
4227: LD A,(0xA2A3)
      HL = 0xA000 + slot * 0x50
      write 0x40 zeros, then 00 00 00 05 00 02 12 34 56 78
```

This path does **not** call `0x2934`, so it needs its own hook.

Evidence: `analysis/save-writer.asm`, `analysis/save-validator.asm`.

## Crafted-save proof

`tools/make-save.py` builds an 8 KiB SRAM image with a valid slot.  Booting it
shows Mario and a save entry on the file-select screen, proving the slot layout
and the status byte.

```powershell
python games/sml2/tools/make-save.py analysis/crafted.sav --slot 0 --status 1
node tools/sram_trace.mjs "roms/roms-to-patch/Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb" `
  --sram games/sml2/analysis/crafted.sav `
  --script "wait:200;tap:START:30;wait:60" `
  --shot games/sml2/analysis/crafted-menu.png
```

## Patch implementation

Status: **hardware-pass.**  The redesign is implemented and emulator-tested; the normal build was tested on the HC007 cart.
The patch is `games/sml2/recipe.json`; the source is
`games/sml2/src/sml2_save.asm`; the blobs are built by
`games/sml2/tools/build_save.py`.  The previous SRAM-manager design is kept
in `games/sml2/src/legacy/sml2_save_sram.asm` for reference.

Strategy: save-routine hook + one-shot boot restore + clear hook, with an
MBC5 header conversion and a log in appended flash.  All patch code lives in
the appended ROM bank `0x24`; only a small bank-switching helper is copied to
WRAM for the duration of a save/restore.

### Root cause

SML2 uses cartridge SRAM as work RAM.  A level load overwrites
`0xAD00-0xB0DF`, and gameplay uses WRAM `0xC100-0xC3FF`.  The previous
design stored the manager at SRAM `0xAD00`, the journal source at
`0xAE00-0xB0DF`, and copied the journal to WRAM `0xDC00`.  After a level
load, 81/90 manager bytes and 689/733 journal bytes differed from the ROM
blob.  The next save called the now-corrupt manager and reset the console.  The
`test_save_after_level.mjs` regression counts 40,892 writes to
`0xAD00-0xB0DF` during the level load and 800 gameplay frames.

The earlier emulator tests jumped to the save hook immediately after boot,
before a level load could overwrite those areas, so they passed.  The new
regression tests enter a level first:
`test_save_after_level.mjs` (synthetic save after a real level load) and
`test_death_flash.mjs` (natural death/transition with a NOR-flash model).

### ROM layout

| Location | Use |
|---|---|
| bank 0 `0x1967` | save trampoline (20 bytes) |
| bank 0 `0x197B` | clear trampoline (20 bytes) |
| bank 0 `0x1AFF` | boot/validator hook (24 bytes) |
| bank 0 `0x3E03-0x3F2C` | 22 MBC1 `0x3000` bank writes -> `0x2000` |
| bank `0x24` `0x4000` | boot code |
| bank `0x24` `0x4500` | relocated file-select CLEAR routine |
| bank `0x24` `0x4800` | journal code (save, boot restore, scan) |
| bank `0x24` `0x4C00` | WRAM helper source (0x190 bytes + padding) |
| WRAM `0xC100-0xC3FF` | helper code/variables during a call |
| SRAM `0xB600-0xB8FF` | game WRAM backup for in-game saves |
| SRAM `0xAD00-0xAFFF` | game WRAM backup for the boot restore |
| SRAM `0xB0E0` | "boot restore done" flag |
| SRAM `0xB0E1` | test override: 1 forces the writer path |
| flash sector `0x80000-0x8FFFF` | log (bank `0x20`, CPU `0x6000-0x7FFF`) |

The 44-byte bank-0 cave holds the save and clear hooks (40 bytes); the boot
hook uses the 27-byte cave at `0x1AFF`.  The log sector is appended `0xFF`
padding; a 64 KiB erase only touches banks `0x20-0x23`.  Code lives in bank
`0x24` (`0x90000`), outside the erased sector.

### Why the code is in ROM, not SRAM or WRAM

SML2 fills almost all WRAM during a level load and uses SRAM
`0xAD00-0xB0DF` for level data.  Any manager or journal source kept there is
destroyed before the next save.  The journal therefore runs from the
appended ROM bank `0x24`.  A small helper is copied to WRAM `0xC100` at the
start of each save/restore; the game's `0xC100-0xC3FF` block is backed up
to SRAM and restored.  The flash routines run from that WRAM helper, which
selects log bank `0x20`, restores bank `0x24`, and re-enables SRAM before
returning.

### MBC1 -> MBC5 bank-write conversion

SML2 writes the MBC1 **low bank register at `0x3000`** in 22 bank-switch
helpers (`0x3E03` .. `0x3F2C`), not at `0x2000`.  Under MBC5, `0x3000` is
the **ROM bank bit 8** register: writing `0x0D` or `0x0F` there sets bit 8
and selects banks `0x10D`/`0x10F`, so the world-map graphics come from the
wrong banks and the tiles are garbled.

All 22 sites are retargeted from `LD (0x3000),A` (`EA 00 30`) to
`LD (0x2000),A` (`EA 00 20`).  The game never writes `0x4000` or `0x6000`,
so no other MBC1 register conversion is needed.

### Boot restore

The file-select setup at bank `0x0C` `0x4000-0x403E` calls the validator at
`0x4034`.  That call is redirected to the bank-0 boot hook at `0x1AFF`:

```
0x4034: CALL 0x1AFF
```

The hook checks `0xB0E0`.  On the first call it disables interrupts, selects
bank `0x24`, runs the boot code at `0x4000`, then restores bank `0x0C` and
enables interrupts **from bank 0**.  The boot code copies the WRAM helper
to `0xC100` (backing up `0xC100-0xC3FF` to SRAM `0xAD00`), scans the log,
copies the last valid record's 0xF0-byte payload to SRAM `0xA000`, restores
WRAM, sets `0xB0E0 = 1`, and returns.  The hook then jumps to the original
validator at `0x28D9`.

The bank restore must happen in the bank-0 hook, not in the bank `0x24`
boot code: switching `0x2000` to `0x0C` makes the bank `0x24` code
disappear, so a following `EI`/`RET` would execute from bank `0x0C`.

### Save hook

All 11 `CALL 0x2934` sites are redirected to bank 0 `0x1967`:

```
0x2862, 0x3147,
0x0F41F4, 0x0F6F15, 0x0F6F21, 0x0F6F27, 0x0F7040, 0x0F714D, 0x0F73AB,
0x18470D, 0x184EAB
```

The trampoline calls the original writer, disables interrupts, selects bank
`0x24`, calls the journal at `0x4800`, restores the caller's bank from
`0xA24E`, enables interrupts, and returns.  The journal:

1. installs the WRAM helper, backing up `0xC100-0xC3FF` to SRAM `0xB600`;
2. scans for the last valid record and the append offset;
3. if the region matches the last record, returns without writing;
4. probes the flash ID unless the `0xB0E1` test override is 1;
5. if the log is full, erases the sector and starts at offset 0;
6. appends a new 0xF6-byte record, programming the commit byte last;
7. restores the game's WRAM block and returns with bank `0x24` selected.

### Delete hook

The clear path entry at bank `0x0C` `0x4227` is replaced with:

```
0x4227: JP 0x197B
```

The original 0x46-byte clear routine is copied to bank `0x24` `0x4500`.
The trampoline runs it, then calls the journal, restores the caller's bank
from `0xA24E`, enables interrupts, and returns.  A delete therefore appends
a normal record whose payload is the cleared slot, and the next boot
restores the deleted state.

### Log format

Record size 0xF6, 33 records per 8 KiB window:

```
+0x00  'M' (0x4D)
+0x01  'L' (0x4C)
+0x02  0xF0 (payload length)
+0x03  payload (SRAM 0xA000-0xA0EF)
+0xF3  checksum = sum(+0x00..+0xF2) & 0xFF
+0xF4  0x5A commit (programmed last)
+0xF5  0x00 pad
```

`0xFF` payload bytes are skipped because the append slot is erased.  A torn or
corrupt record is ignored; the last valid record wins.  When the log is full,
the sector is erased and the current save is written at offset 0.

### Flash transport

- Unlock `0xA9/0x56` (HC007 D0/D1 swap), command set `0x90/0xA0/0x80+0x30`.
- Program/erase data window is CPU `0x6000-0x7FFF`; RAM bank register is
  restored to 0.
- The flash routines run from WRAM and use no stack while SRAM is disabled
  (the game's stack is in SRAM).  They re-enable SRAM (`0x0000 = 0x0A`)
  before returning.
- `journal_save` disables interrupts for the scan/program window.  A normal
  save takes a few milliseconds; a full-log erase can take up to about a
  second.  The game resumes afterwards.
- `w_detect` probes the flash ID at each save.  A plain emulator fails the
  probe and skips writes; the NOR-flash model answers the ID probe, so the
  writer path can be tested without hardware (timing still is not modelled).

## Current status (2026-11-12)

The real life-loss reset was caused by the old manager/journal source living
in SRAM `0xAD00-0xB0DF`, which SML2 overwrites during a level load.  The
redesign moves all code to ROM bank `0x24`, copies only a small helper to
WRAM `0xC100` for a call, and restores the caller's bank from bank 0.

What now passes in emulators:

- blank boot, file-select, world map and level rendering;
- synthetic save/delete/append/duplicate/full-log erase, including the
  natural flash-ID probe;
- a synthetic save **after a real level load** (the old failure scenario);
- a **natural death/level transition** with a NOR-flash model, producing a
  valid record;
- delete persistence, torn/corrupt record handling, and boot restore.

The current build is `roms/sml2-hc007.gb`, SHA-1
`5a9378036073fb3f3b7dbff1c6dff6f56c166009`.  **Hardware pass:** the normal
build boots, renders the world map/level, survives the life-loss save without
a reset, restores after power-cycle, and deletes correctly.  A no-flash debug
build is `roms/sml2-hc007-noflash.gb`, SHA-1
`fa8557672acf8e5ae6408ddf05bfd797b1c071ae`; it runs the same journal path
but skips program/erase.

## Emulator tests

All of these pass with `roms/sml2-hc007.gb` (SHA-1
`5a9378036073fb3f3b7dbff1c6dff6f56c166009`):

| Test | Result | Evidence |
|---|---|---|
| Boot with blank log -> file-select | pass | `analysis/patched-menu.png` |
| Start a game; world map renders | pass | `analysis/patched-world.png` |
| Enter a level; graphics render | pass | `analysis/patched-level.png` |
| Forced life-loss handler (state 9) completes without reset | pass | `death_probe.mjs` |
| Long level walk (6000 frames) survives | pass | `death_probe.mjs` |
| **Save after a real level load** | **pass** | `test_save_after_level.mjs` |
| **Natural death/transition with NOR-flash model** | **pass** | `test_death_flash.mjs` |
| Seed one valid record -> slot A restored | pass | `analysis/seeded-menu.png` |
| Later empty record wins (delete) | pass | two-record seed |
| Torn record (missing commit) ignored | pass | seed test |
| Corrupt checksum ignored, older record survives | pass | seed test |
| Save hook builds a valid record | pass | `test_save_emulator.mjs` |
| Duplicate save does not append | pass | flash model |
| Changed save appends at 0xF6 | pass | flash model |
| Full log erases and restarts at 0 | pass | flash model |
| CLEAR menu flow writes empty slot + journals delete | pass | flash model + menu test |
| **Real life-loss save on hardware** | **pass** | HC007 cart, normal build `5a9378...` |
| **Power-cycle load on hardware** | **pass** | HC007 cart |
| **Delete on hardware** | **pass** | HC007 cart |

Rebuild and test:

```powershell
python games/sml2/tools/build_save.py
python patcher/rom_patch.py check games/sml2/recipe.json
python patcher/rom_patch.py apply games/sml2/recipe.json
node games/sml2/tools/test_save_emulator.mjs
node games/sml2/tools/test_save_after_level.mjs
node games/sml2/tools/test_death_flash.mjs

# no-flash debug build for hardware isolation
python patcher/rom_patch.py apply games/sml2/recipe-noflash.json

# reader-path screenshot with a seeded log
python games/sml2/tools/seed-log.py roms/sml2-hc007.gb analysis/crafted.sav --out games/sml2/build/sml2-seeded.gb
node tools/sram_trace.mjs games/sml2/build/sml2-seeded.gb `
  --script "wait:200;tap:START:30;wait:200" `
  --shot games/sml2/analysis/seeded-menu.png
```

## Distribution patch

`patcher/rom_ips.py` creates a standard IPS against the original 512 KiB ROM.
The full patch includes the 0xFF extension so any IPS tool produces the exact
1 MiB image; the minimal patch is ~1.3 KiB and needs `--pad-to 0x100000
--pad-byte 0xFF` (or a flasher that fills new banks with erased flash).

```powershell
python patcher/rom_ips.py make --recipe games/sml2/recipe.json --patch games/sml2/ips/sml2-hc007.ips
python patcher/rom_ips.py make --recipe games/sml2/recipe.json --patch games/sml2/ips/sml2-hc007-min.ips --no-pad
python patcher/rom_ips.py apply games/sml2/ips/sml2-hc007.ips `
  "roms/roms-to-patch/Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb" `
  rebuilt.gb --expect-sha1 5a9378036073fb3f3b7dbff1c6dff6f56c166009
```

The full SML2 patch is about 525 KiB (the extension is explicit 0xFF); the
minimal patch is about 1.3 KiB.  The generated files, SHA-1s and application
instructions are in `games/sml2/ips/README.md` and `games/sml2/ips/manifest.json`.
The no-flash debug build has the same full/min pair.

## Hardware validation

**Passed on the HC007 cart** with the normal build (`5a9378...`):

- boot to file select, world map and level rendering;
- life-loss save without a reset;
- save restore after power-cycle;
- delete flow.

The no-flash build (`fa8557...`) remains available for regression.  Optional
long-term checks: repeated save/delete cycles, full-log erase/wear, and modes
not covered by the test route.  Keep a known-good recovery image and the
original ROM available for any future patch work.

## Known deviations (found in the 2026-11-12 review)

None of these was shown to cause the late-game glitches the user reported
(they largely vanished after re-flashing, so a marginal flash is the leading
explanation), but the next game should not copy them.

- **Scratch RAM is live game RAM.**  `SAVE_SCRATCH 0xB600-0xB8FF` and
  `BOOT_SCRATCH 0xAD00-0xAFFF` receive a WRAM copy and are never restored.
  Death/level-end saves changed ~640-780 bytes there.  The game writes
  `0xB600-0xB8FF` around transitions (bank `0x13` copy at `0x3E2B`, bank 9 at
  `0x39F`); the earlier "quiet" claim came from one early-level trace.  An A/B
  test on the original ROM (clobber at `0x2934` entry, 6 seeds, ~50 saves)
  showed no VRAM divergence.
- **Flags in game SRAM.**  `BOOT_FLAG 0xB0E0` and `FLASH_OVERRIDE 0xB0E1` are
  in game work RAM, against the repo guardrail.
- **MBC1 -> MBC5 semantics.**  The game writes bank `0xFF` and `0` through the
  helper at `0x2BFB` (game state `0x0C`, caller bank `0x0F` `0x54C9`, tilemap
  upload to `0x9800`), which MBC1 masked/remapped to banks `0x1F` and `1`.  A
  lockstep run of original vs MBC5-only diverged briefly (WRAM, then one VRAM
  byte) and re-converged within ~40 frames.  In-level play was bit-identical
  for 8000 frames.
- **Not yet verified:** multi-level play on the cart and the first full-log
  erase (after 33 records).
- **Bisect builds:** `sml2-hc007.gb` (full), `sml2-hc007-noflash.gb` (journal
  path, `JP 0x484D` skips program/erase), and an MBC5-only build (no hooks)
  generated from the recipe's MBC5 edits.

## Open questions

The main hardware questions are answered by the pass: the flash path completes,
banks `0x20`/`0x24` map, the save survives power-cycle, and the delete flow
works.  Remaining optional checks:

1. Long-term wear and full-log erase after many save/delete cycles.
2. Modes or levels not covered by the test route.
3. Re-run the emulator and IPS round-trip after any source/recipe change.
