# HC007 FlashSave Patcher

A separate project for adding **batteryless save support** to Game Boy / Game Boy
Color ROMs on the bootleg **HC007-BGA-V2** cartridge (M29W640 8 MiB NOR flash,
SRAM, no battery).

This is not part of the Robbo DMG port. The Robbo port proved the flash method
(see `docs/FLASH_SAVE_METHOD.md`); this project turns it into a reusable
**binary patcher** for other ROMs.

## Current status (handoff)

- **Hardware characterised:** flash ID/program/erase work; unlock bytes are
  `0xA9/0x56` (D0/D1 swapped).
- **Flash works in every mapper mode:** the mapper probe reports
  `PROG err=00 rd=5A` and `ERASE err=00 rd=FF` with MBC1, MBC3 and MBC5
  headers. The mapper forwards writes even when CPU `0x6000` is also a mapper
  register, so a patched game can keep its original header.
- **SRAM:** the probe's 4-bank test fails in all three modes, so only **bank 0
  (8 KiB)** is verified. Treat 32 KiB games as unsupported until a dedicated
  SRAM test proves banked SRAM.
- **Mapper is header-switched:** MBC1, MBC3 and MBC5 games all boot and play.
  Saves work while powered and are lost at power-off (expected: no battery).
- **Probe ROMs are built:** `roms/mapperprobe-mbc1.gb`, `-mbc3.gb`, `-mbc5.gb`
  (512 KiB, 32 KiB RAM header, header `0x147` = `03`/`13`/`1B`).
- **Patcher skeleton works:** `patcher/hc007_patcher.py info|plan|patch ROM` parses
  the header, checks HC007 limits, finds free 64 KiB sectors and proposes the log
  bank/window.
- **Controlled test ROM built and hardware-validated:** `roms/testrom-mbc1.gb`,
  `-mbc3.gb`, `-mbc5.gb` (16-bit counter, SRAM copy, flash journal, A/B/START).
  All three passed the A-save / power-cycle / START-clear test on the cart.
- **Patcher prototype works on the plain ROM in emulators:** the journal blob is
  injected at `0x2000`, the boot trampoline restores SRAM from the log, and the
  VBlank hook journals changed pages.  `tests/patched_plain_reader.mjs` passes.
- **Hardware status:** the first patched plain ROMs white-screened on the cart
  (GBC and DMG).  A likely cause was the boot trampoline using the boot ROM's
  HRAM stack; `j_boot` now switches to `SP=0xE000`.  The blob and patched ROMs
  are rebuilt; **hardware retest pending**.  See `docs/STATUS.md` for the full
  symptom list, verified non-causes and isolation plan.

## Quick start

```powershell
# Rebuild the three mapper probe variants (reference)
pwsh -File tools/build_probe.ps1

# Inspect a ROM and print a patch plan
python patcher/hc007_patcher.py info path\to\game.gb
python patcher/hc007_patcher.py plan path\to\game.gb

# Run the probe in Gearboy (GUI)
tools\gearboy\Gearboy.exe roms\mapperprobe-mbc1.gb
```

## What to do next

1. **Reflash the rebuilt patched plain ROMs** (`roms/plain-mbc5-patched.gb`,
   then MBC1/MBC3): press A, wait ~3 s, power-cycle, check the counter. If they
   still white-screen, follow the isolation plan in `docs/STATUS.md`.
2. Generalize the patcher to arbitrary 512 KiB targets: find a free
   `0x2000..0x3FFF` region and a blank log sector, and pad smaller ROMs.
3. Track the game's current ROM bank (or keep the hook in bank 0 without
   switching) so banked games work.
4. Add a compatibility database and per-game overrides.

## Directory map

| Path | Purpose |
|---|---|
| `probe/mapperprobe.c` | Mapper-aware probe (MBC1/MBC3/MBC5 header variants) |
| `probe/flashprobe.c` | Original verified HC007 flash probe (reference) |
| `testrom/` | Controlled save test ROM (SRAM + flash journal, MBC1/MBC3/MBC5) |
| `tools/build_probe.ps1` | Builds the three probe ROMs |
| `tools/build_testrom.ps1` | Builds the three test ROMs |
| `tools/build_plain.ps1` | Builds the plain patcher-target ROMs |
| `tools/gbdk/` | GBDK-2020 toolchain (copied) |
| `tools/gearboy/` | Gearboy emulator with headless MCP (copied) |
| `tools/serverboy/` | serverboy JS emulator (copied) |
| `tools/gb_harness.mjs` | Fast serverboy test harness (copied, paths adjusted) |
| `tools/gearboy_mcp_example.mjs` | Gearboy MCP client example |
| `patcher/hc007_patcher.py` | Header parser / planner / `patch` command |
| `patcher/journal/` | Injectable journal blob (boot restore + VBlank writer) |
| `docs/` | Hardware notes, method, mapper analysis, design, testing |
| `roms/` | Build outputs (git-ignored) |

## Docs index

- `docs/START_HERE.md` - one-page handoff for a new session.
- `docs/STATUS.md` - current hardware failure, verified non-causes, next tests.
- `docs/HARDWARE.md` - HC007 board facts and probe results.
- `docs/MAPPER_MODES.md` - MBC1/MBC3/MBC5 register maps and the flash-write conflict.
- `docs/FLASH_SAVE_METHOD.md` - the proven WRAM flash driver / append-only log method.
- `docs/PATCHER_DESIGN.md` - binary patcher architecture (trampoline, journal, hooks).
- `docs/TESTING.md` - emulator and hardware test procedures.
- `docs/COMPATIBILITY.md` - compatibility matrix template.
