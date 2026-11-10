# Current status (2026-11-11)

## TL;DR

- **Patched plain ROM now persists saves on the real cart** (MBC5): press A,
  wait ~5 s (watch `AP` grow in the on-screen debug), power-cycle, the counter
  is restored.  `roms/plain-mbc5-patched.gb`.
- MBC1 / MBC3 patched plain ROMs were not retested on hardware yet.
- Reader tests pass: `tests/testrom_reader.mjs`, `tests/patched_plain_reader.mjs`.

## What the white screen was (resolved)

Bisected on hardware with staged blobs (`JOURNAL_STAGE`, see
`patcher/journal/README.md`):

| Stage | Result |
|---|---|
| 0 trampoline only, 1 + boot restore, 2 empty VBlank hook | boot |
| 3 mapper writes in VBlank, 7 + one SRAM byte read | boot |
| 4 full 256-byte page checksum in VBlank | **freeze** |

Cause: the VBlank handler ran too long.  The whole-page checksum (and the
whole-page checksum in `j_start_write`) froze the game.  Fixes:

1. The scan checksums **32 bytes per frame** (page every 8 frames, full pass
   ~4.3 s).  64 bytes per frame also froze.
2. The record checksum is accumulated while writing, not precomputed.
3. The change-detection hash is `h = rol(h) + byte`, in hand-written asm
   (`j_chunk_run`).  The C version of the rotating hash froze again: the
   VBlank time budget is tight (between ~32 and 64 plain bytes).
4. A plain additive page sum **missed changes that cancel out** (counter
   low byte +1, check byte -1), so every other A press was not saved.

Save latency is ~5 s from the press (scan detection up to one pass, stable
wait of 8 page scans, ~1 s to write the record).  Debug readout (`ID FP AP
ER ST WA FR DR`) is drawn by `testrom/plain.c`; `AP` growing means the record
is committed (`WA` is only visible ~1 s).

## Remaining known limitations

- The change-detection hash is 8 bits (~1/256 missed change; recovered at the
  next change of that page).
- The hook restores ROM bank 0 after flash writes; banked games need a bank
  shadow.
- The hook writes `0x4000 = 0` for SRAM access; MBC1 high-bank games need the
  saved value.  Also leaves SRAM enabled after reads.
- Only SRAM bank 0 (8 KiB) is verified on this cart.
- A full log stops journaling until the next boot erase.
- Interrupt-time budget is tight: any new VBlank work must stay small.

## Next steps

1. Hardware retest of MBC1 and MBC3 patched plain ROMs.
2. Patch a real commercial game (bank tracking, RTC, mapper registers).
3. Generalise the patcher: free bank-0 space for the blob, padding, per-game
   overrides.
4. Optional: 16-bit hash, faster response for recently dirty pages.
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
