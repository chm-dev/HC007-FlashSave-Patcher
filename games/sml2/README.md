# Super Mario Land 2: 6 Golden Coins

## Status

**Hardware-pass.**  The life-loss reset root cause was found and fixed in the
emulator: a level load overwrites SRAM
`0xAD00-0xB0DF`, where the previous patch kept its manager and journal source.
The patch now keeps all code in ROM bank `0x24` and copies only a small helper
to WRAM `0xC100` on demand.

| Item | Value |
|---|---|
| Build | `roms/sml2-hc007.gb` |
| SHA-1 | `5a9378036073fb3f3b7dbff1c6dff6f56c166009` |
| No-flash debug build | `roms/sml2-hc007-noflash.gb` |
| No-flash SHA-1 | `fa8557672acf8e5ae6408ddf05bfd797b1c071ae` |
| Hardware | hardware pass on the HC007 cart |
| IPS page | `games/sml2/ips/README.md` |
| Full IPS | `games/sml2/ips/sml2-hc007.ips` |
| Minimal IPS | `games/sml2/ips/sml2-hc007-min.ips` |
| Manifest | `games/sml2/ips/manifest.json` |

**Scope of the pass:** boot, world map, one life-loss save, power-cycle load
and delete.  A later long playtest showed corrupted tiles that largely went
away after re-flashing all builds, so a marginal flash is the leading
explanation; the patch design has known deviations (see `notes.md`, "Known
deviations") that were not shown to cause it.

## First test to run

```powershell
python games/sml2/tools/build_save.py
python patcher/rom_patch.py check games/sml2/recipe.json
python patcher/rom_patch.py apply games/sml2/recipe.json
node games/sml2/tools/test_save_emulator.mjs
node games/sml2/tools/test_save_after_level.mjs
node games/sml2/tools/test_death_flash.mjs
```

## Hardware test

**Passed on the HC007 cart.**  The normal build (`5a9378...`) boots, renders
the world map and level, survives the life-loss save without a reset, restores
the save after a power-cycle, and the delete path works.  The no-flash build
and the IPS patches remain in the case for regression and future hardware
checks.

## What is known

- Source: MBC1 + RAM + battery, 512 KiB, 8 KiB SRAM, SHA-1
  `bba408539ecbf8d322324956d859bc86e2a9977b`.
- SRAM **and** WRAM are work RAM: stack at `SP=0xA8FF`; a level load overwrites
  SRAM `0xAD00-0xB0DF`; gameplay uses WRAM `0xC100-0xC3FF`.
- Save slots at `0xA000`, `0xA050`, `0xA0A0`; writer `0x2934`; validator
  `0x28D9`; CLEAR path bank `0x0C` `0x4227`.
- The patch converts the header to MBC5, pads to 1 MiB, retargets the 22 MBC1
  `0x3000` bank writes to `0x2000`, and puts the log at `0x80000` (bank
  `0x20`).
- Hooks: save `0x1967`, clear `0x197B`, boot `0x1AFF`.
- Journal code bank `0x24` `0x4800`; WRAM helper source `0x4C00`; helper
  runtime `0xC100-0xC3FF`; save backup SRAM `0xB600-0xB8FF`; boot backup
  SRAM `0xAD00-0xAFFF`.
- Full evidence and root cause: `notes.md`; session handoff: `HANDOFF.md`.

## Files

- `case.json` - identity, strategy, addresses, status.
- `notes.md` - full evidence, root cause, tests and open questions.
- `HANDOFF.md` - short session handoff.
- `recipe.json` / `recipe-noflash.json` - patch recipes.
- `src/` - patch assembly and the legacy SRAM-manager source.
- `tools/` - blob build, log seeding, save tests, route probe.
- `ips/` - distributable patches, manifest and apply instructions.
- `analysis/` - inventory, listings, traces, screenshots, crafted saves.
