# SML2 handoff - 2026-11-12

## Current state

- Build: `roms/sml2-hc007.gb`, 1 MiB, MBC5, SHA-1
  `5a9378036073fb3f3b7dbff1c6dff6f56c166009`.
- **Root cause of the life-loss reset found:** SML2 uses SRAM as work RAM
  and overwrites `0xAD00-0xB0DF` during level loading.  The previous patch
  kept its manager and journal source there, so the save hook at `0x3147`
  executed game data and reset the console.
- The journal now lives in **ROM bank `0x24`**.  Only a small
  bank-switching helper is copied to WRAM `0xC100` for the duration of a
  save/restore; the game's WRAM block is backed up to SRAM and restored.
- Emulator tests pass:
  - blank boot, file-select, world map and level;
  - synthetic save/delete/append/duplicate/full-log erase;
  - a save **after a real level load**, with the old SRAM area overwritten;
  - a **natural death/level transition** with a NOR-flash model, producing a
    valid record;
  - delete persistence and boot restore.
- **Hardware-pass.**  The normal build was tested on the HC007 cart: boot,
  life-loss save without reset, power-cycle/load, and delete all work as
  expected.  The no-flash debug build remains available as
  `roms/sml2-hc007-noflash.gb` (SHA-1
  `fa8557672acf8e5ae6408ddf05bfd797b1c071ae`) for regression.
- Distribution IPS patches are generated for the original 512 KiB ROM:
  - `games/sml2/ips/sml2-hc007.ips` (full 1 MiB result, ~525 KiB patch);
  - `games/sml2/ips/sml2-hc007-min.ips` (~1.3 KiB; apply with
    `--pad-to 0x100000 --pad-byte 0xFF` or let the flasher pad);
  - the same pair for the no-flash debug build;
  - SHA-1s and application instructions: `games/sml2/ips/README.md` and
    `games/sml2/ips/manifest.json`.

## Root cause evidence

`games/sml2/analysis/trace-patched-boot.json` and a longer gameplay trace
showed:

- the old manager at SRAM `0xAD00-0xADFF` was overwritten at frames 815-816
  by bank 3 code during a level load;
- the old journal source at `0xAE00-0xB0DF` was overwritten from frame 819
  onward;
- the new `test_save_after_level.mjs` counts 40,892 writes to
  `0xAD00-0xB0DF` during a level load plus 800 gameplay frames;
- after a level load, 81/90 manager bytes and 689/733 journal bytes differed
  from the ROM blob;
- the next save called `0xAD1D`, which was by then game data.

The earlier emulator tests jumped to the save hook immediately after boot,
before a level load could overwrite the manager, which is why they passed.

## What changed this session

1. **Journal code moved to bank `0x24`:** save/boot/scan code at
   `0x4800-0x49EF`; the 0x190-byte WRAM helper source at `0x4C00`.
2. **WRAM helper, not a permanent WRAM journal:** the helper is copied from
   ROM to WRAM `0xC100` at the start of each save/restore, and the game's
   `0xC100-0xC3FF` block is backed up to:
   - SRAM `0xB600-0xB8FF` for in-game saves (quiet in the level/death
     traces);
   - SRAM `0xAD00-0xAFFF` for the boot restore (the old manager area).
3. **Bank restore moved to bank 0:** the save/clear hooks restore `0xA24E`
   after the bank `0x24` journal returns; the boot hook restores `0x0C`
   after the bank `0x24` boot code returns.  Switching the bank inside bank
   `0x24` code would unmap the `EI`/`RET` that follows.
4. **Hook layout:**
   - save `0x1967` (20 bytes);
   - clear `0x197B` (20 bytes);
   - boot `0x1AFF` (24 bytes, 27-byte cave).
5. **MBC5 fix unchanged:** 22 `LD (0x3000),A` sites retargeted to
   `0x2000`.
6. **New tests:**
   - `games/sml2/tools/test_save_after_level.mjs` - enters a level, calls the
     save hook, verifies the WRAM restore and boot restore;
   - `games/sml2/tools/test_death_flash.mjs` - natural death/transition with
     a NOR-flash model, verifies a valid record;
   - `games/sml2/tools/test_save_emulator.mjs` - existing save/delete/full-log
     tests, now also exercising the natural flash-ID probe.

## Key addresses

| Item | Address |
|---|---|
| Save hook | `0x1967` (all 11 `CALL 0x2934` sites) |
| Clear hook | `0x197B` (from bank `0x0C` `0x4227`) |
| Boot hook | `0x1AFF` (from bank `0x0C` `0x4034`) |
| Relocated CLEAR body | bank `0x24` `0x4500` |
| Boot code | bank `0x24` `0x4000` |
| Journal code | bank `0x24` `0x4800` |
| WRAM helper source | bank `0x24` `0x4C00` |
| WRAM helper runtime | `0xC100-0xC3FF` |
| Save WRAM backup | SRAM `0xB600-0xB8FF` |
| Boot WRAM backup | SRAM `0xAD00-0xAFFF` |
| Log | bank `0x20`, CPU `0x6000`, file `0x82000` |

## Lessons learned

- **Do not store patch code or data in game SRAM or WRAM without proving it
  is free in every mode.**  SML2 uses SRAM `0xAD00-0xB0DF` during level
  loading and WRAM `0xC100-0xC3FF` during gameplay.
- **A bank switch inside switchable-bank code unmaps the following
  instructions.**  `EI` and `RET` must run from bank 0 after the bank
  restore.
- **A save hook must preserve the caller's bank.**  The journal returns with
  bank `0x24` selected; the bank-0 hook restores `0xA24E`.
- **A synthetic hook call right after boot is not a save-path test.**  Let a
  level load happen first; that is what broke the previous design.
- **The flash ID probe is read-only and can be tested in emulators** with a
  small model; the program/erase timing still needs hardware.

## Next experiments

**None required.**  The case is hardware-pass.  Optional long-term checks:

1. Repeated save/delete cycles and full-log erase/wear.
2. Levels/modes not covered by the test route, if a future regression appears.
3. Re-run the emulator and IPS verification after any source/recipe change.

Record any new result in `docs/COMPATIBILITY.md`, `games/sml2/notes.md` and
`games/sml2/ips/manifest.json`.

## Distribution patch

Generate an IPS from the original ROM after rebuilding the target:

```powershell
python games/sml2/tools/build_save.py
python patcher/rom_patch.py apply games/sml2/recipe.json
python patcher/rom_ips.py make --recipe games/sml2/recipe.json --patch games/sml2/ips/sml2-hc007.ips
python patcher/rom_ips.py make --recipe games/sml2/recipe.json --patch games/sml2/ips/sml2-hc007-min.ips --no-pad
```

The full patch includes the 0xFF extension, so any IPS patcher produces the
exact 1 MiB image.  The minimal patch must be applied with
`--pad-to 0x100000 --pad-byte 0xFF` (our `rom_ips.py apply`) or with a
flasher that fills new banks with erased flash.

## Files

- `games/sml2/README.md` - case entry point, status and outputs.
- `games/sml2/recipe.json` - main recipe.
- `games/sml2/recipe-noflash.json` - debug recipe that skips journal writes.
- `games/sml2/src/sml2_save.asm` - hooks, boot code, journal, WRAM helper.
- `games/sml2/src/legacy/sml2_save_sram.asm` - previous SRAM-manager design,
  kept for reference.
- `games/sml2/tools/build_save.py` - builds `hooks.bin`, `boothook.bin`,
  `boot.bin`, `clear.bin`, `journal.bin`, `wram.bin`.
- `games/sml2/tools/test_save_emulator.mjs` - synthetic save/delete test.
- `games/sml2/tools/test_save_after_level.mjs` - save after a real level load.
- `games/sml2/tools/test_death_flash.mjs` - natural death/transition with a
  NOR-flash model.
- `games/sml2/tools/death_probe.mjs` - route/state probe.
- `games/sml2/tools/check_wram_restore.mjs` - boot WRAM-restore check.
- `games/sml2/ips/` - distributable IPS patches, manifest and instructions.
- `games/sml2/notes.md` - full evidence and root-cause section.
- `docs/START_HERE.md` - short session handoff.
