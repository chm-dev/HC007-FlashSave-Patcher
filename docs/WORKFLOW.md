# Per-game workflow

This is the procedure for taking one Game Boy ROM from "unknown save system" to
a hardware-tested HC007 patch.  It is deliberately evidence-driven: every claim
about a save format is backed by a trace, a crafted-save boot test, or a
disassembly listing stored in the game's case folder.

## 0. Create the case

```powershell
Copy-Item -Recurse games/_template games\<slug>
```

Fill in `games/<slug>/case.json` immediately: title, SHA-1, mapper, declared
ROM/RAM, battery/RTC flags.  The source ROM itself stays in `roms/` and is never
committed.

## 1. Inventory

```powershell
python tools/rom_inspect.py roms\<game>.gb --json games\<slug>\analysis\inventory.json
```

Record in `notes.md`:

- mapper family, declared ROM size, declared RAM size;
- blank 16 KiB banks / 64 KiB sectors and the largest free runs in bank 0;
- entry target and interrupt vectors;
- anything unusual (non-standard header checksum, missing logo, 8 MiB image).

**Stop conditions**

- Mapper is not MBC1/MBC3/MBC5 (MBC2, MMM01, MBC6, MBC7, HuC, TAMA5): stop.
- Declared RAM is > 8 KiB and the game actually uses banks 1-3: stop until the
  cart's banked SRAM is proven.
- 8 MiB ROM: no spare 64 KiB sector for the log; stop unless another sector can
  be reclaimed.
- No cartridge RAM and no battery: probably a password/no-save game; stop.

## 2. Static reconnaissance

```powershell
# Disassemble the entry point / vectors.
python tools/gbdis.py roms\<game>.gb --bank 0 --range 0x100:0x180

# All direct SRAM operands and SRAM pointer loads.
python tools/gbdis.py roms\<game>.gb --sram-refs --limit 0 --json games\<slug>\analysis\sram-refs.json
```

The static list is noisy because a linear sweep disassembles data as code.  Use
it to find candidate routines, then confirm with a dynamic trace.

Look for:

- writes to `0x0000-0x1FFF` with `A = 0x0A` (RAM enable) and `A = 0x00` (disable);
- a small cluster of `LD (0xAxxx),A` / `LD A,(0xAxxx)` operations, especially
  around a `CALL`/`RET`;
- a checksum loop (`ADD A,C`, `XOR`, rotating hash) followed by a compare;
- fixed magic bytes (`12 34 56 78`, `'SAVE'`, etc.);
- a slot-index calculation (`SLA`/`SWAP`/multiply) before the `0xA000` base.

Save the useful listings as `analysis/<name>.asm`.

## 3. Dynamic SRAM trace

`tools/sram_trace.mjs` wraps the emulator's SRAM readers/writers and reports the
hottest `(PC, ROM bank, SRAM bank, address)` tuples.  It also traces writes to
the mapper registers, which explains RAM-enable/disable and banking around a
save.

Start with the boot/title/menu path:

```powershell
node tools/sram_trace.mjs roms\<game>.gb `
  --script "wait:200;tap:START:30;wait:120" `
  --json games\<slug>\analysis\trace-menu.json `
  --shot games\<slug>\analysis\menu.png
```

Then reach an actual save and trace it.  Keep the trace script in
`games/<slug>/trace.json` so it can be replayed:

```powershell
node tools/sram_trace.mjs roms\<game>.gb `
  --script-file games\<slug>\trace.json `
  --json games\<slug>\analysis\trace-save.json
```

Interpretation:

- **Page activity at boot** that stops: likely SRAM initialisation or a
  checksum scan.
- **Pages changing every frame** with high PC counts: SRAM is being used as
  work RAM / stack / scratch.  A whole-SRAM journal is unsuitable; use a save
  hook.
- **A short burst of writes to a small address range** immediately after a
  "SAVE" action: that is the save routine.
- **Reads during the file-select/menu**: that is the load/validate path.
- **Writes to mapper registers** at the same PC as the save burst: note the
  bank state and RAM-enable sequence.

Once you have a trace, turn the hot PCs into code context:

```powershell
python tools/trace_report.py roms\<game>.gb analysis\trace-save.json `
  --top 16 --type writes
```

The `>>` marker is the instruction that actually performed the access.

For a quick independent screen, run:

```powershell
node tools/sram_activity.mjs roms\<game>.gb 1500
```

The tool reports hot pages and whether SP is inside `0xA000-0xBFFF`.  A hot
page or an SRAM stack means "do not journal the whole SRAM".

## 4. Map the save format

For every save slot, identify:

| Item | Question |
|---|---|
| Base | Where does the first slot start? |
| Stride | How far apart are slots? |
| Size | How many bytes are meaningful? |
| Status | Which byte marks "occupied"? |
| Checksum | Which bytes are summed/hashed, and where is the result stored? |
| Magic | Are there fixed signature bytes? |
| Init | What does the game write for an empty slot? |
| Delete | What does the game write when the player deletes a save? |
| Write routine | Which function writes the slot? |
| Validate routine | Which function checks a slot at boot/menu? |
| Load routine | Which function copies a slot into game state? |

**Craft a valid save to prove the format.**  This is the strongest evidence.
Build an SRAM image with one slot filled, compute the checksum, boot the ROM
with `--sram`, and check that the file-select screen treats the slot as used.
For SML2 the recipe is in `games/sml2/tools/make-save.py`.

If the game accepts the crafted slot, you know the format is correct.  If not,
vary one field at a time and record what the menu displays.

## 5. Choose the patch strategy

### S1. Save-routine hook (preferred)

Hook the routine that writes the save data.  After it finishes, append the
meaningful save region to the flash log.  At boot, restore the region before the
game validates/loads it.

Why: precise, no per-frame overhead, unaffected by SRAM used as work RAM.

Needs:

- exact save-write routine and a safe point to hook (entry, return, or caller);
- a boot restore point before the first save read;
- code space and a bank-safe calling convention.

### S2. SRAM page journal (fallback)

The existing prototype: checksum SRAM pages in VBlank, append changed pages,
replay at boot.  Only use when:

- SRAM is quiet during gameplay (no hot pages, no SRAM stack);
- the save region is small (one or a few 256-byte pages);
- the game tolerates the VBlank cost.

### S3. Format-aware replacement (last resort)

Replace the game's save/load routines with flash-backed code that speaks the
game's save format.  Use when the save data is computed on the fly and never
lands in a stable SRAM region.  This is the most invasive option.

### S4. Unsupported

Password saves, no-save games, RTC-dependent saves in v1, mappers outside
MBC1/3/5, games that need > 8 KiB of battery-backed SRAM.

Record the chosen strategy and the reason in `case.json`.

## 6. Code placement and hook mechanics

### Boot restore

The simplest boot hook is the reset entry at `0x100`:

```
0x100: JP restore_trampoline
```

The trampoline must:

1. save `AF, BC, DE, HL`;
2. set a safe stack (WRAM, e.g. `SP=0xE000`; the boot ROM leaves SP in HRAM);
3. read the log and restore the save region;
4. restore the mapper registers the game expects;
5. restore registers and jump to the original entry target.

If the game has a dedicated save-validation routine (SML2 `0x28D9`), hooking
that instead of `0x100` is often safer: it runs after the game has initialised
its mapper state, and it is exactly where save data is first read.

### Save hook

Prefer a 3-byte hook at a `CALL` site:

```
CALL save_routine      ->   CALL save_hook
```

The hook calls the original save routine, then journals the save region, then
returns.  This avoids relocating the original function.

If there is only a 1-byte `RET` available and no spare byte after it, do **not**
overwrite the next function.  Options:

- hook the caller(s) instead of the callee;
- hook a 1-byte `RST` vector if the game does not use it;
- relocate the original routine into free space and replace its entry with a
  3-byte `JP`.

### Code space

Find candidates with `rom_inspect.py`:

- free runs in bank 0 (`0xFF` or `0x00` runs) for a small trampoline;
- a blank / mostly-blank 16 KiB bank for the main blob;
- an appended bank if the image has room and the mapper can select it.

Bank switching rules:

- Code that runs while the log bank is selected must live in **WRAM** or fixed
  bank 0.  Selecting a bank at `0x4000` unmaps the caller if the caller is
  banked.
- Save the current bank before switching and restore it before returning.  If
  the game has no readable bank shadow, either hook only from bank 0 and restore
  bank 0, or add a tiny bank-shadow write to the game's bank-switch helper.
- MBC1: `0x4000` selects RAM bank in mode 1 and high ROM bits in mode 0; clear
  the high bits before selecting the log bank.
- MBC3: `0x6000` is the RTC latch; do not disturb a pending latch.
- MBC5: `0x4000-0x5FFF` is the RAM bank; flash data writes must use
  `0x6000-0x7FFF`.

### Log placement

- Prefer a blank 64 KiB sector inside the image; reflashing then resets the
  save deterministically.
- Otherwise append the image to the next 64 KiB boundary and use the new
  sector; update `0x148` and both checksums.
- Never erase a sector that contains code or data.

## 7. Build the patch recipe

Record every edit in `games/<slug>/recipe.json` (format:
`docs/PATCH_RECIPE.md`):

```powershell
python patcher/rom_patch.py check games\<slug>\recipe.json
python patcher/rom_patch.py apply games\<slug>\recipe.json
```

The recipe must include the source SHA-1, the output name, all byte edits, and
the blob paths.  `rom_patch.py` writes a `.report.json` next to the output with
the exact before/after bytes.

## 8. Emulator validation

Before hardware, verify in serverboy and Gearboy:

- [ ] patched ROM boots to the title/menu;
- [ ] a fresh save shows up in the game's own menu;
- [ ] save, reset, and load inside the emulator works (using the reader path:
      seed the flash log or use the patched save routine);
- [ ] delete works and does not resurrect an old save;
- [ ] the game still plays through the area that triggers the save;
- [ ] no new crashes or visual glitches.

Remember: emulators drop ROM writes.  To test the reader path, seed records into
a copy of the patched image at the flash log's file offset, then boot.

## 9. Hardware validation

On the HC007 cart:

1. flash the patched image;
2. create a save, power off, wait, power on, load it;
3. delete the save, power off, power on, confirm it stays deleted;
4. play far enough to trigger a second save and confirm the log advances;
5. reflash the image and confirm the save resets (blank log sector).

Record the result in `docs/COMPATIBILITY.md` and in the case's `notes.md`.

## 10. Handoff checklist

A case is ready for the next session when:

- [ ] `case.json` has title, SHA-1, mapper, sizes, strategy and status;
- [ ] `analysis/` has inventory, disassembly listings and traces;
- [ ] `notes.md` explains the save format with addresses and evidence;
- [ ] `recipe.json` contains the exact edits and blob paths;
- [ ] `tests/` contains any case-specific reader/emulator checks;
- [ ] open questions and risks are listed at the bottom of `notes.md`.
