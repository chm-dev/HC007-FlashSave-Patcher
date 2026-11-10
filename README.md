# HC007 FlashSave Patcher

A separate project for adding **batteryless save support** to Game Boy / Game Boy
Color ROMs on the bootleg **HC007-BGA-V2** cartridge (M29W640 8 MiB NOR flash,
32 KiB SRAM, no battery).

This is not part of the Robbo DMG port. The Robbo port proved the flash method
(see `docs/FLASH_SAVE_METHOD.md`); this project turns it into a reusable
**binary patcher** for other ROMs.

## Current status (handoff)

- **Hardware characterised:** flash ID/program/erase work; unlock bytes are
  `0xA9/0x56` (D0/D1 swapped); 32 KiB SRAM works in 4 banks.
- **Mapper is header-switched:** MBC1, MBC3 and MBC5 games all boot and play on
  the cart. Saves work while powered and are lost at power-off (expected: the
  SRAM has no battery).
- **The decisive open question:** does flash program/erase still work while the
  mapper is in MBC1 or MBC3 mode? In those modes CPU `0x6000` is a mapper
  register (MBC1 mode select / MBC3 RTC latch), so the write may never reach
  the flash. The probe in `probe/mapperprobe.c` answers this.
- **Probe ROMs are built:** `roms/mapperprobe-mbc1.gb`, `-mbc3.gb`, `-mbc5.gb`
  (512 KiB, 32 KiB RAM, header `0x147` = `03`/`13`/`1B`).
- **Patcher skeleton works:** `patcher/hc007_patcher.py info|plan ROM` parses the
  header, checks HC007 limits, finds free 64 KiB sectors and proposes the log
  bank/window.

## Quick start

```powershell
# Build all three mapper probe variants
pwsh -File tools/build_probe.ps1

# Inspect a ROM and print a patch plan
python patcher/hc007_patcher.py info path\to\game.gb
python patcher/hc007_patcher.py plan path\to\game.gb

# Run the probe in Gearboy (GUI)
tools\gearboy\Gearboy.exe roms\mapperprobe-mbc1.gb
```

## What to do next

1. Flash `roms/mapperprobe-mbc1.gb` and `roms/mapperprobe-mbc3.gb` to the cart.
2. On each: press **A** (program), then **B** (erase). Report the screen lines
   (`HDR`, `MODE`, `ID`, `PROG`, `ERASE`, `SRAM4`).
3. Use the results to choose the flash-write strategy (see
   `docs/MAPPER_MODES.md`), then implement the boot trampoline + SRAM journal
   (`docs/PATCHER_DESIGN.md`).

## Directory map

| Path | Purpose |
|---|---|
| `probe/mapperprobe.c` | Mapper-aware probe (MBC1/MBC3/MBC5 header variants) |
| `probe/flashprobe.c` | Original verified HC007 flash probe (reference) |
| `tools/build_probe.ps1` | Builds the three probe ROMs |
| `tools/gbdk/` | GBDK-2020 toolchain (copied) |
| `tools/gearboy/` | Gearboy emulator with headless MCP (copied) |
| `tools/serverboy/` | serverboy JS emulator (copied) |
| `tools/gb_harness.mjs` | Fast serverboy test harness (copied, paths adjusted) |
| `tools/gearboy_mcp_example.mjs` | Gearboy MCP client example |
| `patcher/hc007_patcher.py` | Header parser / patch planner (skeleton) |
| `docs/` | Hardware notes, method, mapper analysis, design, testing |
| `roms/` | Build outputs (git-ignored) |

## Docs index

- `docs/START_HERE.md` - one-page handoff for a new session.
- `docs/HARDWARE.md` - HC007 board facts and probe results.
- `docs/MAPPER_MODES.md` - MBC1/MBC3/MBC5 register maps and the flash-write conflict.
- `docs/FLASH_SAVE_METHOD.md` - the proven WRAM flash driver / append-only log method.
- `docs/PATCHER_DESIGN.md` - binary patcher architecture (trampoline, journal, hooks).
- `docs/TESTING.md` - emulator and hardware test procedures.
- `docs/COMPATIBILITY.md` - compatibility matrix template.
