# Compatibility matrix

Source of truth for HC007 per-game status.  Update it after every hardware test.

## Columns

| Column | Meaning |
|---|---|
| Title | ROM title from the header |
| SHA-1 | First 8 hex chars are enough while testing |
| Mapper | MBC1 / MBC3 / MBC5 |
| ROM | Declared ROM size |
| SRAM | Declared SRAM size |
| Strategy | `S1` save hook, `S2` page journal, `S3` replacement, `-` unsupported |
| Boot | Boots to gameplay |
| Save | In-game save works |
| Load | Save loads after reset |
| Power | Save survives power-off |
| Delete | Delete survives power-off |
| Notes | Quirks, evidence links |
| Status | `works`, `quirk`, `hardware-smoke`, `emulator-ready`, `fails`, `unsupported`, `investigating` |

## Rows

| Title | SHA-1 | Mapper | ROM | SRAM | Strategy | Boot | Save | Load | Power | Delete | Notes | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Robbo DMG port | - | MBC5 | 512K | 32K declared | source-level | yes | yes | yes | yes | - | reference flash journal; bank 0 only | works |
| testrom-mbc5 | - | MBC5 | 512K | 8K | source-level | yes | yes | yes | yes | yes | controlled test ROM | works |
| testrom-mbc1 | - | MBC1 | 512K | 8K | source-level | yes | yes | yes | yes | yes | controlled test ROM | works |
| testrom-mbc3 | - | MBC3 | 512K | 8K | source-level | yes | yes | yes | yes | yes | controlled test ROM | works |
| plain-mbc5-patched | - | MBC5 | 512K | 8K | S2 | yes | yes | yes | yes | - | legacy prototype; VBlank journal | works |
| plain-mbc1-patched | - | MBC1 | 512K | 8K | S2 | - | - | - | - | - | legacy prototype; retest | unknown |
| plain-mbc3-patched | - | MBC3 | 512K | 8K | S2 | - | - | - | - | - | legacy prototype; retest | unknown |
| Super Mario Land 2 | bba40853 | MBC1 -> MBC5 | 512K -> 1M | 8K | S1 | yes | yes | yes | yes | yes | SRAM/WRAM are work RAM; ROM-bank journal + on-demand WRAM helper; IPS in games/sml2/ips/; see games/sml2/README.md; hardware-pass (boot, one life-loss save, power-cycle, delete; multi-level play and first full-log erase not yet verified) | works |
| Donkey Kong (GB 1994) | 6ed661bd | MBC1 -> MBC5 | 512K -> 1M | 8K | S1 | yes | yes | yes | yes | no | writer-tail hooks + 0x366-byte SRAM payload journal in bank-0 cave; boot restore at 0x100; IPS in games/dk/ips/; emulator-pass; hardware: no-flash build passes (4 graded rounds), flash path confirmed on a second, known-good cart (first test cart was faulty); never put SP in cart SRAM | hardware-pass |
| mapperprobe-mbc1/3/5 | - | MBC1/3/5 | 512K | 32K | - | - | - | - | - | - | probe only | test |

## Case folders

| Game | Folder | Current status |
|---|---|---|
| Donkey Kong | `games/dk/` | hardware-pass (build 6, saves retained) (`games/dk/README.md`) |
| Super Mario Land 2 | `games/sml2/` | hardware-pass (limited scope; see `games/sml2/notes.md` "Known deviations") |

To add a game, copy `games/_template/` to `games/<slug>/`, fill `case.json`,
and add a row above.  Link the case `README.md` and its IPS manifest.  Update
the row after every hardware test.

## Per-game overrides

For games that need a non-standard hook, record the reason and the alternative:

```
Title:
SHA-1:
Problem:        e.g. raster effects break with the VBlank hook
Strategy:       S1 save-routine hook at 0x....
Restore point:  entry / validator at 0x....
Notes:
```

## Hardware limits reminder

- Flash program/erase: verified in MBC1, MBC3 and MBC5 modes.
- SRAM: only **bank 0 (8 KiB)** is verified; 32 KiB games that use banks 1-3
  are unsupported until banked SRAM is proven.
- ROM 8 MiB: no spare sector, unsupported.
- RTC: not in v1.
- MBC2/HuC/MBC6/MBC7/MMM01: unsupported.
