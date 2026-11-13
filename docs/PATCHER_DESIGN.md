# Patch architecture (per game)

This document replaces the old "one universal journal for every ROM" design.
The universal patcher was unrealistic because commercial games use SRAM in
incompatible ways.  The workbench now chooses a strategy per game, based on
evidence from `tools/sram_trace.mjs` and `tools/gbdis.py`.

## The three layers

Every HC007 patch has three layers:

```
[1] flash transport      proven once: WRAM stubs, 0xA9/0x56 unlock, DQ7 poll
[2] persistence policy   per game: what to save, when, and how to restore
[3] game hooks           per game: entry/validator/save-routine addresses
```

The transport is shared.  The policy and hooks are per game.

## Layer 1: flash transport

Use the proven primitives from `docs/FLASH_SAVE_METHOD.md`:

- read the flash ID with `0x90` autoselect;
- program one byte with `0xA0`, poll DQ7;
- erase a 64 KiB sector with `0x80` + unlock + `0x30`, poll `0xFF`;
- unlock bytes `0xA9/0x56` (D0/D1 swapped on the HC007);
- the flash primitive runs from WRAM with interrupts disabled; journal control
  code can run from an appended ROM bank, but every instruction that executes
  while the log bank is selected must be in WRAM or fixed bank 0;
- the data address is CPU `0x6000-0x7FFF`;
- save/restore the mapper bank and the RAM-bank/mode register around each
  operation.

The log sector is a blank 64 KiB sector inside the image, or a new sector after
padding.  The append-only record format is:

```
record:
  0  magic 0 ('H' or game-specific)
  1  magic 1
  2  record type / slot
  3  payload length
  4.. payload
  n  checksum
  n+1 commit byte (written last)
```

For small save regions, one record per save is enough.  The last valid record
wins at boot.

## Layer 2: persistence policy

### P1. Save-slot journal (preferred)

Hook the routine that writes the save slot.  Append the meaningful slot bytes to
the log.  At boot, replay the last record into SRAM before the game validates or
loads it.

- record size = save slot size (e.g. 0x4A or 0x50 bytes);
- no per-frame cost;
- works when SRAM is used as work RAM;
- deletion is represented by a tombstone record or by journaling the cleared
  slot.

### P2. Whole-SRAM page journal (fallback)

The old prototype.  Only when SRAM is quiet and the save region is a few pages.
It checksums one page per VBlank, marks changed pages dirty, and appends them
after a stable period.

Risks: VBlank budget, SRAM-as-work-RAM, wear, games that check SRAM timing.

### P3. Format-aware save replacement (last resort)

Implement the game's save format directly in flash-backed code and redirect the
load/save entry points.  Use when the save is computed at write time and never
exists as a stable SRAM image.  This is the most invasive and should be a
per-game engineering project.

## Layer 3: game hooks

### Boot restore

Two safe patterns:

**Entry trampoline** at `0x100`:

```
0x100: JP trampoline
```

The trampoline saves registers, sets `SP` to WRAM, restores the save region,
restores mapper state and jumps to the original entry target.

**Validator hook** (preferred when available):

```
validator:
  restore save region from flash
  ; fall through to the game's original validation
```

This runs after the game has initialised its mapper state and exactly before it
reads the save data.  SML2's validator at `0x28D9` is an example.

### Save hook

Prefer a 3-byte call-site patch:

```
CALL original_save   ->   CALL save_hook
```

The hook:

1. calls the original save routine;
2. preserves registers and records the caller's bank;
3. disables interrupts;
4. selects the patch code bank, installs the WRAM helper, and backs up any game
   RAM the helper will overwrite;
5. scans, programs and erases through the helper;
6. restores the game RAM and the caller's bank **from bank 0**, then enables
   interrupts;
7. returns.

Do not put the bank restore inside switchable-bank code: writing `0x2000`
unmaps the code that follows, so a trailing `EI`/`RET` would execute from the
wrong bank.  The same rule applies to boot code that runs from an appended
bank.

If only a 1-byte `RET` is available, do not overwrite the next function.  Hook
the caller, relocate the routine, or use a safe `RST` vector.

### General rules from the first complete case

The SML2 case (`games/sml2/`) is the worked example.  The reusable rules:

- **Hook the validator's caller when possible.**  A dedicated validation call
  runs after mapper initialisation and exactly before the save is read.  A
  known caller bank avoids depending on a game bank shadow that may be stale.
- **Restore a known caller bank after a code-bank switch.**  If the boot code
  runs from an appended bank, the bank-0 hook restores the original bank after
  the boot code returns.  Do not restore a game shadow from a context where it
  may be stale.
- **Hook the delete path separately.**  A file-select CLEAR/delete routine often
  writes the empty slot directly and never calls the save writer.  Relocate the
  original body to an appended bank, replace the entry with a `JP` to a bank-0
  trampoline, and journal the cleared region.
- **Do not keep hidden state in game SRAM/WRAM.**  A "flash present" flag or
  bank shadow can be overwritten by the game.  Probe the flash ID per save, or
  keep flags in a region you have proven unused; restore any game state you
  borrow.
- **Do not assume SRAM or WRAM is free.**  Trace both.  A level load can
  overwrite large SRAM/WRAM regions; patch code stored there may be dead by the
  next save.  Keep code in an appended ROM bank, copy only a small helper to
  WRAM on demand, and back up/restore the game's block.  See
  `tools/sram_trace.mjs` and `tools/wram_trace.mjs`.
- **Test after a real level load, not just after boot.**  A synthetic save
  immediately after the title screen can pass while the real save fails.  Add a
  regression that reaches the level, lets the game overwrite work RAM, then
  triggers the save.
- **Test the natural save event too.**  A synthetic jump to the hook proves
  record construction, not the real bank shadow/stack state.  Drive the real
  death, level-complete or menu action and check the record with a NOR-flash
  model.
- **SRAM as stack.**  If `SP` is in `0xA000-0xBFFF`, flash unlock writes that
  disable SRAM cannot execute from SRAM.  The temporary WRAM helper is the safe
  place; it must use no stack while SRAM is disabled and re-enable SRAM before
  returning to the caller.
- **Keep a no-flash debug build.**  If the full build fails on hardware, a build
  that skips program/erase isolates the new manager/stack/bank path from the
  real flash path.
- **MBC1 -> MBC5 conversions must retarget `0x3000` bank writes.**  MBC1's low
  bank register spans `0x2000-0x3FFF`; MBC5 uses `0x3000` for bank bit 8.  A
  game that writes the bank at `0x3000` may boot but render from the wrong
  banks.  Retarget every such write to `0x2000`.
- **Generate a distributable IPS and verify it.**  Apply the patch to the
  original ROM and compare the SHA-1 with the built image.  The full patch can
  include erased padding so any IPS tool produces the exact size; a minimal
  patch needs explicit 0xFF padding.

### Bank safety

- Code running while the log bank is mapped must live in WRAM or fixed bank 0.
- Save and restore the current bank.  If the game has no readable shadow, hook
  only from bank 0 and restore bank 0, or add a bank-shadow write to the game's
  bank-switch helper.
- MBC1: clear the high ROM bits (`0x4000 = 0` in mode 0) before selecting the
  log bank.
- MBC3: do not disturb the RTC latch at `0x6000`.
- MBC5: use `0x3000` for bit 8; prefer `0x6000-0x7FFF` for flash data writes (`0x4000-0x5FFF` is the RAM-bank register on stock MBC5; unproven whether this cart forwards those writes).

## Code placement

| Location | Use |
|---|---|
| Free run in bank 0 | Tiny trampoline/hook (tens of bytes) |
| Blank 16 KiB bank | Main journal blob |
| Appended bank | Main blob when the image has room |
| WRAM | Small helper (flash primitive and bank switch) copied in on demand; back up/restore the game's block |
| SRAM | Temporary backup of the game's WRAM block; only a proven-unused region (trace several levels, map, death), else save/restore what you borrow |

Find candidates with `tools/rom_inspect.py`.

## Log format for a slot journal

Example for a 0x50-byte save slot:

```
record (0x56 bytes):
  0  'S'         magic 0
  1  'V'         magic 1
  2  slot index
  3  0x50        payload length
  4..0x53        slot bytes
  0x54           checksum (sum of bytes 0..0x53)
  0x55           0x5A commit marker (programmed last)
```

At boot: scan records, validate checksum and commit, apply the last valid record
for each slot (or the last record overall if the slot index is not needed).

## Validation strategy

1. **Reader path (emulator):** seed a record into the log's file offset, boot
   the patched ROM, and confirm the game shows the restored save.
2. **Writer path (emulator):** install a small NOR-flash model for the log
   window and answer the flash ID probe.  This exercises record construction,
   duplicate suppression, append, erase and the real save call site.  It does
   **not** model real flash timing or the SRAM disable/re-enable.
3. **Hardware writer path:** create a save, power-cycle, load; delete,
   power-cycle, confirm deleted; reflash, confirm reset.  If the full build
   fails, test the no-flash debug build to isolate the flash path.
4. **Distribution:** generate an IPS against the original ROM, apply it back,
   and compare the SHA-1 with the built image.

## Legacy universal patcher

`patcher/hc007_patcher.py` and `patcher/journal/` remain as a reference for:

- the boot trampoline and WRAM stack rule;
- the mapper-aware bank select;
- the WRAM flash primitives;
- the append-only page journal;
- the staged hardware isolation tests.

Do not extend the universal VBlank journal for commercial games without first
checking the SRAM activity.  Prefer a save-routine hook.
