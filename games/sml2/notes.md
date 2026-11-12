# Super Mario Land 2: 6 Golden Coins

## Identity

- ROM: `roms/patch-test-roms/Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb`
- SHA-1: `bba408539ecbf8d322324956d859bc86e2a9977b`
- CRC32: `d5ec24e4`
- Mapper: MBC1 + RAM + battery (`0x03`)
- ROM: 512 KiB
- SRAM: 8 KiB declared
- CGB: no
- RTC: no

## Inventory

- No blank 64 KiB sector and no blank 16 KiB bank.
- Entry `0x100 -> 0x0150`.
- VBlank vector `0x40 -> 0x0154`.
- Bank 0 has only small free `0xFF` runs: `0x1967` (44), `0x1AFF` (27),
  `0x1930` (23), `0x1A40` (18), `0x191B` (17).
- Bank `0x1A` has a 518-byte `0xFF` run at CPU `0x52CA` - the best code cave.

Evidence: `analysis/inventory.json`.

## SRAM usage

The game uses cartridge SRAM as work RAM, not just as a save file:

- `SP=0xA8FF` at boot (`0x0205`), so page 8 (`0xA800-0xA8FF`) is the stack.
- A 160-byte buffer at `0xA100-0xA19F` is cleared every frame
  (`0x411B`, bank 5 code).
- Pages 1, 2, 4 and 8 show thousands of accesses during normal play.
- Page 0 (`0xA000-0xA0EF`) is quiet except for save-slot writes.

**Consequence:** a whole-SRAM VBlank journal is a poor fit.  Use a save-routine
hook (S1).

Evidence: `analysis/trace-menu.json`, `analysis/trace-play.json`.

## Save format

Three slots of 0x50 bytes:

| Slot | Base |
|---|---|
| 0 | `0xA000` |
| 1 | `0xA050` |
| 2 | `0xA0A0` |

Each slot:

```
+0x00..0x3F  0x40 bytes copied from 0xA840 (game state)
+0x40        byte from 0xA262
+0x41        byte from 0xA263
+0x42        status/occupied byte (from 0xA2C5); 0 = empty, nonzero = used
+0x43        byte from 0xA22C
+0x44        byte from 0xA28D
+0x45        checksum = sum of bytes 0x00..0x44 (mod 256)
+0x46..0x49  magic 12 34 56 78
```

The empty-slot initializer at `0x2918` writes 0x40 zeros followed by
`00 00 00 05 00 02 12 34 56 78`; the checksum `0x02` deliberately does not
match the sum `0x05`, marking the slot empty.

The validator at `0x28D9` checks all three slots in order:

```
28D9: LD HL,0xA000
28DC: CALL 0x28EC
28DF: LD HL,0xA050
28E2: CALL 0x28EC
28E5: LD HL,0xA0A0
28E8: CALL 0x28EC
28EB: RET
```

`0x28EC` sums 0x45 bytes, compares the result with byte `0x45`, then checks
`12 34 56 78` at `0x46..0x49`.

The writer at `0x2934`:

```
HL = 0xA000 + slot * 0x50       ; slot = A2A3
copy 0x40 bytes from 0xA840
copy A262, A263, A2C5, A22C, A28D
store checksum at offset 0x45
RET at 0x2973
```

Call sites: `0x2862` (after a level) and `0x3147` (another save path), plus
banked calls at `0x0F41F4`, `0x0F6F15`, `0x0F6F21`, `0x0F6F27`, `0x0F7040`,
`0x0F714D`, `0x0F73AB`, `0x18470D`, `0x184EAB`.

Evidence: `analysis/save-writer.asm`, `analysis/save-validator.asm`.

## Crafted-save proof

`tools/make-save.py` builds an 8 KiB SRAM image with a valid slot.  Booting it
shows Mario and a save entry on the file-select screen, proving the slot layout
and the status byte.

```powershell
python games/sml2/tools/make-save.py analysis/crafted.sav --slot 0 --status 1
node tools/sram_trace.mjs "roms/patch-test-roms/Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb" `
  --sram games/sml2/analysis/crafted.sav `
  --script "wait:200;tap:START:30;wait:60" `
  --shot games/sml2/analysis/crafted-menu.png
```

Caveat: the file-select screen marks a slot used based on the status byte at
`0x42`; a deliberately bad checksum or magic still showed Mario in that screen.
The checksum/magic validator is `0x28EC` and runs when the game validates or
loads the slot.  The restore hook must therefore run before that validator, not
merely before the file-select display.

## Patch plan

### Boot restore

Preferred: hook the validator `0x28D9`:

```
restore A000-A0EF from flash
; then run the original validator
```

This runs after the game has initialised its mapper state and immediately before
it reads the save slots.  Alternative: entry trampoline at `0x100`.

### Save hook

Hook the `CALL 0x2934` sites, starting with `0x2862` and `0x3147`:

```
CALL 0x2934  ->  CALL save_hook
```

`save_hook` (bank 0 stub):

1. call `0x2934`;
2. preserve `AF, BC, DE, HL`;
3. select the log bank;
4. append the 0xF0-byte save region (or the active 0x50-byte slot);
5. restore the bank;
6. return.

If the 3-byte call-site patch is too invasive, hook the callee entry and
relocate the original 0x2934 body into the code cave.

### Mapper conversion

SML2 only uses MBC1 mode 0 bank writes (`0x2000`, values `0x00-0x1F`) and never
writes `0x4000` (RAM/high ROM) or `0x6000` (mode).  That makes a header
conversion to MBC5 (`0x147 = 0x1B`) safe in principle: the same `0x2000` writes
select the same banks, and the HC007 runs MBC5 headers.  A patched test image
booted to the file-select screen in serverboy.

MBC5 also makes the log bank easy to select (9-bit bank register, no MBC1 mode
switch).

### Code placement

- Bank 0 stub: use the 44-byte free run at `0x1967` (verify no xrefs) or another
  free run.
- Main journal: bank `0x1A` free run at CPU `0x52CA` (518 bytes) or an appended
  bank.
- Log: append 32 banks to 1 MiB (`0x100000`), use the new 64 KiB sector
  `0x80000-0x8FFFF`, bank `0x20`, CPU `0x6000-0x7FFF` (chip
  `0x82000-0x83FFF`).  Update `0x147 = 0x1B`, `0x148 = 0x05`, and both
  checksums.
- The overlay leaves the original banks 0-31 at their original file offsets.

### Bank safety

- The save call sites are in fixed bank 0.  After the hook, restore the bank the
  caller had.  The mapper trace shows the game's bank writes; at a save event,
  record the active bank and hardcode it if it is stable.  If no shadow is
  available, restore bank 1 and test.
- MBC5: write `0x2000` for the low 8 bits and `0x3000` for bit 8; never write
  flash data at `0x4000-0x5FFF`.
- All flash code runs from WRAM, interrupts disabled.

## Test log

| Test | Result | Notes |
|---|---|---|
| Boot (emulator) | not yet | |
| Fresh save | not yet | |
| Save, reset, load | not yet | |
| Delete | not yet | |
| Boot (hardware) | not yet | |
| Power-cycle load | not yet | |
| Power-cycle delete | not yet | |
| Reflash reset | not yet | |

## Open questions

1. Which routine deletes a slot (the `CLEAR` option)?  Trace it with a crafted
   save present and hook it too if it does not go through `0x2934`.
2. What bank is selected at `0x2862`/`0x3147` when the save is written?
3. Does the game tolerate a save hook that leaves bank 1 (or the log bank)
   selected after returning?
4. Can the 0x1967 free run be used, or is it referenced by a jump table?
5. Does the 0x1A52CA code cave have any xrefs?
6. Does the game validate slots again after the boot validator (e.g. on file
   select), and would a restore there be safer?
