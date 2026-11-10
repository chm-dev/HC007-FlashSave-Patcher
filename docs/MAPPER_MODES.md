# Mapper modes and the flash-write conflict

## Why this matters

The save log lives in flash at chip `0x72000`, reached through **bank `0x1C`,
CPU `0x6000..0x7FFF`**. The flash program and erase commands are written to the
same CPU window (the data byte / the `0x30` erase command). That window is also
a mapper register in MBC1 and MBC3 mode:

| CPU range | MBC1 | MBC3 | MBC5 |
|---|---|---|---|
| `0x0000-0x1FFF` | RAM enable | RAM/timer enable | RAM enable |
| `0x2000-0x3FFF` | ROM bank low 5 | ROM bank 7-bit | ROM bank low 8 |
| `0x4000-0x5FFF` | RAM bank / high ROM | RAM bank / RTC select | RAM bank |
| `0x6000-0x7FFF` | mode select | RTC latch | ROM (flash) |

If the mapper consumes writes in `0x6000..0x7FFF`, the flash never sees the
program/erase sequence, and a game running in MBC1/MBC3 mode cannot use the log
without a mode switch or a header conversion.

The user has already confirmed that MBC1, MBC3 and MBC5 games all boot and play.
So the mapper is **not fixed MBC5**; it follows the header (or is a compatible
superset). The remaining question is only about flash writes.

## Bank selection per mode

Bank `0x1C` (28) is reachable in all three modes:

| Mode | Registers to select bank `0x1C` |
|---|---|
| MBC1 | `0x4000 = 0` (high 2 bits, mode 0), `0x2000 = 0x1C` (low 5) |
| MBC3 | `0x2000 = 0x1C` (7-bit bank) |
| MBC5 | `0x3000 = 0`, `0x2000 = 0x1C` |

The probe's `select_test_bank()` / `restore_bank0()` helpers implement this.
The important MBC1 detail: the SRAM test writes RAM banks through `0x4000`,
which also sets the high ROM bank bits; clear them before selecting the log
bank, or you will address a different chip sector.

## The probe

`probe/mapperprobe.c` is the original verified flash probe plus:

- a mapper-mode read from `0x147`,
- mode-aware bank selection,
- an `HDR 147` / `MODE:` line,
- a `restore_bank0()` after the SRAM test.

Build all three variants:

```powershell
pwsh -File tools/build_probe.ps1
```

Outputs:

- `roms/mapperprobe-mbc1.gb` (`0x147 = 0x03`)
- `roms/mapperprobe-mbc3.gb` (`0x147 = 0x13`)
- `roms/mapperprobe-mbc5.gb` (`0x147 = 0x1B`)

### On the cart

1. Flash one variant.
2. The probe runs the SRAM test and reads the flash ID automatically.
3. Press **A** to program `0x5A` at chip `0x72000`.
4. Press **B** to erase the sector.
5. Press **START** to refresh the summary.
6. Record the lines:

```
HDR 147=03 148=04 149=03
MODE: MBC1
SRAM4: OK
ID A9: 20 00 7D 00
SECTOR: FF
PROG err=00 rd=5A
ERASE err=00 rd=FF
```

Do this for MBC1, MBC3 and MBC5. The MBC5 run is the control.

## Interpreting the result

### A. Program and erase succeed in all modes

The mapper passes writes through. The patcher can keep the game's header.

Implementation notes:

- Save the MBC1 **mode register** value before a flash byte and restore it
  afterwards. The data write changes it (bit 0 = LSB of the data byte), so a
  program of `0x5B` would flip mode 1. With interrupts disabled, the game never
  observes the temporary mode.
- In MBC3 mode, `0x6000` is the RTC latch. Writing `0x30` or a data byte may
  disturb a pending latch; do the flash operation outside the game's RTC read
  sequence, and re-latch afterwards if needed.
- Keep `0x4000` in mind: it is RAM bank (MBC1/MBC3/MBC5) and high ROM bits
  (MBC1). Save/restore it around the flash operation.

### B. MBC3 succeeds, MBC1 fails

MBC1's mode register is the problem. Options:

1. **Find a mode switch.** Some multi-mapper bootleg chips expose a register
   that selects the mapper mode (candidates: `0x6000`, `0x7000`, writes of
   specific magic values). A second probe can try candidate writes and observe
   whether MBC5 bank semantics become active (write `0x3000` and see if bank
   bit 8 takes effect).
2. **Normalise MBC1 to MBC5.** Patch the header to `0x1B` and convert the
   game's bank writes. This is a per-game conversion; simple ≤512 KiB mode-0
   games are tractable, mode-1/high-bank games are not.
3. **v1 supports MBC3/MBC5 only.** Document MBC1 saves as unsupported.

### C. Both MBC1 and MBC3 fail

The mapper strictly consumes register writes. Same options as B, with more
pressure on finding a mode switch or normalising headers. If neither works, v1
is MBC5-only.

## Why MBC1 games "just work" on an MBC5-style cart

For small MBC1 games (≤512 KiB, mode 0, high bits 0), the register writes are
compatible with MBC5:

- `0x2000 = bank` (low 5 bits are the same as MBC5 low 8 for banks < 32),
- `0x4000 = RAM bank` (same as MBC5 RAM bank for 0-3),
- `0x6000` mode writes are ignored by MBC5 (or, on this cart, handled by the
  mapper's MBC1 mode).

This is why the user's MBC1 tests work. It does **not** prove that flash writes
work in MBC1 mode; the probe answers that.

## Follow-up probe (only if needed)

If flash fails in MBC1/MBC3, build a mode-switch probe that:

1. Writes candidate values (`0x00`, `0x01`, `0x03`, `0x13`, `0x1B`, `0x1C`,
   `0x1E`) to candidate addresses (`0x6000`, `0x7000`, `0x0000`, `0x4000`).
2. Tests MBC5 bank bit 8: write `0x3000 = 1`, `0x2000 = 0`, and see whether the
   bank at `0x4000` changes to bank `0x100` (if the flash is large enough) or
   whether a signature bank appears.
3. Tests MBC1 mode-1 mapping: write `0x6000 = 1`, high bits, and see whether
   `0x0000` changes.
4. Re-runs the flash program/erase after each candidate.

Record which candidate changes the mapping; that is the runtime mode switch.
