# Batteryless saves on MBC5 flash carts (GBDK)

> **Role in this project:** low-level transport reference.  It documents the
> proven WRAM flash driver and append-only log.  It is **not** the per-game
> strategy; see `docs/WORKFLOW.md` for choosing between a save-routine hook and
> a page journal, and `docs/PATCHER_DESIGN.md` for the current pattern (journal
> code in an appended ROM bank, only the flash primitive in WRAM, with the
> game block backed up/restored).  `patcher/rom_ips.py` turns a built image
> into a distributable IPS.

> **Imported from the Robbo DMG port.** This is the method that was proven on
> the HC007 cart in `C:\dev\AI\robbo-port2` (`BATTERYLESS_SAVE.md`). Paths such
> as `gb/src/gb/flashsave.c` refer to that repository; this project will grow
> its own implementation. The hardware facts and WRAM-stub lessons are directly
> reusable.
>
> **Cart note:** the HC007's 4-bank SRAM test fails; only bank 0 (8 KiB) is
> verified. Use an 8 KiB journal (32 pages of 256 bytes) for this cart.
>
> **Boot trampoline note:** C code that runs from the reset vector before the
> game's crt0 must switch the stack to WRAM (e.g. `SP=0xE000`).  The boot ROM's
> `SP=0xFFFE` is in HRAM and only ~127 bytes; a C restore routine can overwrite
> GBDK HRAM variables and white-screen the game.  See `docs/STATUS.md` for the
> patcher prototype's first hardware failure.

This document describes the method used by this port to keep a savegame on a
battery-less bootleg Game Boy cartridge: an **append-only log in the cartridge's
NOR flash**, reached through the MBC5 bank window, with all flash code running
from WRAM.  It is written so it can be applied to another GBDK project that
already has a small SRAM/FRAM save (like this port's original `save.c`).

The implementation here is in `gb/src/gb/flashsave.c` and `gb/src/gb/save.c`,
behind `-DCART_HC007`.  Treat the code as the reference and this document as the
porting guide.

---

## 0. When this applies

Use this method when all of the following are true:

- The cartridge is **MBC5** (or MBC5-compatible) with a **NOR flash** chip.
- There is **no battery**, so ordinary cartridge RAM does not survive power-off.
- The flash chip is large enough to hold the ROM image **plus** a spare sector.
- You can flash the cart with an image that leaves the log sector erased, or you
  accept a one-time erase of foreign data at first boot.

It does **not** apply to:

- Battery-backed SRAM/FRAM carts (keep the ordinary save; this layer is
  unnecessary).
- Flash carts whose mapper hides the flash behind a different command set.
- Carts where the save sector would overlap the ROM image (see §2).

The original Robbo save is a tiny 8-byte record in cartridge RAM, with two
copies and a checksum.  The flash layer keeps that record for the powered
session and adds a second copy in flash that survives power-off.  Nothing in the
existing save API changes.

---

## 1. Probe the cartridge before touching the game

Do **not** ship flash code until the cart has answered these questions on real
hardware.  Build a throwaway probe ROM (here: `-FlashProbe`,
`gb/tests/flashprobe/flashprobe.c`) that:

1. Reads the flash **manufacturer/device ID** with the standard unlock sequence.
2. Tries **both** unlock byte pairs: `0xAA/0x55` and, if that fails, the
   D0/D1-swapped pair `0xA9/0x56`.
3. **Programs one byte** in a safe sector and reads it back.
4. **Erases that sector** and verifies it reads `0xFF`.
5. Prints the results on screen (and repeats them in a loop so a photo or a
   second run can confirm).

The HC007-BGA-V2 board used here returned:

```
ID A9: 20 00 7D 00     -> unlock bytes are 0xA9/0x56 (D0/D1 swapped)
ID AA: FF FF FF FF     -> standard 0xAA/0x55 does not work
PROG err=00 rd=5A      -> programming works
ERASE err=00 rd=FF     -> erase works
VAR:A9/56
SECTOR: 5A
```

Write those results down.  They determine:

- the **unlock bytes** (`0xA9/0x56` here, `0xAA/0x55` on normal wiring),
- whether the chip is **AMD-compatible** (it is, if the ID reads `20 00 7D 00`
  for M29W640),
- that the CPU can reach the flash through the MBC5 window at all.

If the probe cannot read the ID, stop: the cart may not expose flash to the CPU,
or the mapper may need a different unlock path.

### Probe safety

- Put the probe in its own build profile and its own output name
  (`roms/flashprobe.gb`).  Never merge probe code into the game image.
- Have the probe **only** touch a sector that cannot contain its own code.
  With the MBC5 window at `0x4000..0x7FFF`, the command address carries a
  `0x2000` offset, so the lowest chip address an erase can hit is `0x2000`;
  the probe's own first 8 KiB are unreachable.  Do not rely on that by accident:
  choose the sector deliberately.
- Every flash routine must run from WRAM (see §4).  The probe demonstrates this
  first; reuse its patterns in the game.

---

## 2. Address model and where to put the log

### Chip address

With the MBC5 bank register selecting a 16 KiB half at CPU `0x4000..0x7FFF`:

```
chip address = bank * 0x4000 + (cpu_address - 0x4000)
```

Example: bank `0x1C`, CPU `0x6000` → chip `0x70000 + 0x2000 = 0x72000`.

### Writable CPU range

On a stock MBC5, **`0x4000..0x5FFF` is the RAM-bank register**, not cartridge space.  Treat `0x6000..0x7FFF` as the safe window.  (It is not proven that this cart ignores data writes below `0x6000`: Marc Robledo's batteryless patcher (MIT, github.com/marcrobledo/game-boy-batteryless-patcher) writes flash data at 0x4000-0x5FFF on this cart type, so the window may well work; unproven either way here.)
Writes there change the mapper instead of programming flash.  Therefore:

- Program and erase only at CPU **`0x6000..0x7FFF`** (or below `0x4000` for the
  unlock/command addresses, which the flash chip also sees).
- The unlock addresses `0x0AAA`/`0x0555` live in the fixed bank-0 window.  They
  reach the flash chip *and* the MBC5 RAM-enable register; that is expected.
  Restore the RAM state afterwards (`SWITCH_RAM(0); DISABLE_RAM;`).

### Choosing the sector

Pick a **64 KiB sector** (M29W640 sector size) that:

1. Is **not** part of the ROM image's used banks.
2. Is reachable by a bank number that fits the mapper and the image size.
3. Is left as `0xFF` by your flashing workflow.

Two common layouts:

| Layout | ROM image | Log location | Reflash behaviour |
|---|---|---|---|
| In-image padding | 512 KiB (32 banks) | chip `0x72000`, bank `0x1C`, CPU `0x6000` | Reflashing the image always erases the log (padding is `0xFF`). |
| Beyond the image | 256 KiB (16 banks) | chip `0x78000` or higher | Log survives a reflash of the 256 KiB image, but a full-chip dump/restore can overwrite it. |

This port uses **in-image padding** (512 KiB image, log at chip `0x72000`).
The trade-off is a larger `.gb` file; the benefit is deterministic behaviour:
flash the image and the save is gone, exactly like a fresh cart.  The 512 KiB
image also lets emulators and flashers map bank `0x1C` normally.

> The command address carries the `0x2000` window offset, so even a masked bank
> register can only erase a sector at chip `>= 0x2000`.  Never place the log in
> the sector that holds your reset/vector/code.

---

## 3. Record format and the append-only log

Flash cells can only be programmed from `1` to `0` (and erased back to `1`), so
rewriting one slot in place is impossible.  Use an **append-only log**:

```
slot 0   8 bytes
slot 1   8 bytes
...
slot N   first all-0xFF slot -> next write position
```

### Record layout (8 bytes)

| Offset | Value | Meaning |
|---|---|---|
| 0 | `'R'` (`0x52`) | magic 0 |
| 1 | `'F'` (`0x46`) | magic 1 |
| 2 | level | payload |
| 3 | `level ^ 0xFF` | payload check |
| 4 | `0xA5` | marker |
| 5 | `0x5A` | marker |
| 6 | `0x00` | padding |
| 7 | `0x00` | padding |

- **Level 0 is a delete tombstone.**  Appending it means "no save", without
  erasing anything.
- Validation requires both magic bytes, both markers, the inverted level, and
  `level <= LEVEL_COUNT`.
- **Program the constants before the magic pair.**  A power cut mid-record then
  leaves a slot whose magic is missing, so it can never be mistaken for a valid
  save.  The order used here is:
  `mark0, mark1, level, inverse, pad0, pad1, magic0, magic1`.
- **Last valid record wins.**  Scan from slot 0 until the first all-`0xFF` slot;
  remember the last valid record; that offset is the next append position.
- If the log is full (`append == window size`), erase the sector once and start
  over.  A power cut during that erase loses the save, which is no worse than a
  blank cart.

### Wear

The log is written **only when the saved value actually changes and improves**
(here: the level increases).  With 1024 slots of 8 bytes in a 8 KiB window and
at most 54 level increases per run, normal play never fills the log and never
erases.  Repeated delete/rewrite cycles also consume slots, so the tombstone
append is guarded: deleting an already-deleted log does nothing.

---

## 4. The WRAM-resident code requirement (the critical part)

This is the mistake that cost the most time in this port, so read it carefully.

### The trap

Suppose the flash functions live in bank 14 at CPU `0x4000..0x7FFF`.  To read or
write the log you must select bank `0x1C`.  The moment you write the bank
register, **the code you are executing is unmapped**: the next instruction fetch
at `0x4xxx` comes from bank `0x1C`, not bank 14.  The CPU executes garbage and
typically crashes to `0x0038` (RST 38) with the display off.

The same applies after the flash operation: if the routine returns while bank
`0x1C` is still selected, the caller's code page is gone too.

### The rule

**Every instruction that runs while the flash bank is selected must live in
WRAM (or in the fixed bank 0), and the ROM bank must be restored before
returning to the caller.**

This port keeps the stubs in `flashsave.c` as SDCC inline assembly, bracketed by
`_start`/`_end` labels, copies them to a WRAM buffer with `memcpy`, and calls
them through a function pointer with interrupts disabled:

```c
static uint8_t fs_code[96];

static void fs_run_code(uint8_t *start, uint8_t *end)
{
    uint16_t len = (uint16_t)end - (uint16_t)start;

    memcpy(fs_code, start, len);

    disable_interrupts();
    ((void (*)(void))fs_code)();
    enable_interrupts();
}
```

The stub saves and restores the tracked bank itself, because the C caller cannot
run while the flash bank is mapped:

```asm
_fs_read_start:
        di
        ld  a, (__current_bank)   ; GBDK's tracked bank (HRAM)
        push af
        ld  a, #0x1C              ; log bank
        ld  (0x2000), a           ; MBC5 ROM bank register
        ld  a, (_fs_off)
        ld  l, a
        ld  a, (_fs_off+1)
        add a, #0x60              ; 0x6000 + offset
        ld  h, a
        ld  de, #_fs_slot
        ld  b, #8
_fs_read_loop:
        ld  a, (hl)
        ld  (de), a
        inc hl
        inc de
        dec b
        jr  nz, _fs_read_loop
        pop af
        ld  (0x2000), a           ; restore the caller's bank BEFORE returning
        ret
_fs_read_end:
```

### Practical checklist for the stubs

- `di` at the start; the C wrapper re-enables interrupts after the call.
- Save `_current_bank` (`__current_bank` in asm) and restore it before `ret`.
  Do not hardcode the caller's bank if the stub may be called from more than one
  bank; read the tracked value.
- Do not call `memcpy`, `set_bkg_data`, or any banked function while the flash
  bank is selected.  Only WRAM/HRAM/register operations.
- Keep the stub in a buffer that is not used by anything else during the call.
- If the flash chip is unreadable while busy (NOR program/erase), poll **DQ7**
  from the same WRAM stub, not from banked C code.
- After a program/erase, the stub writes `0xF0` to `0x4000` (flash reset *and*
  MBC5 RAM bank register).  Follow it with `SWITCH_RAM(0); DISABLE_RAM;` in C.
- `__current_bank` is a GBDK symbol at a fixed HRAM address (e.g. `0xFF90`);
  reference it symbolically in asm so a GBDK update does not silently break it.

### Unlock sequence used here (D0/D1 swapped)

```asm
        ld  a, #0x1C
        ld  (0x2000), a     ; bank
        ld  a, #0xF0
        ld  (0x4000), a     ; reset
        nop
        ld  a, #0xA9        ; 0xAA with D0/D1 swapped
        ld  (0x0AAA), a
        nop
        ld  a, #0x56        ; 0x55 with D0/D1 swapped
        ld  (0x0555), a
        nop
        ld  a, #0xA0        ; program command
        ld  (0x0AAA), a
        nop
        ; write the data byte to 0x6000 + offset
        ; poll DQ7 until it matches, with a timeout
        ld  a, #0xF0
        ld  (0x4000), a     ; reset
```

Erase uses `0x80` then `0xA9/0x56` then `0x30` at `0x6000`, followed by a DQ7
poll (reads `0xFF` when complete).  Keep generous timeouts (this port uses a
16-bit outer counter, roughly 30 s worst case); a timeout sets an error flag and
the record is treated as failed.

If your probe showed `0xAA/0x55` works, use those bytes instead; the rest of the
sequence is identical.

---

## 5. Integrating with an existing SRAM/FRAM save

Keep the existing record and API.  Add flash as a second, persistent copy:

```c
uint8_t save_load(void)
{
    uint8_t best = /* existing SRAM slots */;

#ifdef CART_HC007
    best = max(best, flashsave_load());
#endif
    return best;
}

uint8_t save_store(uint8_t level)
{
    uint8_t old = save_load();

#ifdef CART_HC007
    uint8_t flashed = flashsave_store(level);  /* no-op unless it improves */
    if (flashed > old) old = flashed;
#endif

    /* existing SRAM write, still skipped for level 1 / non-improvements */
    ...
}

void save_erase(void)
{
    /* existing SRAM clear */
#ifdef CART_HC007
    flashsave_erase();   /* appends a level-0 tombstone */
#endif
}
```

Rules that matter:

- **`save_store` must be idempotent for non-improvements.**  The flash log only
  appends when the new level is greater than the log's current value, so
  replaying a lower level never consumes a slot or downgrades the save.
- **Level 1 never creates a save.**  A fresh cart must still behave like a fresh
  cart (no title start-level menu).
- **`save_erase` clears every SRAM slot *and* appends the tombstone.**  If you
  only clear SRAM, the flash copy resurrects the save.
- Keep the flash module in a bank with room.  Here it is bank 14 (the same bank
  as the teleport resolver on GB); the default build compiles the file to an
  empty translation unit.
- Guard the module with the cart define so the default ROM is **byte-for-byte
  unchanged** and bank 0 does not grow.

---

## 6. Build profile

Do not change the default build.  Add an opt-in profile (here `-Cart hc007`)
with its own output names and object directory:

```powershell
pwsh -File gb/tools/build.ps1 -Cart hc007
pwsh -File gb/tools/build.ps1 -Cart hc007 -DebugRom
```

Flags used here:

| Flag | Effect | Header |
|---|---|---|
| `-Wl-yo32` | 32 × 16 KiB ROM banks = 512 KiB | `0x148 = 0x04` |
| `-Wl-ya4` | 4 × 8 KiB RAM banks = 32 KiB | `0x149 = 0x03` |
| `-Wl-yt0x1B` | MBC5 + RAM + battery bit (metadata only) | `0x147 = 0x1B` |
| `-DCART_HC007` | enables the flash layer | — |

Why 512 KiB: the log's sector must be inside the image's `0xFF` padding so a
reflash resets it, and bank `0x1C` must be a valid bank for emulators/flashers.
If your cart has different RAM/flash sizes, adjust `-Wl-yaN` and the padding;
verify the header bytes after building.

---

## 7. Testing without a flash emulator

Most Game Boy emulators (serverboy, SameBoy, Gearboy) **drop ROM writes**; they
will not exercise programming or erase.  Split the testing in two.

### 7.1 Reader path (emulator)

Because the log is a normal ROM window, you can pre-seed records into a copy of
the ROM image at the file offset that corresponds to the log:

```
file offset = bank * 0x4000 + (cpu_address - 0x4000)
```

For this port: bank `0x1C`, CPU `0x6000` → `0x72000`.

Write a test that:

1. Asserts the image size and header (`0x147`, `0x148`, `0x149`).
2. Asserts the log area is `0xFF` padding in the shipped image.
3. Boots a **blank** image and checks the game starts at level 1 with no save.
4. Seeds one valid record and checks the title/start path picks it up.
5. Seeds two records and checks the later one wins.
6. Seeds a tombstone and checks the save is gone.
7. Seeds a torn record (missing magic) and a corrupt record (bad inverse/range)
   and checks the older valid record survives.

This port's test is `gb/tests/checkpoint30.mjs`; copy its structure.  It also
proves the WRAM read stub works, because a broken stub crashes at boot.

### 7.2 Writer path (real hardware)

Only hardware can validate programming and erase:

1. Flash the probe, confirm ID + program + erase.
2. Flash the game image.
3. Play to level 2+ (the save is written on the level increase).
4. Power off, wait, power on.
5. Confirm the title offers the start-level menu at the saved level.
6. Delete the save, power-cycle, and confirm it stays deleted.
7. (Optional) Reflash the image and confirm the save is reset, because the
   sector is `0xFF` padding again.

Also check the debug and release images separately if both are produced; they
share the save code.

---

## 8. Porting checklist

Use this as the order of work for another GBDK project:

1. **Inventory the cart**: mapper, flash chip, RAM size, battery, sector size.
2. **Build the probe** as a separate profile; run it on hardware; record:
   - unlock bytes (`0xAA/0x55` or `0xA9/0x56`),
   - ID bytes,
   - program/erase success,
   - a safe sector you can erase.
3. **Pick the log sector** and bank.  Compute chip addresses with
   `bank * 0x4000 + (cpu - 0x4000)`.  Keep writes at CPU `0x6000..0x7FFF`.
4. **Choose the build profile**: image size, RAM size, `-D` flag, output names.
   Keep the default build untouched.
5. **Write the WRAM stubs** (read, program, erase), each saving/restoring
   `_current_bank`, with `di` and DQ7 polling.  Verify the assembled bytes in
   the ROM (dump the `_start.._end` range) before running them.
6. **Implement the record + scan/append** exactly as in §3.  Program constants
   before magic.
7. **Wire it into the existing save API** with `max()` on load, append before the
   SRAM write, tombstone on erase, and the level-1 guard.
8. **Add the reader regression test** (§7.1) and run it.
9. **Run the existing suite** to confirm the default build is unchanged.
10. **Flash and power-cycle** on hardware (§7.2).
11. **Document the cart-specific constants** (unlock bytes, bank, sector,
    header) next to the code.

---

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Boot hangs with display off, PC at `0x0038` | Code that switches to the flash bank is running from a banked ROM page. Move the stub to WRAM and restore the bank before `ret`. |
| Save works while powered, lost at power-off | The write never reached flash (wrong unlock bytes, wrong bank, or the write went to `0x4000..0x5FFF`). Re-run the probe. |
| First boot after flashing takes ~8 s | The sector holds foreign data, so the scan reaches the end and erases once. Subsequent boots are fast. |
| Save disappears after reflashing | Expected with the in-image padding layout: the log sector is part of the image and is written back as `0xFF`. |
| Save resurrects after "delete" | `save_erase` cleared SRAM but did not append the flash tombstone. |
| Emulator never sees a save | Emulators drop ROM writes; use the seeded-reader test or real hardware. |
| Level 1 creates a save | The level guard (`level < 2`) is missing; a fresh cart must have no save. |
| Random corruption after a flash call | Interrupts were enabled during the bank switch, or a banked function was called while the flash bank was mapped. |

---

## 10. Reference implementation in this repository

| Item | Location |
|---|---|
| Flash log (bank 14, `CART_HC007` only) | `gb/src/gb/flashsave.c`, `gb/src/gb/flashsave.h` |
| SRAM record + integration | `gb/src/gb/save.c`, `gb/src/gb/save.h` |
| Probe ROM | `gb/tests/flashprobe/flashprobe.c`, `-FlashProbe` |
| Reader regression test | `gb/tests/checkpoint30.mjs` |
| Build profile | `gb/tools/build.ps1` (`-Cart hc007`) |
| Cart constants | `FS_BANK 0x1C`, `FS_BASE 0x6000`, record layout at the top of `flashsave.c` |

Verified on the HC007-BGA-V2 (M29W640, 32 KiB SRAM, no battery):

- probe: `ID A9: 20 00 7D 00`, program `5A`, erase `FF`, `VAR:A9/56`;
- game: level persisted across power cycles with `robbo-hc007-debug.gb`;
- reader test: blank/tombstone/torn/corrupt/out-of-range records handled;
- Gearboy: seeded level 9 opens `STARTING LEVEL 09`, starts level 9, and the
  pause menu shows `WARP TO <09>`.

If you copy this into another project, keep the hardware-specific numbers in one
place (as `FS_*` constants) and re-run the probe for every new cart revision.
