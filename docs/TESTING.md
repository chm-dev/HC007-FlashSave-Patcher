# Testing

Two separate problems: the **reader path** can be tested in emulators, the
**writer path** needs the real cart (emulators drop ROM writes).

## 1. Reader path (emulator)

The journal lives in a normal ROM window, so you can pre-seed records into a
copy of the patched image at the file offset that maps to the log:

```
file offset = bank * 0x4000 + (cpu_address - 0x4000)
```

For the standard log (bank `0x1C`, CPU `0x6000`): **file offset `0x72000`**.

A reader test should cover:

1. Header: size, `0x147`, `0x148`, `0x149`, header checksum.
2. Blank journal: the game boots and sees its normal "no save" state.
3. One valid page/header record: the game loads the restored SRAM.
4. Two records for the same page: the later one wins.
5. Torn record (missing commit marker / bad checksum): ignored.
6. Full log: compaction/erase path at boot.
7. Boot trampoline: the game starts normally and its entry point is reached.

The Robbo port's `docs/examples/checkpoint30.mjs` is a working reference for
seeding records into a ROM copy and booting it with the serverboy harness.

## 2. Writer path (hardware)

Only the cart can validate programming and erase.

1. Flash the probe and confirm ID + program + erase (see `docs/HARDWARE.md`).
2. Flash the patched game.
3. Play until the game writes a save.
4. Power off, wait, power on.
5. Confirm the save loads.
6. Delete the save in-game, power-cycle, confirm it stays deleted.
7. Reflash the image and confirm the save is reset (the log sector is `0xFF`
   padding again).
8. Repeat for each mapper family (MBC1/MBC3/MBC5) and each test game.

## 3. Emulators available here

### Gearboy (accuracy / visual oracle)

- GUI: `tools\gearboy\Gearboy.exe roms\mapperprobe-mbc1.gb`
- Headless MCP over stdio:
  `tools\gearboy\Gearboy.exe --headless --mcp-stdio --portable roms\mapperprobe-mbc1.gb`
- `tools/gearboy_mcp_example.mjs` is a working JSON-RPC client example.

Useful Gearboy MCP tools (names in this build):

| Tool | Notes |
|---|---|
| `get_media_info` | ROM path, title, mapper, sizes |
| `debug_step_frame` | `{ frames, mode: "sync" }` for deterministic stepping |
| `controller_button` | `{ player: 1, button: "start", action: "press_and_release" }` |
| `read_memory` | `{ area, offset, size }`; **area 6 = 8 KiB WRAM**, offset from `0xC000` |
| `write_memory` | same area/offset scheme |
| `get_screenshot` | returns an MCP image content item (base64 PNG) |
| `get_cpu_status` / `get_lcd_registers` | CPU/LCD state |
| `save_state` / `load_state` | save-state slots |
| `get_profiler_data` | function profiler |

Note: `read_memory` area 4 is only the first 4 KiB of WRAM; use area 6 for
`0xC000-0xDFFF`. The older `press_and_release` tool name does not exist in this
build; use `controller_button`.

### serverboy (fast JS harness)

- `tools/serverboy/` is the copied package.
- `tools/gb_harness.mjs` exports `loadRom`, `run`, `readMem`, `holdKey`,
  `tapKey`, `savePng`.
- It forces DMG mode by default; pass `{ cgb: true }` for CGB.

Typical use:

```js
import { loadRom, readMem, holdKey } from './tools/gb_harness.mjs';
const gb = loadRom('roms/patched.gb', undefined, { skipTitle: true });
```

Serverboy is not a timing oracle, but it is fast for boot/save/menu tests.

## 4. Compatibility matrix

For every candidate ROM record:

- title, SHA-1, mapper, ROM size, SRAM size, RTC,
- hook mode and parameters,
- boot/play, save, load, delete, power-cycle,
- visual/timing issues,
- status (`works`, `works with quirk`, `fails`, `unsupported`).

Template: `docs/COMPATIBILITY.md`.

## 5. Regression checklist for the patcher

- [ ] `python patcher/hc007_patcher.py plan <rom>` reports sane values.
- [ ] Header checksum recomputed after patching.
- [ ] Global checksum recomputed.
- [ ] Nintendo logo untouched.
- [ ] Patched ROM boots in Gearboy and serverboy.
- [ ] Reader test with seeded journal passes.
- [ ] Hardware power-cycle test passes.
- [ ] Reflash resets the save.
- [ ] No writes to sectors containing code (verify the log offset).
