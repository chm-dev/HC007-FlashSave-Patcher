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
- every routine runs from WRAM with interrupts disabled;
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
2. preserves registers;
3. selects the log bank;
4. appends a record;
5. restores the bank;
6. returns.

If only a 1-byte `RET` is available, do not overwrite the next function.  Hook
the caller, relocate the routine, or use a safe `RST` vector.

### Bank safety

- Code running while the log bank is mapped must live in WRAM or fixed bank 0.
- Save and restore the current bank.  If the game has no readable shadow, hook
  only from bank 0 and restore bank 0, or add a bank-shadow write to the game's
  bank-switch helper.
- MBC1: clear the high ROM bits (`0x4000 = 0` in mode 0) before selecting the
  log bank.
- MBC3: do not disturb the RTC latch at `0x6000`.
- MBC5: use `0x3000` for bit 8; never write flash data at `0x4000-0x5FFF`.

## Code placement

| Location | Use |
|---|---|
| Free run in bank 0 | Tiny trampoline/hook (tens of bytes) |
| Blank 16 KiB bank | Main journal blob |
| Appended bank | Main blob when the image has room |
| WRAM | Flash program/erase stubs and any code that runs with the log bank mapped |
| SRAM | Only if proven safe; slower and unusual |

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

1. **Reader path (emulator):** seed a record into the log's file offset, boot the
   patched ROM, and confirm the game shows the restored save.  Emulators drop
   ROM writes, so this is the only emulator path.
2. **Writer path (hardware):** create a save, power-cycle, load; delete,
   power-cycle, confirm deleted; reflash, confirm reset.

## Legacy universal patcher

`patcher/hc007_patcher.py` and `patcher/journal/` remain as a reference for:

- the boot trampoline and WRAM stack rule;
- the mapper-aware bank select;
- the WRAM flash primitives;
- the append-only page journal;
- the staged hardware isolation tests.

Do not extend the universal VBlank journal for commercial games without first
checking the SRAM activity.  Prefer a save-routine hook.
