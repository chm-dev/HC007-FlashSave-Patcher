# Start here (new session handoff)

> **Current hardware failure:** the binary-patched plain ROMs white-screen on
> the cart (GBC and DMG).  A candidate stack fix is rebuilt and awaiting a
> retest.  Staged diagnostic ROMs for the isolation plan are now built:
> `roms/plain-mbc5-stage0.gb` (trampoline only), `-stage1.gb` (+ boot
> restore), and the full `-patched.gb` (stage 2).  Flash and test in that
> order.  Read `docs/STATUS.md` first for the exact symptom list, verified
> non-causes and isolation plan.

## What this project is

A binary patcher that adds batteryless saves to GB/GBC ROMs on the **HC007-BGA-V2**
cart (M29W640 8 MiB NOR flash, 32 KiB SRAM, no battery). The proven flash method
comes from the Robbo DMG port; this project generalises it.

## What is already known (verified on the real cart)

- Flash unlock bytes: **`0xA9/0x56`** (D0/D1 swapped). Plain `0xAA/0x55` fails.
- Flash ID: `20 00 7D 00` (ST/Numonyx M29W640).
- Program and erase from the GB CPU work (probe: `PROG err=00 rd=5A`,
  `ERASE err=00 rd=FF`).
- **Flash works in MBC1, MBC3 and MBC5 header modes.** The mapper forwards
  writes even when CPU `0x6000` is also a mapper register, so a patched game can
  keep its original header.
- **SRAM:** the probe's 4-bank test fails in all three modes, so only **bank 0
  (8 KiB)** is verified. Treat 32 KiB games as unsupported until a dedicated
  SRAM test proves banked SRAM.
- MBC1, MBC3 and MBC5 games boot and play on the cart. This means the mapper
  switches mode from the header (`0x147`), or is otherwise compatible with all
  three register sets.
- Saves work while the cart is powered, and are lost at power-off. That is the
  expected volatile-SRAM behaviour; the patcher must provide persistence.
- A 512 KiB MBC5 game (Robbo) with the flash log at chip `0x72000` persisted
  across power cycles on this cart.

## Next implementation step

The test ROM passed on hardware for all three mapper modes. The **patched plain
ROMs white-screened on hardware** (GBC and DMG) even though they boot in
emulators. A likely cause was the boot trampoline using the boot ROM's HRAM
stack; `j_boot` now switches to `SP=0xE000`. The blob and patched ROMs are
rebuilt. **Reflash and retest** `roms/plain-mbc5-patched.gb` (then MBC1/MBC3):
press A, wait ~3 s, power-cycle, check the counter.

If they still white-screen, read `docs/STATUS.md` for the verified non-causes
and the isolation plan (trampoline-only blob, restore-only, hook-only, blank log
sector, WRAM collision, MBC5 first).

The prototype already has:

1. A boot trampoline at `0x100` that restores SRAM from the journal and jumps to
   the game's original entry.
2. A mapper-aware WRAM flash driver (MBC1/MBC3/MBC5 bank select).
3. An 8 KiB SRAM page journal (32 pages of 256 bytes), append-only with a commit
   byte written last.
4. A VBlank save-detection hook (one page checksummed per frame, 4 bytes written
   per frame after a stable period).
5. Header/global checksum fixes and the original VBlank-vector tail call.

Remaining before arbitrary commercial games:

1. Fix the hardware white screen.
2. Generalize the patcher beyond the plain-ROM layout (find free bank-0 space,
   blank log sector, pad smaller images).
3. Track the game's current ROM bank (or avoid switching banks in the hook).
4. Save/restore the MBC1 mode register, MBC3 RTC latch and `0x4000` register.
5. Compatibility database and per-game overrides.

## Still open

- **Why do the patched plain ROMs white-screen on hardware?** Candidate fix:
  WRAM stack in `j_boot` (applied, unverified).  See `docs/STATUS.md`.
- Which MBC3 test game was used, and does it use an RTC/clock? RTC persistence is
  not implemented in v1.
- Is the cart's SRAM really 8 KiB, or is 32 KiB present but not banked? A
  dedicated SRAM-size test (or the chip marking) would settle it.
- How much VBlank overhead can representative games tolerate?
- Does the mapper mask ROM banks to the header ROM size (affects appended banks)?
- How to track the current ROM bank for banked games without per-game patches.

## What is already implemented in this repo

- `probe/mapperprobe.c` - the mapper-aware probe (MBC1/MBC3/MBC5 header builds).
- `tools/build_probe.ps1` - builds all three 512 KiB probe ROMs.
- `testrom/` - controlled save test ROM (16-bit counter, SRAM copy, flash
  journal) built for MBC1/MBC3/MBC5; `tools/build_testrom.ps1` builds it.
- `tests/testrom_reader.mjs` - reader regression for the test ROM (blank,
  last-wins, tombstone, torn, corrupt checksum).
- `testrom/plain.c` - plain save ROM (patcher target), built by
  `tools/build_plain.ps1`.
- `patcher/journal/` - injectable journal blob (boot restore + VBlank writer),
  built by `patcher/journal/build_blob.ps1`.
- `patcher/hc007_patcher.py` - header parser, planner and `patch` command:
  - `info` prints mapper, ROM/RAM size, checksums, battery/RTC/rumble.
  - `plan` finds free 64 KiB sectors and proposes the log bank/window and the
    mapper-specific bank-select registers.
  - `patch` injects the blob, patches the entry/VBlank vectors and fixes the
    checksums.
- `tests/patched_plain_reader.mjs` - reader regression for the patched plain
  ROM.
- `docs/STATUS.md` - current hardware failure, verified non-causes and retest
  plan.
- `docs/FLASH_SAVE_METHOD.md` - the proven WRAM driver + append-only log method.
- `docs/PATCHER_DESIGN.md` - the intended patcher architecture.

## Rules / gotchas

- **Never** place the log in a sector that contains ROM code. The command address
  carries a `0x2000` window offset, so an erase can only hit chip `>= 0x2000`,
  but choose the sector deliberately.
- Data writes must stay at CPU `0x6000..0x7FFF` (MBC5 `0x4000..0x5FFF` is the
  RAM bank register). In MBC1 mode this range is also the mode register; in
  MBC3 mode it is the RTC latch. Flash writes are proven to work in every mode,
  but save and restore those registers around each operation.
- The journal must use SRAM bank 0 (8 KiB); banked SRAM is unverified on this
  cart.
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

# Rebuild the test ROMs
pwsh -File tools/build_testrom.ps1 -Clean

# Build the plain patcher target
pwsh -File tools/build_plain.ps1 -Clean

# Build the injectable journal blob
pwsh -File patcher/journal/build_blob.ps1 -Clean

# Build a staged diagnostic blob (0 = trampoline only, 1 = + boot restore)
pwsh -File patcher/journal/build_blob.ps1 -Stage 0 -Clean
pwsh -File patcher/journal/build_blob.ps1 -Stage 1 -Clean

# Patch the plain ROM
python patcher/hc007_patcher.py patch roms/plain-mbc5.gb

# Patch with a staged blob, no VBlank hook (isolation testing)
python patcher/hc007_patcher.py patch roms/plain-mbc5.gb `
  --blob roms/journal-blob-stage0.gb --blob-noi roms/journal-blob-stage0.noi `
  --no-vblank-hook -o roms/plain-mbc5-stage0.gb

# Reader regressions
node tests/testrom_reader.mjs
node tests/patched_plain_reader.mjs

# Inspect any ROM
python patcher/hc007_patcher.py plan C:\path\to\game.gb

# Gearboy GUI
tools\gearboy\Gearboy.exe roms\mapperprobe-mbc1.gb

# Gearboy headless MCP example (media info, frames, WRAM, screenshot)
node tools/gearboy_mcp_example.mjs roms\mapperprobe-mbc1.gb
```
