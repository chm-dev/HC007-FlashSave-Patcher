# Compatibility matrix

Fill this in as ROMs are tested. Keep it as the patcher's source of truth for
per-game overrides.

## Columns

| Column | Meaning |
|---|---|
| Title | ROM title from the header |
| SHA-1 | First 8 hex chars are enough while testing |
| Mapper | MBC1 / MBC3 / MBC5 |
| ROM | Declared ROM size |
| SRAM | Declared SRAM size |
| RTC | yes/no |
| Hook | `vblank`, `save-routine`, `none` |
| Boot | Boots to gameplay |
| Save | In-game save works |
| Load | Save loads after reset |
| Power | Save survives power-off |
| Delete | Delete survives power-off |
| Visual/timing | Notes |
| Status | `works`, `quirk`, `fails`, `unsupported` |

## Rows (examples / to be filled)

| Title | SHA-1 | Mapper | ROM | SRAM | RTC | Hook | Boot | Save | Load | Power | Delete | Notes | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mapperprobe-mbc1 | - | MBC1 | 512K | 32K | no | - | - | - | - | - | - | probe only | test |
| mapperprobe-mbc3 | - | MBC3 | 512K | 32K | no | - | - | - | - | - | - | probe only | test |
| mapperprobe-mbc5 | - | MBC5 | 512K | 32K | no | - | - | - | - | - | - | probe only | test |
| Robbo DMG port | - | MBC5 | 512K | 32K | no | - | yes | yes | yes | yes | - | reference implementation | works |

## Per-game overrides

For games that fail the generic VBlank hook, record the reason and the
alternative:

```
Title:
SHA-1:
Problem:        e.g. raster effects break with the VBlank hook
Hook:           save-routine at 0x....
Notes:
```

## Hardware limits reminder

- SRAM > 32 KiB: unsupported.
- ROM 8 MiB: no spare sector, unsupported.
- RTC: not in v1.
- MBC2/HuC/MBC6/MBC7/MMM01: unsupported.
