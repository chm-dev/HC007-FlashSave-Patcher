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

## SRAM and WRAM usage

- Hot SRAM pages:
- SRAM stack (`SP` at boot):
- Hot WRAM pages:
- Level-load writes (SRAM/WRAM):
- Work-RAM verdict:
- Trace files: `analysis/trace-menu.json`, `analysis/trace-play.json`,
  `analysis/trace-wram.json`

Do not assume a page is free because the menu is quiet.  Trace a real level
load and the save event.

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
- Delete hook:
- Code placement (appended bank / WRAM helper):
- Game RAM borrowed and backup location:
- Bank restore point (must be bank 0):
- Log sector:
- Record format:
- No-flash debug variant:

## Test log

| Test | Result | Notes |
|---|---|---|
| Boot (emulator) | | |
| Fresh save | | |
| Save, reset, load | | |
| Save after a real level load | | |
| Natural save event with NOR-flash model | | |
| Delete | | |
| Boot (hardware) | | |
| Power-cycle load | | |
| Power-cycle delete | | |
| Reflash reset | | |

## Distribution

- IPS: `ips/<slug>-hc007.ips`
- Minimal IPS: `ips/<slug>-hc007-min.ips`
- Applied IPS SHA-1 matches the built image: yes/no
- Manifest: `ips/manifest.json`

## Open questions / risks

1.
