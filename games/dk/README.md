# Donkey Kong (Game Boy, 1994)

## Status

- Stage: **hardware-pass** - build 6 (`roms/dk-hc007.gb`) retains savegames on a known-good cart. The earlier freezes were a faulty test cart, and the 0x4000-0x5FFF record layout was a suspected, unproven cause; build 6 keeps records in 0x6000-0x7FFF as a safe default.
- Normal build: `roms/dk-hc007.gb`
- Debug build (hooks + full journal, **never writes flash**): `roms/dk-hc007-noflash.gb`
- IPS: `games/dk/ips/dk-hc007.ips`, `dk-hc007-noflash.ips` (apply -> same SHA-1, see `ips/manifest.json`)
- Hardware: boot, hooks, stub on the game stack, scan, compare, WRAM backup passed as build `t4`.  The normal build (flash path) froze at the title in build 5 (records straddled `0x4000-0x5FFF`); that freeze was later traced to a faulty test cart. Build 6 uses `0x6000-0x7FFF` only and passes on a known-good cart.

## Rebuild and test

```powershell
python games/dk/tools/build_save.py
python patcher/rom_patch.py apply games/dk/recipe.json
python patcher/rom_patch.py apply games/dk/recipe-noflash.json
node games/dk/tools/test_save_emulator.mjs          # 23 checks; model rejects flash writes below 0x6000
node games/dk/tools/test_mbc5_lockstep.mjs          # MBC1 original vs MBC5-only, frame-identical
node games/dk/tools/test_poweron_garbage.mjs roms/dk-hc007.gb 6 [--hostile4000 --hostile2000]
node games/dk/tools/test_natural_flow.mjs games/dk/build/test-flash-progress.bin
node games/dk/tools/gearboy_check.mjs roms/dk-hc007.gb   # second emulator
python patcher/rom_ips.py make --recipe games/dk/recipe.json --patch games/dk/ips/dk-hc007.ips
```

## Next hardware test

1. `roms/dk-hc007.gb`: boots, Select File, new game on File 1 plays.  The first START writes record #0 to flash
   (expect a short pause, interrupts are off while it programs).
2. Play through the first set of levels (~4), answer **yes** at the save prompt, power off, wait, power on:
   Select File must show File 1 with the saved progress.  Continue it.
3. Save a second file, then **CLEAR** one; power-cycle; it must stay cleared.
4. (Rare) After 64 distinct commits the log sector is erased and restarts at record 0.

If it freezes, tell me where (title / Select File / save prompt) and for how long; the no-flash build is the control.

## What is known

See `notes.md`.  3 save files; persistent state = SRAM `A000-A18F` (score table) + `BE2A-BFFF` (checksum, mirror, slot
headers, signature) = 0x366 bytes.  The patch journals exactly that after every persistent writer (progress, CLEAR, init,
slot counters, file selection, score table) and restores it at the reset entry (after zeroing cart RAM, because real SRAM
powers up with garbage).

## Hardware history (why the stub looks the way it does)

| Round | Result | Lesson |
|---|---|---|
| 1-2 | full builds freeze at title after START; mapper-only, boot-only and pass-through-hook builds fine | fault is in the stub body |
| 3 | `s1` (DI, 0x4000 write, EI) works, `s2` (+ SP/vars in SRAM) freezes, even with SRAM re-enable | not the bank register |
| 4 | `t1` bank restore ok, `t2` SRAM vars ok, **`t3` SP switched into SRAM freezes**, `t4` full stub on the game stack ok | **never put SP in cart SRAM** |
| 5 | no-flash build ok, **flash build freezes at title** | records were spread over 0x4000-0x7FFF.  Suspected (unproven) cause: data writes below 0x6000 hit the RAM-bank register.  The freeze turned out to be a faulty test cart.  Model now rejects such writes as a conservative rule; 32 records in the 0x6000-0x7FFF windows |

Both emulators (serverboy, Gearboy) ran every failing build fine.

## Open questions / risks

- **Flash path untested on this cart** for DK (the unlock sequences are SML2's hardware-proven ones, run from WRAM).
- SRAM scratch `A500-A60F` is assumed unused by the game (no access found statically or in traces; the no-flash build uses it and works).
- `B4C0-BBFF` / `BBC0..` SRAM is **not** journaled and is zeroed at boot.  Evidence it is work-RAM snapshots, not save data: no
  checksum/signature, never cleared by init, saver/loader pairs sit in one session (`4E6D`/`4EC2` around state 0x2B,
  `42C8`/`3048` around level start); a zeroed restore starts the level fine.  If something looks wrong at level start after
  continuing a saved game, report it.
- Boot code zeroes cart RAM whenever the log has no valid record (needed: power-on garbage in BE2A-BFBD would otherwise be
  journaled and make the validator wipe the save).  Side effect: an emulator `.sav` is cleared at boot while the log is empty.
- Stack use is ~16 bytes below the caller's SP on the game's HRAM stack; entries seen had SP >= 0xFFF8.  Sites not yet
  exercised (CLEAR, counters, score table) could sit deeper.
- Commit stub ends with an unconditional `EI`; every natural entry traced had IME on.
- The score-table writer (bank 0x17 `0x750B`) is hooked but not exercised through the game's own flow.

## Files

- `case.json`, `notes.md` - identity and evidence.   - `recipe.json`, `recipe-noflash.json` - exact edits.
- `src/dk_save.asm` - patch source.   - `tools/` - build, tests, probes.   - `ips/` - distributable patches.
- `iso/` - recipes for the mapper-only / boot-only / pass-through isolation builds.   - `analysis/` - traces, screenshots.
