# Patcher

`hc007_patcher.py` parses ROM headers, plans patches, and **patches a target
ROM** with the journal blob.

## Commands

```powershell
python patcher/hc007_patcher.py info  path\to\game.gb
python patcher/hc007_patcher.py plan  path\to\game.gb
python patcher/hc007_patcher.py patch path\to\game.gb
```

`patch` defaults to `roms/journal-blob.gb` / `.noi` and writes
`<name>-patched.gb`.  Build the blob first:

```powershell
pwsh -File patcher/journal/build_blob.ps1 -Clean
```

### `info`

Prints title, file size, declared ROM/RAM size, mapper family, CGB flag,
battery/RTC/rumble, stored vs computed checksums, free 64 KiB sectors and
compatibility warnings.

### `plan`

Adds the proposed log sector, bank/window, mapper-specific bank-select
registers and the remaining stages.

### `patch` (prototype)

Current prototype requirements:

- MBC1/MBC3/MBC5 mapper, 8 KiB SRAM (bank 0), 512 KiB image.
- Target `0x100` is a `jr`/`jp` entry; `0x40` is the original 8-byte VBlank
  vector (the blob executes a copy of it).
- Target `0x2000..0x3FFF` is free (`0xFF`).
- Log sector `0x60000..0x6FFFF` is blank.

It:

1. copies the blob's `0x2000..0x3FFF` into the target,
2. patches `0x100` to `jp j_boot` and `0x40` to `jp j_vblank`,
3. patches the blob's boot target to the game's original entry,
4. copies the original VBlank vector into the blob's stub,
5. fixes the header and global checksums.

Output for `roms/plain-mbc5.gb`:

```
patched: roms/plain-mbc5.gb -> roms/plain-mbc5-patched.gb
  mapper:         MBC5
  entry:          0x0157 (boot trampoline 0x2566)
  vblank:         original f5 e5 21 a5 c0 c3 80 00 -> stub 0x20C1 (hook 0x257B)
  blob:           0x2000..0x3FFF
  log sector:     0x060000 (bank 0x18)
  header checksum: 0x8F
```

## Hardware status

The first patched plain ROMs **white-screened on the real cart** (GBC and DMG)
even though they boot in Gearboy/serverboy.  A likely cause was `j_boot` running
before the GBDK crt0 and using the boot ROM's 127-byte HRAM stack; it now sets
`SP=0xE000` before calling `j_restore`.  The blob and patched ROMs were rebuilt;
**hardware retest pending**.  See `../docs/STATUS.md` for verified non-causes
and the isolation plan.

## Current limitations

- Only the controlled plain ROM layout is supported: 512 KiB, 8 KiB SRAM,
  free `0x2000..0x3FFF`, blank `0x60000` sector.
- The hook restores ROM bank 0 after flash writes; banked games need a bank
  shadow.
- RTC, >8 KiB usable SRAM (bank 0 only), 8 MiB ROMs and MBC2/HuC mappers are
  unsupported.
- Free-sector detection only looks inside the existing image; padding a smaller
  ROM to 512 KiB is not automated yet.
- A full log stops journaling until the next boot erase.

## Implementation order

Done for the prototype:

- [x] boot trampoline at `0x100`
- [x] mapper-aware WRAM flash driver
- [x] SRAM page journal (replay + append)
- [x] VBlank save-detection hook
- [x] header/global checksum fix

Next:

1. Support arbitrary 512 KiB targets (find free `0x2000..0x3FFF`, blank log
   sector).
2. Pad smaller ROMs to 512 KiB and update `0x148`/checksums.
3. Track the game's current ROM bank (or keep the hook in bank 0 without
   switching).
4. Add a compatibility database and per-game overrides.

See `../docs/PATCHER_DESIGN.md` and `journal/README.md`.
