# Current status (2026-11-10)

## TL;DR

- The **test ROM** (source-level flash journal) passed on the real cart for
  MBC1, MBC3 and MBC5: A saves, power-cycle restores, START clears.
- The **binary patcher prototype** works in Gearboy/serverboy and its reader
  tests pass.
- The **patched plain ROMs white-screened on hardware** (both GBC and DMG).
- A likely cause was found: `j_boot` ran before the GBDK crt0 and used the boot
  ROM's 127-byte **HRAM stack** (`SP=0xFFFE`); the C restore code could
  overwrite HRAM runtime variables.  The plain ROM's expected stack is
  `0xE000`.
- **Candidate fix applied:** the blob's `j_boot` now does `ld sp, #0xE000`
  before calling `j_restore`.  The blob and all three patched plain ROMs were
  rebuilt; the reader tests still pass.  **Hardware retest is pending.**

## Last known-good

- `roms/testrom-mbc5.gb` / `-mbc1.gb` / `-mbc3.gb`: hardware pass.
- `tests/testrom_reader.mjs`: pass.
- `tests/patched_plain_reader.mjs`: pass (boot restore + SRAM path).
- Patched plain ROMs boot in Gearboy/serverboy.

## Current failure

`roms/plain-mbc5-patched.gb`, `plain-mbc1-patched.gb`, `plain-mbc3-patched.gb`
boot to a **white screen** on the real cart, on both GBC and DMG.  Emulators
boot them.

Verified not the cause:

- header checksum: `0x14D = 0x8F`, computed `0x8F` (plain and patched);
- Nintendo logo bytes intact;
- patched vectors: `0x100 = C3 66 25 00` (`jp j_boot`),
  `0x40 = C3 7E 25` (`jp j_vblank`), original VBlank stub copied;
- boot target `0x0157` patched into `j_boot_default`;
- static scan found no real call/jump from the blob into uncopied bank-0 code
  (the earlier `C2 28 03` hit was a false positive: it is `SUB 0xC2; JR Z`).

## Candidate fix (applied, unverified)

`patcher/journal/journal.c`, `j_boot`:

```asm
j_boot:
        ld sp, #0xE000      ; WRAM stack (the boot ROM's SP is 0xFFFE/HRAM)
        push af
        ...
```

Why: `j_boot` runs from the reset vector, before the GBDK crt0 sets
`SP=0xE000`.  The C `j_restore` uses the stack; a 127-byte HRAM stack can
overwrite GBDK HRAM variables (`_current_bank`, `_vbl_done`, ...), which is a
plausible hardware-only white screen.

## Next hardware test

Reflash the rebuilt ROMs and retest:

1. `roms/plain-mbc5-patched.gb`
2. `roms/plain-mbc1-patched.gb`
3. `roms/plain-mbc3-patched.gb`

Press A, wait ~3 s, power-cycle, check the counter.

## If it still white-screens

Isolate in this order:

1. **Trampoline-only blob**: `j_boot` only sets SP and jumps to the original
   entry; no restore, no hook.  If it boots, the trampoline is fine.
2. **Add the boot restore** without the VBlank hook (`0x40` left as the
   original vector or patched to `reti`).
3. **Add the flash ID read** only; then the log scan; then the shadow init.
4. **Add the VBlank hook** last.
5. Try a **blank log sector**: reflash the patched image (the image's
   `0x60000..0x6FFFF` is `0xFF`), or write a diagnostic ROM that erases the
   sector first.  A full/foreign log triggers the boot-time erase, which can
   look like a long white screen.
6. Check the **WRAM collision**: blob vars `0xDE00..0xDE96`, stack `0xE000`
   growing down; move the vars lower (e.g. `0xDD00`) if the game's stack depth
   is large.
7. Check the **VBlank vector timing**: the hook can run before the game installs
   its VBlank handler; a minimal hook that only increments a counter and
   tail-calls the original stub should be safe, but verify.
8. Try **MBC5 only** first; MBC1/MBC3 add mapper-state complexity.

## Remaining known limitations

- The hook restores ROM bank 0 after flash writes; banked games need a bank
  shadow.
- The hook writes `0x4000 = 0` for SRAM access; MBC1 high-bank games need the
  saved value.
- Only SRAM bank 0 (8 KiB) is verified on this cart.
- A full log stops journaling until the next boot erase.
- The 4-bytes-per-VBlank writer adds flash time to the VBlank.

## Key files

- `patcher/journal/journal.c` - injectable blob (boot restore + VBlank writer).
- `patcher/journal/build_blob.ps1` - builds `roms/journal-blob.gb`.
- `patcher/hc007_patcher.py` - `info`, `plan`, `patch`.
- `testrom/plain.c` - plain patcher target (SRAM save only).
- `tools/build_plain.ps1` - builds `roms/plain-*.gb`.
- `tests/patched_plain_reader.mjs` - reader regression.
- `docs/START_HERE.md` - broader handoff.
- `docs/PATCHER_DESIGN.md` - architecture.
- `patcher/journal/README.md` - blob/WRAM/log details.
