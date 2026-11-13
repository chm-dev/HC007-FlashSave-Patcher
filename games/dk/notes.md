# Donkey Kong (GB 1994) - notes

## Inventory (2026-11-12)
- 512 KiB, MBC1+RAM+BATTERY, 8 KiB SRAM, no CGB, SGB enhanced. SHA-1 6ed661bd...128e.
- No blank 64 KiB sector/16 KiB bank: log goes in an appended sector (image -> 576 KiB+; check 0x148 options).
- Bank-0 free run: 0x390C (1780 bytes), 0x0061 (159 bytes). Entry 0x0150.
- Passes all WORKFLOW stop conditions.

## Static recon
- sram_activity (1500 frames, no input): quiet; only page 0x1F active (changed in 1 sample); SP never in SRAM.
- Validate routine bank0:0x1EBB: RAM-enable flag mirrored at WRAM 0xC86A; compares 6 nibble-masked bytes at 0xBFFA to ROM 0x2000 signature, 0xBFD8 == 02,07, checksum helper 0x1F5B over 0xBFC0, 0x1F73 over 0xA000; falls back to mirror (0xBFF6 / 0xBFDE).
- TODO: disassemble 0x1F5B/0x1F73, find the writer, trace real play.

## Save format - static findings (2026-11-12, user: game saves only at the prompt after each set of levels, ~4 levels)
Three SRAM objects, all 4-bit data (every read masks AND 0x0F). SRAM bank select 0x1EA8 is a bare RET (stub): only 8 KiB is used.
1. **Progress record** BFBE..BFDB (0x1E bytes): writer = bank 01:0x4CB3..0x4D13 (ends JP 0x1EB2). BFBE/BFBF = slot-bit flags
   (shift/OR), per-slot data from WRAM 0xDA43 (progress/level) + value from CALL 0x2924, marker BFD8=02 BFD9=07, nibble-sum
   checksum over BFC0..(0x1A) stored at BFDA/BFDB. Then copied to mirror BFDC..BFF9. Loader/reader: bank 01:0x4D16.
2. **Score table** A000..A18F (0x190 bytes): writer = bank 17:0x74A9 (insert entry at A000+idx*16, compares vs entry +0x180,
   checksum helper 0x750E). Nibble-sum (0x1F73) stored BE2A/BE2B, backup copy BE2C..BFBB (+ checksum). Sets WRAM 0xC80F=1.
   This may fire at game over, NOT only at the world-end prompt - must journal it too.
3. **Signature** BFFA..BFFF = ROM 0x2000 (6 nibble bytes). Validate bank0:0x1EBB (boot): sig, BFD8/BFD9==02/07, BFC0 chk, A000 chk
   vs BE2A; fallback to mirrors; init/clear path = bank0:0x1F83 (zero BFBE.., A000 x0x4B0, rewrite sig), full wipe = 0x1FB3.
Candidate journal region: A000..A18F + BE2A..BFFF (~870 bytes). Hook points: JP 0x1EB2 exits at bank17:0x750B and bank01:0x4D13
(0x1EB2 itself is shared with boot validate - hook the callers, not the callee). Boot restore: before 0x1EBB runs.
Open: confirm dynamically; find trigger of 4CB3 caller (world-end prompt) and the score-table caller; find delete/reset path (4D58?).

## Dynamic confirmation (2026-11-12) - tools/probe_writers.mjs, no gameplay
Method: boot via harness (skipTitle:false) + a second START (runs validator bank0:0x1EBB, which on empty SRAM runs the init path),
then set PC/SP in the emulator, call a writer with seeded WRAM, diff SRAM, reboot with the result.
(Pitfall: a hand-rolled START tap never reached the validator; baseline looked empty and every "unchanged" result was vacuous.
Always assert the baseline contains the BFFA signature before trusting an acceptance test.)

VERIFIED
- Fresh init: zeroes BFBE..BFFF and A000..A4AF (0x4B0 = 3 x 0x190), writes signature BFFA..BFFF (ROM 0x2000: 09 04 00 02 00 08).
- Progress writer bank1:0x4CB3 (DA43 seeded 0x05): changes BFBF-BFC1 = 01 05 50, BFD8-BFDB = 02 07 0E E0, and the identical mirror
  at BFDD-BFDF / BFF6-BFF9. (DA43=0x0B -> 01 0B B0 / 02 07 14 41.) Checksum = nibble-sum of BFC0..(0x1A).
- That crafted SRAM (progress-a.sav) is accepted: a fresh boot leaves it byte-identical (validator passes, no re-init).
- Whole persistent progress state therefore lives in BFBE..BFFF (0x42 bytes) - tiny.
- Call sites of 0x4CB3: bank0:0x0F55 (via 0x0F4A wrapper), bank1:0x4C91, bank1:0x4DB1. Reader: bank1:0x4D16 (caller bank1:0x539D).

NOT persistent (as observed)
- Bank0:0x0EFE writes 4 bytes at A190+4*rank from WRAM C711. Even on top of a valid progress header, the next boot zeroes them
  (progress+record.sav test). Treat A190+ as session scratch until proven otherwise - who clears it is still open.

NOT YET VERIFIED
- Score/high-score table A000..A18F (+ BE2A checksum, BE2C backup): writer bank17 0x74A9 is only the tail of a function
  (caller bank17:0x73F3 mid-function), direct call crashes. Need a natural-context call or the function entry. Unknown whether
  this table is shown in a menu or is more scratch.
- Whether 0x1EA8 really is a no-op (all 4-bank loops call it); only SRAM bank 0 seen in traces so far.
- Which of the three 4CB3 call sites is the world-end 'save?' prompt (user: save only after each set of ~4 levels).
- Does the game's menu show/continue from the saved progress? (need visual check after boot with progress-a.sav.)
- Every writer ends JP 0x1EB2 (RAM disable): candidate universal commit hook, plus duplicate suppression - but 0x1EB2 is also
  hit by the boot validator and any reader, so the hook must be cheap when nothing changed.

## Menu confirmation (2026-11-12) - analysis/menu-fresh.png vs analysis/menu-progress-a.png
- (The earlier menu1.png was a mid-transition fresh-SRAM frame, not a crafted-save shot; ignore it.)
- Game shows a 3-slot SELECT FILE screen (File 1/2/3, 'New' when empty, CLEAR button).
- Crafted progress-a.sav (made by the game's own writer 0x4CB3 with DA43=0x05, slot flag 01) -> File 1 shows '5', 'STAGE 0-1';
  Files 2/3 stay 'New'. SRAM reads 15 -> 887: the game reads/validates the record. FORMAT ACCEPTED (visual proof).
- So BFBE/BFBF are slot-occupancy flags and 4CB3 writes the selected slot's record; 'CLEAR' is the delete path (not yet located).
- Open: record stride/slot index mapping for slots 2-3, the CLEAR routine, and which call site is the post-level-set save.

## Patch design (2026-11-13) - first playtest build
- Journaled payload: SRAM A000..A18F + BE2A..BFFF (0x366 B).  Record = 0x400 B, 64 per 64 KiB sector (banks 0x20-0x23),
  magic 'DK', sum8, payload, commit 5A A5 programmed last.  Dup-suppressed by comparing SRAM with the newest valid record.
- Hooks (JP/CALL 0x1EB2 -> commit stub bank0:0x3910): bank1 4D13 (progress 4CB3), 54FD (CLEAR), 558D/564B (slot counters),
  51BB/5730 (BFBE file select), bank17 750B (score table), bank0 1FDC (init/wipe/mirror recovery).  Boot: 0x100 -> 0x3A00.
- Not hooked on purpose: 0x1EB2 itself (readers, per-index B4C0 lookups); validator pass path 1F04.
- All code in bank 0 free run (0x3910-0x3FDF).  Flash primitives (SML2 sequences) run from WRAM 0xC900 (0xE0 B), backed up to
  SRAM 0xA500; private stack SRAM 0xA680 (the game stack is 43 B of HRAM).  Caller bank restored from FF8C.
- Boot restore zeroes all cart RAM before copying the payload (hardware SRAM powers up with garbage; init would normally zero
  A000-A4AF).  If the log is empty nothing is touched.
- MBC1->MBC5: only LD (0x2000),A bank writes exist (0x12,0x289,0x0FD0,0x171A); values observed 1..0x1F; lockstep test of
  original vs MBC5-header-only is frame-identical over menu + level 1 (2462 frames).
- Emulator tests (games/dk/tools): test_save_emulator.mjs 21/21 pass; natural flow (garbage SRAM + seeded log -> File 1 shows
  5 / Stage 0-1 -> level plays) passes; noflash build passes all non-flash checks.
- Advisor review changed the design: hooked writer tails, not the shared 1EB2; payload narrowed from 'whole SRAM'.

## Review fixes (2026-11-13)
- **Power-on garbage poisoned the journal** (found by review, reproduced by T7): hardware SRAM starts random; init clears only A000-A4AF and
  BFBE-BFFF, so BE2A-BFBD (score checksum + backup, never rewritten by 4CB3) kept garbage that was journaled into every record, then the
  validator's A000-vs-BE2A and BE2C-vs-BFBC checks failed after the next restore and it re-initialised (save lost).  The emulator hid it
  because serverboy SRAM starts at zero.  Fix: boot code zeroes all cart RAM whenever there is no valid record (and before every restore).
- **B4C0..BBFF / BBC0.. classified as work-RAM snapshots, not persistent** (kept out of the payload): 4E6D (WRAM C200 -> SRAM BBC0..) is called
  from bank0:34D6 when entering state 0x2B and 4EC2 loads it back from bank1:4E0D when leaving; 42C8 (D44D -> B4C0, 0x380 B) is called from
  bank0:309E and 3048 (B4C0 -> C8F1) from bank0:0761 at level start; 42EC/2C54 serialise/replay a DA75 stream.  No checksum or signature,
  never cleared by init (write-before-read design), and a zeroed restore starts level 1 normally.  Residual risk recorded in README.

## Hardware freeze on first playtest (2026-11-13) and the fix
- Symptom (user): both ROMs, including the no-flash build, freeze on the title screen after START.  Serverboy (24 checks) and Gearboy both
  reach Select File and a level for all three builds, so neither emulator reproduced it.
- Hypothesis, reproduced in emulation: the cart's SRAM RAM-bank register (0x4000) powers up in an unknown state and the game never writes it.
  The commit stub keeps SP and variables in SRAM; with a non-existent RAM bank (0x0F) reads are open bus -> SP garbage -> illegal opcodes.
  tools/test_poweron_garbage.mjs randomises WRAM/HRAM/VRAM/SRAM and the RAM-bank register: the ORIGINAL ROM survives all runs, build 1 crashed
  when the bank register was 0x0F.  Gearboy never models this.
- Fix: write 0 to 0x4000 in boot_tramp and as the first act of commit_stub (before touching SRAM).  Build 2 survives all 24 randomised runs.
- NOT confirmed on hardware.  If it still freezes use the isolation ROMs (README).  Also possible: the cart's real RAM-bank behaviour differs
  (e.g. SRAM not reachable in MBC5 header mode until the bank register is written).

## Round 2 (2026-11-13)
- User: dk-hc007 and dk-hc007-noflash still freeze at title after START; iso0/iso1/iso2 do not.  => fault is in the commit stub body.
- Added graded stub builds s1..s4 (STUB1, JNONE, JSCAN, JINST switches); main build unchanged (SHA 66bab330...).
- Candidates still open: 0x4000 write on this cart, SRAM-resident SP/vars (real SRAM may not behave like the emulators' at A5xx-A6xx),
  reading log banks 0x20-0x23 (scan), WRAM C900-C9DF borrow.

## Round 3 - root cause found by reproduction (2026-11-13)
- Hardware: s1 (DI; write 0 to 0x4000; EI; JP 0x1EB2) works, s2 (+ SP/vars/stack in SRAM, empty journal) freezes.
- Hypothesis, now reproduced: a write to a bank register (0x4000, maybe 0x2000) drops cart RAM on this cart.  SML2's flash helper writes 0x0A
  to 0x0000 after every such write; my stub wrote 0x4000 and then immediately used SRAM, so the saved SP read back as open bus.
  test_poweron_garbage.mjs --hostile4000/--hostile2000 models it: build 2 s2 crashed 3/3, s1/passthru/original (no SRAM use after the write) survive.
  Build 1's separate freeze was the unknown power-on RAM-bank register (round 1 fix).
- Fix: write 0x0A to 0x0000 after the stub's 0x4000 write, after its bank restore, and in slot_sel (every ROM bank write before SRAM use).
  All variants survive plain, --hostile4000 and --hostile4000 --hostile2000 power-on matrices; flash-model suite 23/23.
- If build 3 still freezes: s3 (scan), s4 (WRAM backup) are rebuilt with the same fix for isolation.

## Round 4 - root cause found on hardware (2026-11-13)
- Graded builds on the cart: t1 (bank restore from FF8C) ok, t2 (SRAM variable round trip) ok, **t3 (SP switched into SRAM + push/pop) freezes**,
  t4 (full no-flash stub on the game's own stack) ok.  Earlier: s1 ok, s2 froze (also with the SRAM re-enable fix).
- Conclusion: moving SP into cart SRAM freezes this cart (emulators accept it).  My earlier theories (unknown RAM-bank register at power-on;
  bank-register writes dropping cart RAM) were reproduced as *emulator* hazards but were not the hardware cause: t1/t2 and s2-with-fix refute
  the second.  The 0x4000/0x0A writes stay as cheap defensive code (s1/t1/t2/t4 all contain them and work).
- Fix: stub runs on the game's HRAM stack (push AF/BC/DE/HL, ~16 bytes max depth, SRAM only for vars + 0xE0 B WRAM-helper backup).
  Final noflash ROM == t4 byte for byte (SHA 7111ec5b...), so everything except flash program/erase is hardware-proven.
- Removed the private-stack code and the isolation switches (STUB1/JNONE/JSCAN/JINST/STUBT*/NOSWITCH); the evidence stays in this file.

## Round 5 - flash path froze (2026-11-13)
- Hardware: noflash build ok, normal build froze at the title.  Static cause: records were laid out as 64 x 0x400 over each bank's whole
  0x4000-0x7FFF window; on MBC5 0x4000-0x5FFF is the RAM-bank register (docs/FLASH_SAVE_METHOD.md: program/erase only at 0x6000-0x7FFF), so the
  first program write (magic at 0x4000) never reached the chip, the DQ7 poll ran its full 65535-iteration timeout for each of ~875 bytes
  (minutes) and the RAM-bank register took garbage values.  I had not applied that documented rule; the test's flash model accepted writes
  anywhere in the window, so 23 checks passed.
- Reproduced by making the model throw on a program/erase data write below 0x6000 ("flash program data write to 0x4000 in bank 0x20 hits the
  RAM-bank register"); the 64-slot build fails it at the first byte.
- Fix: slot s -> bank 0x20 + (s>>3), CPU 0x6000 + (s&7)*0x400; SLOTS = 32.  Suite passes (erase now every 32 commits).
- Note: the no-flash build is no longer byte-identical to hardware build t4 (only slot_calc/SLOTS differ; scan now reads 0x6000+).
