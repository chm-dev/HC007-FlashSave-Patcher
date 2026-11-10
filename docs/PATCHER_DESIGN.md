# Patcher design (design B)

## Scope

A **binary patcher** for existing GB/GBC ROMs on the HC007 cart.

Target compatibility:

- Mappers: **MBC1, MBC3, MBC5** families (the cart runs all three, and flash
  program/erase is verified in all three header modes).
- SRAM: **8 KiB verified (bank 0)**. The probe's 4-bank test fails on the cart,
  so games that actually use 32 KiB SRAM are unsupported until banked SRAM is
  proven.
- RTC: **not in v1** (MBC3 timer games need extra work).
- ROM: up to **8 MiB minus one 64 KiB sector** (the log needs a spare sector).
- Battery saves only; password/no-save games are out of scope.

Not supported: MBC2, MMM01, MBC6, MBC7, HuC1/HuC3, TAMA5, 128 KiB SRAM,
32 KiB games that use banks 1-3, 8 MiB ROMs with no spare sector, games that
require a real RTC in v1.

## Prototype status (2026-11-10)

- The journal blob and `patch` command work in emulators; the reader regression
  passes.
- The first **patched plain ROMs white-screened on hardware** (GBC and DMG).
- Likely cause: `j_boot` ran before the GBDK crt0 and used the boot ROM's HRAM
  stack (`SP=0xFFFE`); the C restore could overwrite HRAM runtime variables.
  `j_boot` now sets `SP=0xE000`; blob and ROMs rebuilt, **hardware retest
  pending**.
- See `docs/STATUS.md` for verified non-causes and the isolation plan.

## Why a journal instead of patching the game's save code

The game's save format is unknown and game-specific. Instead of finding and
rewriting `save_game()`, the patcher adds a generic **SRAM journal**:

- The game keeps writing to its normal SRAM at `0xA000`.
- A small hook periodically checks whether SRAM changed.
- Changed 256-byte pages are appended to the flash log.
- At boot, the log is replayed into SRAM before the game starts.

The game never knows the difference; its own checksums and save formats stay
intact.

## Pipeline

```
ROM image
  |
  v
[1] parse header, classify mapper, check HC007 limits        (implemented)
  |
  v
[2] choose/append a free 64 KiB log sector + a spare code bank
  |
  v
[3] inject boot trampoline at 0x100
  |
  v
[4] inject flash driver + journal code into the spare bank
  |
  v
[5] patch the save-detection hook (VBlank vector or per-game)
  |
  v
[6] fix header/global checksums, pad the image
  |
  v
patched ROM
```

## [1] Header and plan (implemented)

`patcher/hc007_patcher.py`:

- `info` prints title, cart type, mapper, ROM/RAM size, CGB flag, battery/RTC/
  rumble, and both checksums.
- `plan` finds free 64 KiB sectors (`0xFF` everywhere), proposes the log sector,
  computes the bank and the mapper-specific bank-select registers, and lists
  the remaining stages.

It warns about mapper families, >8 KiB usable SRAM (bank 0 only), RTC, rumble,
8 MiB images, and a bad header checksum.

## [2] Log sector and code bank

**Log sector:** prefer a free 64 KiB sector inside the image. If none exists
and the image is smaller than 8 MiB, pad to the next 64 KiB boundary and use
the following sector. The padded image must have its ROM-size header updated.
For an 8 MiB image there is no spare sector: unsupported.

**Code bank:** the trampoline, flash driver and journal code need ROM space.
Find an all-`0xFF` 16 KiB bank or append one. The trampoline is small; the flash
driver and journal are a few KiB.

**Critical:** never place the log in a sector that contains code. The command
address carries a `0x2000` window offset, so an erase can only hit chip
`>= 0x2000`, but that is a safety net, not a placement strategy.

## [3] Boot trampoline

At reset the boot ROM jumps to `0x100`. The normal entry is:

```
0x100: nop
0x101: jp 0x150
```

Patch `0x100` to `jp trampoline` (3 bytes) and leave the rest. The trampoline:

1. Saves `AF`, `BC`, `DE`, `HL` (the boot ROM leaves `A = 0x11` on CGB,
   `A = 0x01` on DMG; the game may rely on it).
2. Selects the log bank using the mapper mode implied by the header.
3. Replays the journal into SRAM:
   - enable RAM,
   - for each valid page record, write 256 bytes to the page,
   - disable RAM,
   - restore the mapper's RAM bank / mode registers.
4. Restores registers and jumps to the original `0x150`.

If the journal is empty or invalid, leave SRAM untouched; the game's own
"no save" path will initialise it.

The trampoline must run **before the game's first SRAM access** and must not
touch the LCD/PPU or the CGB speed switch.

## [4] Flash driver and journal

### Flash driver

Same proven primitives as `docs/FLASH_SAVE_METHOD.md`:

- Read/program/erase stubs copied to WRAM, interrupts disabled.
- Save/restore `_current_bank` before returning.
- D0/D1-swapped unlock `0xA9/0x56`.
- DQ7 polling with timeouts.
- Program/erase only at CPU `0x6000..0x7FFF`.

Add a **mapper-aware bank-select helper**:

| Mode | Select log bank |
|---|---|
| MBC1 | save `0x4000`, write `0x4000 = high2`, `0x2000 = low5` |
| MBC3 | write `0x2000 = bank` |
| MBC5 | write `0x3000 = bit8`, `0x2000 = low8` |

Save/restore the registers the game cares about (`0x4000` RAM bank, MBC1 mode
register) around every flash operation. In MBC1 mode the data write changes the
mode register; restore it after the byte.

### Journal format

Append-only, power-safe. Suggested records:

**Page record**

| Offset | Size | Value |
|---|---|---|
| 0 | 2 | `'H','P'` |
| 2 | 1 | page index (0..31 for the 8 KiB bank) |
| 3 | 1 | SRAM bank (or derive from page) |
| 4 | 256 | page data |
| 260 | 1 | checksum of bytes 0..259 |
| 261 | 1 | commit marker (`0xA5`) written last |

**Header/reset record**

| Offset | Size | Value |
|---|---|---|
| 0 | 2 | `'H','J'` |
| 2 | 1 | version |
| 3 | 1 | SRAM size code |
| 4 | 2 | checksum |
| 6 | 1 | commit marker |

Rules:

- Scan from the start until the first all-`0xFF` slot; the last valid record
  wins.
- Ignore records with a bad checksum or missing commit marker (torn write).
- Program the commit marker **last**.
- Replaying writes each page in order; later records override earlier ones.
- Compaction: when the log is near full, write a full SRAM snapshot to a new
  sector (or erase the current one at boot) and continue. Keep at least one
  complete snapshot valid during compaction if possible.

### Wear

- Only changed pages are journaled. A typical save touches 1-8 pages
  (256 B-2 KiB). The verified 8 KiB SRAM is 32 pages.
- A 64 KiB sector holds ~250 page records; 128 sectors on the 8 MiB chip.
- Normal games save rarely; this is thousands of saves.
- Debounce: only journal after SRAM has been stable for N seconds, or when the
  game's save routine is known to have completed. This avoids journaling every
  frame in games that use SRAM as scratch.

## [5] Save detection / hook

This is the main compatibility risk. Options, in order of preference:

### A. VBlank vector hook (generic)

Patch the VBlank vector (`0x40`) to a tiny trampoline:

```
push af
increment counter
if counter reaches N:
    checksum the next slice of SRAM
    if the full checksum has been stable for T frames and differs from the
    last journaled state:
        append changed pages
pop af
reti
```

- Keep the per-frame cost tiny (counter check only); do the SRAM walk in small
  slices.
- Risk: games with raster effects, HDMA or tight VBlank budgets may break.
- Make N/slice/T configurable per game in the compatibility DB.

### B. Per-game save routine patch (reliable)

Find the game's save/commit routine and redirect it to the journal code. This
is per-game reverse engineering but avoids VBlank overhead. Use it for games
that fail option A.

### C. RAM-disable interception (limited)

Patch the instruction that disables SRAM after a save. Games often use
`ld (0x0000), a` with `a = 0`; finding every occurrence is not reliable.

Start with A, add B for problem games.

## [6] Header and checksums

- **Do not change `0x147`** unless converting the mapper (keep the game's
  native mode so gameplay stays correct).
- Change `0x148` only if the image is padded to a new ROM size.
- Keep `0x149` as the game declares it if ≤ 8 KiB; warn/refuse if > 8 KiB
  (only bank 0 is verified on this cart).
- Recompute the header checksum at `0x14D`:
  `x = 0; for i in 0x134..0x14C: x = (x - data[i] - 1) & 0xFF`.
- Recompute the global checksum at `0x14E..0x14F` (sum of all other bytes).
- The Nintendo logo at `0x104..0x133` must stay untouched.

## Compatibility and per-game database

A JSON/SQLite database keyed by ROM title + SHA-1, with fields:

- mapper, ROM size, SRAM size, RTC,
- hook mode (`vblank` / `save-routine` / `none`),
- hook parameters (N, slice, stable frames),
- known issues,
- tested status.

See `docs/COMPATIBILITY.md` for the template.

## Milestones

1. **Probe results** (hardware): flash writes in MBC1/MBC3? Mode switch? RTC?
2. **MBC5 prototype**: boot trampoline + journal on a known MBC5 game; power-
   cycle test.
3. **MBC1 mode**: mapper-aware bank select and mode-register save/restore.
4. **MBC3 mode**: same, without RTC.
5. **RTC**: journal RTC registers and hook RTC reads/writes (MBC3 timer games).
6. **Compatibility DB + patcher CLI**: batch patch, verify checksums, report.

## Open questions

- Is the cart's SRAM really 8 KiB, or is 32 KiB present but not banked?
- Does the cart provide a real RTC, and does it survive power-off?
- Do games probe SRAM size and reject 8 KiB when they expect more?
- How much VBlank overhead can representative games tolerate?
- Can the mapper mask ROM banks to the header size (affects appended banks)?
