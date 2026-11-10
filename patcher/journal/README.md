# Journal blob

The injectable save layer.  Built as a tiny GBDK image with its code linked at
**0x2000** in bank 0; the patcher copies `0x2000..0x3FFF` into a target ROM.

## Hardware status

The first hardware run of the patched plain ROMs produced a **white screen** on
both GBC and DMG (emulators boot).  The likely cause was `j_boot` running before
the GBDK crt0 and using the boot ROM's 127-byte HRAM stack (`SP=0xFFFE`); the C
restore code could overwrite HRAM runtime variables.  `j_boot` now sets
`SP=0xE000` (the plain ROM's `.STACK`) before calling `j_restore`.  Blob and
patched ROMs were rebuilt; **hardware retest pending**.  See
`../../docs/STATUS.md` for the verified non-causes and isolation plan.

## Build

```powershell
pwsh -File patcher/journal/build_blob.ps1 -Clean
```

Outputs `roms/journal-blob.gb`, `.noi`, `.map`.  The blob's code currently uses
about 1.7 KB of the 8 KB window.

## What the patcher patches

| Target | Change |
|---|---|
| `0x100` | `jp j_boot` (boot trampoline) |
| `0x40` | `jp j_vblank` (VBlank hook) |
| `j_boot_default` | original entry target parsed from the target's `0x100` code |
| `j_vblank_stub` | original 8-byte VBlank vector copied from the target |

The blob's `j_vblank` tail-jumps to the copied original vector, so the game's
VBlank dispatch is preserved exactly.

## Boot restore

1. Set `SP=0xE000` (WRAM stack; the boot ROM's SP is `0xFFFE` in HRAM).
2. Read `0x147` to select the mapper mode.
3. Read the flash ID (autoselect `0x90`); if it is not plausible, set
   `j_flash_present = 0` and skip all writer work (emulators).
4. Select bank `0x18` (chip `0x62000`), enable SRAM bank 0, scan the log.
5. For each valid page record, copy its 256 bytes into the SRAM page.
6. Erase the sector if the log is full.
7. Restore the mapper and initialize the page checksum shadow.
8. Jump to the game's original entry target.

## VBlank writer

- One SRAM page (256 bytes) is checksummed per frame; changes set a dirty bit.
- After 60 stable frames (~1 s), changed pages are appended to the log.
- A page record is written **4 bytes per VBlank** (261 bytes -> ~66 frames).
- Flash writes run from a WRAM stub with the log bank selected; bank 0 is
  restored before returning to the game.
- The program stub uses the HC007's `0xA9/0x56` unlock and DQ7 polling.

## Log format

Bank `0x18`, CPU `0x6000..0x7FFF`, chip `0x62000..0x63FFF`:

```
record (261 bytes):
  0 'J'  1 'P'  2 page  3..258 data  259 checksum  260 0x5A
checksum = page ^ 0xA5 + sum(data)   (mod 256)
```

Append-only; the boot scan applies records in order, so the last record for a
page wins.  A full log is erased once at boot (the sector is padding in the
patched image).

## Fixed WRAM layout

| Address | Use |
|---|---|
| `0xDE00..0xDE5F` | flash stub code buffer (`j_code`) |
| `0xDE60` | mapper mode |
| `0xDE61..0xDE62` | frame counter |
| `0xDE63` | scan page |
| `0xDE64` | stable-frame counter |
| `0xDE65..0xDE68` | dirty-page bitmap (32 bits) |
| `0xDE69` | write page |
| `0xDE6A..0xDE6B` | write index |
| `0xDE6C` | write active |
| `0xDE6D` | page checksum |
| `0xDE6E..0xDE6F` | append offset |
| `0xDE70..0xDE8F` | page checksum shadow (32 bytes) |
| `0xDE90..0xDE93` | flash program parameters |
| `0xDE94..0xDE96` | flash ID / presence |

The stack is at `0xDFFE`, below this area.

## Prototype limitations

- **Hardware status:** first patched plain ROMs white-screened (GBC/DMG); the
  `SP=0xE000` candidate fix is rebuilt and awaiting a hardware retest.
- The hook restores **ROM bank 0** after flash writes.  Target games must keep
  bank 0 selected at VBlank (the plain test ROM does).  Banked games need a
  bank shadow or a per-game patch.
- The hook writes `0x4000 = 0` for SRAM access.  In MBC1 mode this also clears
  the high ROM-bank bits; banked MBC1 games need the saved value.
- Only SRAM **bank 0 (8 KiB)** is journaled; banked SRAM is unverified on this
  cart.
- A full log stops journaling until the next boot erase; no in-game erase.
- The 4-bytes-per-VBlank writer adds flash-program time to the game's VBlank.
  Timing-sensitive games may need a slower rate.
- The hook leaves SRAM enabled after reads (safe when interrupting a game
  mid-write), but games that rely on SRAM being disabled could notice.
