# <Game title>

## Identity

- ROM: `roms/<game>.gb`
- SHA-1: `<sha1>`
- Mapper: `<MBC1/MBC3/MBC5>`
- ROM: `<size>`
- SRAM declared: `<size>`
- RTC: `<yes/no>`

## Inventory

Paste the key `rom_inspect.py` observations: free runs, blank sectors, entry,
vectors, warnings.

## SRAM usage

- Hot pages:
- Stack in SRAM:
- Work-RAM verdict:
- Trace files:

## Save format

- Region:
- Slot stride/count:
- Meaningful size:
- Status byte:
- Checksum:
- Magic:
- Empty-slot bytes:
- Delete behaviour:

## Routines

| Role | Address | Bank | Evidence |
|---|---|---|---|
| Write | | | |
| Validate | | | |
| Load | | | |
| Delete | | | |
| Initialise | | | |

## Crafted-save proof

Describe the crafted SRAM image, the checksum, and what the menu displayed.
Link the screenshot.

## Patch plan

- Strategy:
- Boot restore point:
- Save hook:
- Code placement:
- Log sector:
- Record format:
- Bank safety notes:

## Test log

| Test | Result | Notes |
|---|---|---|
| Boot (emulator) | | |
| Fresh save | | |
| Save, reset, load | | |
| Delete | | |
| Boot (hardware) | | |
| Power-cycle load | | |
| Power-cycle delete | | |
| Reflash reset | | |

## Open questions

1.
