# Start here (new session handoff)

## What this project is

A binary patcher that adds batteryless saves to GB/GBC ROMs on the **HC007-BGA-V2**
cart (M29W640 8 MiB NOR flash, 32 KiB SRAM, no battery). The proven flash method
comes from the Robbo DMG port; this project generalises it.

## What is already known (verified on the real cart)

- Flash unlock bytes: **`0xA9/0x56`** (D0/D1 swapped). Plain `0xAA/0x55` fails.
- Flash ID: `20 00 7D 00` (ST/Numonyx M29W640).
- Program and erase from the GB CPU work (probe: `PROG err=00 rd=5A`,
  `ERASE err=00 rd=FF`).
- SRAM: 32 KiB, 4 × 8 KiB banks, all working.
- MBC1, MBC3 and MBC5 games boot and play on the cart. This means the mapper
  switches mode from the header (`0x147`), or is otherwise compatible with all
  three register sets.
- Saves work while the cart is powered, and are lost at power-off. That is the
  expected volatile-SRAM behaviour; the patcher must provide persistence.
- A 512 KiB MBC5 game (Robbo) with the flash log at chip `0x72000` persisted
  across power cycles on this cart.

## What is not known yet (the next experiment)

**Can the CPU program/erase the flash while the mapper is in MBC1 or MBC3 mode?**

Why it matters: the log's data window is CPU `0x6000..0x7FFF` (chip `0x72000`,
bank `0x1C`). In MBC1 mode `0x6000..0x7FFF` is the mode-select register; in MBC3
mode it is the RTC latch. If the mapper consumes those writes, the flash never
sees the program/erase command sequence.

## Immediate next step

1. Flash these three ROMs (they are already built):
   - `roms/mapperprobe-mbc1.gb`
   - `roms/mapperprobe-mbc3.gb`
   - `roms/mapperprobe-mbc5.gb` (control; should behave like the original probe)
2. On each, press **A** (program `0x5A` at chip `0x72000`) and **B** (erase the
   sector). Press **START** to refresh the summary.
3. Report the screen lines, e.g.:

```
HDR 147=03 148=04 149=03
MODE: MBC1
SRAM4: OK
ID A9: 20 00 7D 00
SECTOR: FF
PROG err=00 rd=5A
ERASE err=00 rd=FF
```

Also report whether the **MBC3 game you tested uses a clock/RTC** (which game,
and whether the in-game time survived a power cycle). That decides whether the
journal must also persist RTC registers.

## Decision tree after the probe

### Case 1: `PROG err=00 rd=5A` and `ERASE err=00 rd=FF` in MBC1 and MBC3

The mapper forwards writes to the flash even when the address is also a register.
We can keep the game's original header and add:

- a mapper-aware bank-select helper for the log bank,
- save/restore of the MBC1 mode register around each flash byte,
- the boot trampoline + SRAM journal.

This is the easiest path and the one to implement first.

### Case 2: flash works in MBC3 but not MBC1

MBC3 games can use the normal path. For MBC1, look for a **mapper-mode switch**
(next probe): try writing candidate values to `0x6000`, `0x7000` and see whether
the bank mapping changes to MBC5 semantics. If a switch exists, toggle to MBC5
for flash operations and back. If not, either normalise MBC1 games to MBC5
(convert bank writes) or declare MBC1 saves unsupported.

### Case 3: flash fails in both MBC1 and MBC3

The mapper is strictly header-switched and consumes all register writes. Then:

- keep the original header for gameplay, but find a mode switch (probe), or
- patch the header to MBC5 and convert the game's bank writes (expensive), or
- support only MBC5 games in v1.

## What is already implemented in this repo

- `probe/mapperprobe.c` - the mapper-aware probe (MBC1/MBC3/MBC5 header builds).
- `tools/build_probe.ps1` - builds all three 512 KiB probe ROMs.
- `patcher/hc007_patcher.py` - header parser and patch planner:
  - `info` prints mapper, ROM/RAM size, checksums, battery/RTC/rumble.
  - `plan` finds free 64 KiB sectors and proposes the log bank/window and the
    mapper-specific bank-select registers.
- `docs/FLASH_SAVE_METHOD.md` - the proven WRAM driver + append-only log method.
- `docs/PATCHER_DESIGN.md` - the intended patcher architecture.

## Rules / gotchas

- **Never** place the log in a sector that contains ROM code. The command address
  carries a `0x2000` window offset, so an erase can only hit chip `>= 0x2000`,
  but choose the sector deliberately.
- Data writes must stay at CPU `0x6000..0x7FFF` (MBC5 `0x4000..0x5FFF` is the
  RAM bank register). In MBC1 mode this range is also the mode register; in
  MBC3 mode it is the RTC latch. That is the open question above.
- Every flash routine must run from **WRAM**, and must restore `_current_bank`
  before returning. Switching to bank `0x1C` unmaps the calling bank.
- The 512 KiB image keeps bank `0x1C` inside the declared ROM and puts the log
  sector in `0xFF` padding, so a reflash resets the save deterministically.
- Emulators drop ROM writes; only the reader path can be tested in emulators.
  Hardware is required for program/erase.

## Handy commands

```powershell
# Rebuild the probes
pwsh -File tools/build_probe.ps1 -Clean

# Inspect any ROM
python patcher/hc007_patcher.py plan C:\path\to\game.gb

# Gearboy GUI
tools\gearboy\Gearboy.exe roms\mapperprobe-mbc1.gb

# Gearboy headless MCP example (media info, frames, WRAM, screenshot)
node tools/gearboy_mcp_example.mjs roms\mapperprobe-mbc1.gb
```
