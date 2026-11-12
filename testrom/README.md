# HC007 save test ROM

A controlled ROM that proves the batteryless journal end-to-end without any
unknown game save logic.

> **Status:** this source-level test ROM passed on the real cart for MBC1/MBC3/
> MBC5.  The later binary-patched plain MBC5 ROM also passes after the VBlank
> timing fix.  See `../docs/STATUS.md` for the current status.

## What it does

- 16-bit counter, shown on screen.
- **A**: increment, write the SRAM copy, append a flash journal record.
- **B**: reload both values (shows what actually persisted).
- **START**: clear SRAM and append a flash tombstone.

Display:

```
HC007 SAVE TEST
MODE: MBC5
COUNTER: 0001
FLASH:   0000
SRAM:    0000
SAVE: --
A=SAVE B=RELOAD
START=CLEAR
```

- `FLASH` is the value read from the flash log.
- `SRAM` is the value in the volatile SRAM record.
- `SAVE: OK` means the flash append verified; `FAIL` means the flash ID was
  not plausible or the write did not verify; `--` means no write yet.

## Storage locations

| Storage | Address |
|---|---|
| SRAM record | `0xA100` (bank 0) |
| Flash log | chip `0x62000..0x63FFF` = bank `0x18`, CPU `0x6000..0x7FFF` |
| Flash sector | `0x60000..0x6FFFF` |

The test log is deliberately **separate** from the Robbo port's log at
`0x70000`, so both can coexist on the same cart.

Record (8 bytes):

```
'T' 'F' value_lo value_hi (lo^hi^0xA5) 0x5A 0x00 0x00
```

Append-only; last valid record wins; value 0 is a delete tombstone. Constants
are programmed before the magic pair, so a torn record never validates.

## Build

```powershell
pwsh -File tools/build_testrom.ps1
# or one family:
pwsh -File tools/build_testrom.ps1 -Cart mbc5
```

Outputs:

- `roms/testrom-mbc1.gb` (`0x147 = 0x03`)
- `roms/testrom-mbc3.gb` (`0x147 = 0x13`)
- `roms/testrom-mbc5.gb` (`0x147 = 0x1B`)

All are 512 KiB (`0x148 = 0x04`) with an 8 KiB SRAM header (`0x149 = 0x02`).
Bank `0x18` is inside the declared image and the log sector is `0xFF` padding.

## Emulator behaviour

Emulators have no flash model, so the flash ID reads `FF`; the test ROM detects
that and skips writes. `A` still updates the SRAM copy, so you will see
`SAVE: FAIL` and `SRAM` changing while `FLASH` stays at its previous value.
That is expected.

Reader-path regression:

```powershell
node tests/testrom_reader.mjs
```

It seeds records at file offset `0x62000` and checks the boot scan (blank,
last-wins, tombstone, torn, corrupt checksum).

## Hardware test

1. Flash `roms/testrom-mbc5.gb`.
2. Boot: `COUNTER: 0001`, `FLASH: 0000`, `SAVE: --`.
3. Press **A** a few times. Each press should increment `COUNTER`, update
   `SRAM`, set `SAVE: OK`, and update `FLASH` to the same value.
4. Power off, wait, power on. `COUNTER` and `FLASH` should show the last value;
   `SRAM` should be `0000` (volatile).
5. Press **START**. `COUNTER: 0001`, `FLASH: 0000`, `SAVE: OK`.
6. Power-cycle again; it should stay cleared.
7. Repeat with `testrom-mbc1.gb` and `testrom-mbc3.gb`.

Report for each family:

- does `SAVE` show `OK`?
- does `FLASH` track the counter?
- does the value survive a power cycle?
- does START clear it and does the clear survive?
- anything odd about the display or input.

If `SAVE: FAIL` appears on hardware, note the flash ID shown by the probe
(`ID A9: 20 00 7D 00` expected) and whether the cart was reflashed.
