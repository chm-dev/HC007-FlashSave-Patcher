# HC007-BGA-V2 hardware notes

## Board

- Bootleg "Pokemon Yellow"-style **HC007-BGA-V2** cartridge.
- **Flash:** ST/Numonyx **M29W640** (64 Mbit = **8 MiB**), NOR, 64 KiB sectors.
- **SRAM:** **32 KiB** (4 × 8 KiB banks), volatile.
- **Battery:** none.
- **Mapper:** MBC5-style chip that also runs MBC1 and MBC3 games (the mode
  follows the cartridge header, or is otherwise register-compatible).
- **Flash data pins D0/D1 are swapped** on this board.

## Probe results (real hardware)

The verified probe is `probe/flashprobe.c` (original) and
`probe/mapperprobe.c` (mapper-aware). The first hardware run reported:

```
ID A9: 20 00 7D 00     -> unlock bytes 0xA9/0x56 (D0/D1 swapped)
ID AA: FF FF FF FF     -> plain 0xAA/0x55 does not work
PROG err=00 rd=5A      -> programming works
ERASE err=00 rd=FF     -> erase works
VAR:A9/56
SECTOR: 5A
```

The game build (`robbo-hc007-debug.gb`, 512 KiB, MBC5) then persisted its level
across power cycles, confirming the end-to-end write path.

## Address mapping

```
chip address = bank * 0x4000 + (cpu_address - 0x4000)
```

- The MBC5 bank register is at CPU `0x2000` (low 8 bits) and `0x3000` (bit 8).
- CPU `0x4000..0x5FFF` is the **RAM bank register**, so flash data writes use
  CPU `0x6000..0x7FFF`.
- Log used by the Robbo port: chip `0x72000..0x73FFF` = bank `0x1C`, CPU
  `0x6000..0x7FFF`. The containing 64 KiB sector is `0x70000..0x7FFFF`.
- The command address carries a `0x2000` window offset, so an erase can only
  ever hit a sector at chip `>= 0x2000`; the first 8 KiB of the image are
  unreachable by erase. Do not rely on that by accident.

## Mapper modes (confirmed by user tests)

- MBC1 games boot and play.
- MBC3 games boot and play.
- MBC5 games boot and play (Robbo).
- Saves work while powered; power-off loses them (volatile SRAM).

This means the cart is **not** a fixed MBC5 mapper. It switches to the register
set implied by the header (`0x147`), or it implements a superset compatible with
all three.

## Register map by mode

| CPU range | MBC1 | MBC3 | MBC5 |
|---|---|---|---|
| `0x0000-0x1FFF` | RAM enable | RAM/timer enable | RAM enable |
| `0x2000-0x3FFF` | ROM bank low 5 bits | ROM bank (7 bits) | ROM bank low 8 bits |
| `0x4000-0x5FFF` | RAM bank / high ROM bits | RAM bank / RTC select | RAM bank |
| `0x6000-0x7FFF` | **mode select** | **RTC latch** | ROM (flash) |

The flash log's data window (`0x6000..0x7FFF`) overlaps an active mapper register
in MBC1 and MBC3. The mapper probe tests whether writes there still reach the
flash. See `docs/MAPPER_MODES.md`.

## Log sector layout

```
chip 0x70000  +--------------------------------+
              | 64 KiB flash sector             |
chip 0x72000  |  log window (8 KiB)             |  <- bank 0x1C, CPU 0x6000
chip 0x73FFF  +--------------------------------+
chip 0x74000  |  rest of the sector (padding)   |
chip 0x7FFFF  +--------------------------------+
```

The 512 KiB image ends at `0x7FFFF`, so the whole sector is `0xFF` padding in
the shipped image. A reflash therefore resets the save.

## Flash command sequence (verified)

- Reset: write `0xF0` to `0x4000`.
- Unlock: `0xA9` to `0x0AAA`, `0x56` to `0x0555` (D0/D1 swapped).
- Program: `0xA0` to `0x0AAA`, then the data byte to the target address; poll
  DQ7 until it matches, with a timeout.
- Erase: `0x80` to `0x0AAA`, `0xA9`/`0x56`, then `0x30` to the sector address;
  poll DQ7/`0xFF` with a timeout.
- Add a `nop` after each flash write (matches the hardware-proven patches).
- The flash is unreadable while busy: run every routine from WRAM with
  interrupts disabled.

## Open hardware questions

1. Do program/erase writes at `0x6000` reach the flash in **MBC1** mode?
2. Do they reach the flash in **MBC3** mode (where `0x6000` is the RTC latch)?
3. Is there a runtime **mapper-mode switch** register? If so, where and what
   values?
4. Does the board provide a real **RTC** for MBC3 games, or does the game read
   `0xFF`/defaults? Does the clock survive power-off?
5. Does the mapper mask the ROM bank register to the header ROM size? (The
   probe uses a 512 KiB image so bank `0x1C` is always declared.)
6. Are there protected/locked sectors? The probe can write/erase the log sector,
   so at least that one is unprotected.
7. **MBC1 SRAM banking:** Gearboy reports `SRAM4: FAIL` for the MBC1 probe and
   `OK` for MBC3/MBC5. That is either Gearboy's MBC1 32 KiB emulation or the
   cart exposing only 8 KiB in MBC1 mode. The hardware probe settles it; most
   MBC1 games use 8 KiB, so this only matters for 32 KiB MBC1 saves.

## Probe build notes

`tools/build_probe.ps1` builds the same source with three headers:

| Output | `0x147` | Mapper |
|---|---|---|
| `roms/mapperprobe-mbc1.gb` | `0x03` | MBC1+RAM+BATTERY |
| `roms/mapperprobe-mbc3.gb` | `0x13` | MBC3+RAM+BATTERY |
| `roms/mapperprobe-mbc5.gb` | `0x1B` | MBC5+RAM+BATTERY |

All are 512 KiB (`0x148 = 0x04`) with 32 KiB RAM (`0x149 = 0x03`), so bank
`0x1C` is inside the declared image and the log sector is `0xFF` padding.
