# Testing

Two separate problems: the **reader path** can be tested in emulators with
seeded records, and the **writer path** can be exercised with a small NOR-flash
model.  Real flash timing, SRAM disable/re-enable and bank mapping still need
the real cart.

## 1. Static checks (no emulator)

For each recipe:

```powershell
python tools/rom_inspect.py roms\<patched>.gb
python patcher/rom_patch.py check games\<slug>\recipe.json
```

Check:

- [ ] header `0x147` unchanged unless deliberately converted;
- [ ] `0x148` matches the padded image size;
- [ ] `0x149` is ≤ 8 KiB unless banked SRAM is proven;
- [ ] header checksum recomputed;
- [ ] global checksum recomputed;
- [ ] Nintendo logo intact;
- [ ] log sector lies in a blank 64 KiB sector;
- [ ] no hook overwrites the start of an adjacent function.

## 2. Reader path (emulator)

The flash log is a normal ROM window, so you can pre-seed records into a copy of
the patched image at the file offset that maps to the log:

```
file offset = bank * 0x4000 + (cpu_address - 0x4000)
```

For a log at bank `0x20`, CPU `0x6000`: file offset `0x82000`.

A reader test should cover:

1. **Blank log:** the game boots and sees its normal "no save" state.
2. **One valid record:** the game loads the restored save.
3. **Two records for the same slot:** the later one wins.
4. **Torn record:** missing commit marker or bad checksum is ignored.
5. **Corrupt record:** bad checksum is ignored, older valid record survives.
6. **Delete record:** the game sees the deleted state.
7. **Full log:** compaction/erase path at boot.
8. **Boot hook:** the game reaches its original entry and plays.
9. **Save hook:** install a small NOR-flash model for the log window and answer
   the flash ID probe, then verify the hook builds a valid record.
10. **After a real level load:** reach an actual level, let the game overwrite
    its work RAM, then trigger a save.  This catches patch code stored in a
    region the game reuses.
11. **Natural save event:** drive the real death/level-complete/menu action
    with the flash model; a synthetic jump to the hook is not enough.

Useful commands:

```powershell
# Boot the patched ROM and take a screenshot.
node tools/gb_harness.mjs --rom roms\<patched>.gb --title --frames 240 --out shot.png

# Trace SRAM reads at boot to confirm the restore happened.
node tools/sram_trace.mjs roms\<patched>.gb --frames 300 `
  --json games\<slug>\analysis\trace-patched-boot.json
```

Case tools provide concrete versions of these tests.  For SML2:

- `games/sml2/tools/make-save.py` builds a valid SRAM image;
- `games/sml2/tools/seed-log.py` writes a log record into a patched ROM;
- `test_save_emulator.mjs` is the synthetic save/delete/full-log test;
- `test_save_after_level.mjs` enters a real level first, then saves;
- `test_death_flash.mjs` follows the natural death/transition with the
  NOR-flash model.

Use the same structure for a new case: one synthetic test, one
after-level test, one natural-event test, and a boot/reader test.

Also check the game's own visual/state transition after the save.  A correct
record is not enough if the game resets immediately after the call.

## 3. Writer path (hardware)

Only the cart can validate programming and erase.  The probe already confirmed
program/erase in MBC1, MBC3 and MBC5 mode; see `docs/HARDWARE.md`.

1. Flash the patched image, then **read the cart back and compare its SHA-1**
   with the built image (or flash twice and compare).  A marginal flash can
   cause random tile corruption that looks like a patch bug; SML2 showed
   glitches that largely vanished after re-flashing the same builds.
2. Create a save in-game.
3. Power off, wait, power on.
4. Confirm the save loads.
5. Delete the save in-game.
6. Power off, wait, power on.
7. Confirm the save stays deleted.
8. Create a different save and power-cycle again (log append path).
9. Reflash the image and confirm the save resets (blank log sector).
10. If the full build fails, flash the no-flash debug build; passing isolates
    the manager/stack/bank path from the flash programming/erase path.
11. Repeat for each mapper family and each case.
12. **Play several levels** (not just one save): level end, death, map
    transitions.  If glitches appear, bisect on the cart: a build with only
    the mapper conversion (no hooks), the no-flash build, then the full build.
    The first full-log erase happens only after the log fills (SML2: 33
    records), so test it deliberately.

**Do not** test a new flash layout on a game you cannot reflash/recover.  Keep
the original ROM and a known-good recovery image available.

## 4. Emulators

### serverboy (fast functional harness)

- `tools/serverboy/` is the copied package.
- `tools/gb_harness.mjs` exports `loadRom`, `run`, `readMem`, `holdKey`,
  `tapKey`, `savePng`.
- Forces DMG by default; pass `{ cgb: true }` (or `GB_CGB=1` for
  `sram_trace.mjs`) for CGB.

```js
import { loadRom, readMem, tapKey } from './tools/gb_harness.mjs';
const gb = loadRom('roms/patched.gb', undefined, { skipTitle: true });
```

### Gearboy (accuracy / visual oracle)

- GUI: `tools\gearboy\Gearboy.exe roms\game.gb`
- Headless MCP:
  `tools\gearboy\Gearboy.exe --headless --mcp-stdio --portable roms\game.gb`
- `tools/gearboy_mcp_example.mjs` is a working JSON-RPC client.

Useful Gearboy MCP tools:

| Tool | Notes |
|---|---|
| `get_media_info` | ROM path, title, mapper, sizes |
| `debug_step_frame` | `{ frames, mode: "sync" }` deterministic stepping |
| `controller_button` | `{ player: 1, button: "start", action: "press_and_release" }` |
| `read_memory` | `{ area, offset, size }`; area 6 = 8 KiB WRAM from `0xC000` |
| `write_memory` | same scheme |
| `get_screenshot` | base64 PNG |
| `get_cpu_status` | CPU state |
| `save_state` / `load_state` | save-state slots |

Note: `read_memory` area 4 is only the first 4 KiB of WRAM; use area 6 for
`0xC000-0xDFFF`.

## 5. Hardware probe and controlled test ROM

Use these after any hardware change (new cart revision, new flash chip):

```powershell
pwsh -File tools/build_probe.ps1 -Clean
pwsh -File tools/build_testrom.ps1 -Clean
```

- `roms/mapperprobe-mbc1.gb`, `-mbc3.gb`, `-mbc5.gb`: ID/program/erase and
  SRAM bank test.
- `roms/testrom-mbc1.gb`, `-mbc3.gb`, `-mbc5.gb`: SRAM + flash journal,
  A-save / power-cycle / START-clear.

## 6. Regression checklist for the toolchain

- [ ] `rom_inspect.py` reports sane values for all fixtures.
- [ ] `gbdis.py` disassembles known test ROM entry points correctly.
- [ ] `sram_trace.mjs` reports no `PC` outside ROM/WRAM/RAM.
- [ ] `rom_patch.py` rejects a wrong source SHA-1.
- [ ] `rom_patch.py` report lists every changed byte.
- [ ] `rom_ips.py` round-trips the patched image and matches the target SHA-1.
- [ ] Patched ROM boots in serverboy and Gearboy.
- [ ] Reader test with a seeded log passes.
- [ ] Save after a real level load passes.
- [ ] Natural save event with a NOR-flash model passes.
- [ ] No-flash debug build boots and survives the same event.
- [ ] Hardware power-cycle test passes.
- [ ] Reflash resets the save.

## 7. Compatibility matrix

For every candidate ROM record:

- title, SHA-1, mapper, ROM size, SRAM size, RTC;
- strategy and hook points;
- boot/play, save, load, delete, power-cycle;
- visual/timing issues;
- status (`works`, `quirk`, `hardware-smoke`, `emulator-ready`, `fails`,
  `unsupported`, `investigating`).

Template: `docs/COMPATIBILITY.md`.
