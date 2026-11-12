# Toolchain reference

All tools are self-contained in this repository.  The Python tools use only the
standard library; the JavaScript tools use the copied serverboy emulator and
`tools/gb_harness.mjs`.

## `tools/rom_inspect.py`

Inventory a ROM before you touch it.

```powershell
python tools/rom_inspect.py game.gb
python tools/rom_inspect.py game.gb --json games\mygame\analysis\inventory.json
```

Output:

- SHA-1, SHA-256, CRC32, title;
- cart type, mapper family, declared ROM/RAM, CGB flag, battery/RTC/rumble;
- stored vs computed header/global checksums and Nintendo-logo check;
- entry target and the five interrupt vectors;
- blank 64 KiB sectors and blank 16 KiB banks;
- per-bank `0xFF`/`0x00` percentages and unique-byte count;
- the longest free `0xFF` runs in bank 0.

Warnings flag unsupported mappers, >8 KiB SRAM, RTC, bad checksums, no spare
sector and unusual entry code.

## `tools/gbdis.py`

Dependency-free LR35902 disassembler and SRAM-reference finder.

```powershell
# Bank-local range (bank 0 maps 0x0000-0x3FFF; bank N maps 0x4000-0x7FFF).
python tools/gbdis.py game.gb --bank 0 --range 0x100:0x180
python tools/gbdis.py game.gb --bank 3 --range 0x4000:0x4100

# Centre on an address (CPU address; bank 0 for addresses < 0x4000).
python tools/gbdis.py game.gb --bank 0 --around 0x2934 --before 48 --after 96

# Static SRAM hints across all banks.
python tools/gbdis.py game.gb --sram-refs --limit 100
python tools/gbdis.py game.gb --sram-refs --json analysis\sram-refs.json

# Annotate symbols from a GBDK .noi file.
python tools/gbdis.py game.gb --bank 0 --range 0x100:0x200 --noi roms\blob.noi
```

`--sram-refs` reports three classes:

- `direct`: `LD (0xAxxx),A` / `LD A,(0xAxxx)`;
- `pointer`: `LD HL,0xAxxx` / `LD BC,0xAxxx` / `LD DE,0xAxxx`;
- `indirect`: `LD (HL),A`, `LD A,(HL)`, `INC (HL)`, ALU `(HL)`, etc.

A linear sweep will disassemble data as code, so treat the list as hints and
confirm with a trace.

## `tools/sram_trace.mjs`

Trace SRAM and mapper-register accesses while the ROM runs.  This is the main
dynamic tool.

```powershell
node tools/sram_trace.mjs game.gb --frames 600
node tools/sram_trace.mjs game.gb --script "wait:200;tap:START:30;hold:RIGHT:600"
node tools/sram_trace.mjs game.gb --script-file games\mygame\trace.json
node tools/sram_trace.mjs game.gb --sram save.sav --dump-sram after.sav
node tools/sram_trace.mjs game.gb --json analysis\trace.json --all
```

Script steps:

| Step | Meaning |
|---|---|
| `wait:N` | run N frames |
| `tap:KEY:N` | hold KEY for 2 frames, then run N frames |
| `hold:KEY[,KEY]:N` | hold keys for N frames |
| `mark:NAME` | record the current frame in the report |
| `shot:PATH` | save a PNG screenshot |

The report contains:

- total SRAM reads/writes and mapper writes;
- per-page read/write counts for the 8 KiB bank 0;
- top `(pc, rom bank, sram bank)` write tuples with address range, frame range
  and sample values;
- the same for reads;
- mapper-register writes with PC, value and count.

**Important:** the trace reports the ROM bank of the code that performed the
access.  If `PC < 0x4000`, the code is in bank 0 regardless of the current
mapper register.  The tool computes this correctly.

## `tools/wram_trace.mjs`

Trace WRAM (`0xC000-0xDFFF`) writes while a ROM runs.  Use it to find a safe
scratch area for an injected routine and to see which block a level load
overwrites.  A robust pattern is an appended-ROM journal plus a small helper
copied to WRAM on demand, with the game's block backed up/restored (see the
SML2 case).  Serverboy reads WRAM directly, so only writes are traced reliably.

```powershell
node tools/wram_trace.mjs game.gb --frames 600
node tools/wram_trace.mjs game.gb --script-file games\<slug>\trace.json `
  --json games\<slug>\analysis\trace-wram.json
```

It prints per-256-byte-page write counts and the hottest `(PC, address)`
pairs.  Pages with only the boot clear and no later writes are candidates.

## `tools/joypad_trace.mjs`

Trace reads and writes of `0xFF00` and record the PCs that access it.  This
finds a game's input/menu handler when `sram_trace` is too noisy.

```powershell
node tools/joypad_trace.mjs game.gb `
  --script "wait:200;tap:START:30;tap:RIGHT:30" `
  --json games\<slug>\analysis\trace-joypad-menu.json
```

The hot PCs point at the input/menu handler; confirm with a disassembly.  The
SML2 case has a worked example in `games/sml2/notes.md`.

## `tools/trace_report.py`

Turn a trace into code context.  It reads the top access PCs from
`sram_trace.mjs`, recovers the instruction that actually caused the access
(serverboy's PC is after the opcode/operands), and disassembles around it.

```powershell
python tools/trace_report.py game.gb analysis\trace-play.json --top 16 --type writes
python tools/trace_report.py game.gb analysis\trace-play.json --top 12 --type reads --out analysis\trace-reads.asm
```

The `>>` marker is the instruction that performed the SRAM access.

## `tools/sram_activity.mjs`

Quick screening tool: boots a ROM, mashes START/A/RIGHT, and reports:

- SRAM pages in use;
- pages that change often;
- whether the stack pointer is inside SRAM;
- a verdict: "polling-based journaling should work" or "poor candidate".

Use it before committing to a whole-SRAM journal.

## `tools/gb_harness.mjs`

Deterministic serverboy harness.  Exports `loadRom`, `run`, `readMem`,
`holdKey`, `tapKey`, `savePng` and a small CLI.

```powershell
node tools/gb_harness.mjs --rom game.gb --title --frames 120 --out title.png
node tools/gb_harness.mjs --rom game.gb --frames 600 --keys START --hold 4
node tools/gb_harness.mjs --rom game.gb --dump C000:64
```

`loadRom(path, saveData, { skipTitle: true, cgb: true })` loads an SRAM image
and can skip the harness's generic title logic.

## `patcher/rom_patch.py`

Apply a JSON patch recipe.  See `docs/PATCH_RECIPE.md`.

```powershell
python patcher/rom_patch.py check games\mygame\recipe.json
python patcher/rom_patch.py apply games\mygame\recipe.json --dry-run
python patcher/rom_patch.py apply games\mygame\recipe.json
python patcher/rom_patch.py diff games\mygame\recipe.json --other patched.gb
```

It verifies the source SHA-1, appends banks, injects blobs, applies byte edits,
fixes both checksums and writes a `.report.json` with before/after bytes.

## `patcher/rom_ips.py`

Create or apply a standard IPS patch for distribution.  The patcher can use
`--recipe` to read `source.path` and `output` from a case recipe.

```powershell
python patcher/rom_ips.py make --recipe games\<slug>\recipe.json --patch games\<slug>\ips\<slug>-hc007.ips
python patcher/rom_ips.py check games\<slug>\ips\<slug>-hc007.ips
python patcher/rom_ips.py apply games\<slug>\ips\<slug>-hc007.ips original.gb rebuilt.gb `
  --expect-sha1 <output-sha1>
```

The default patch writes the full 0xFF extension, so an IPS tool produces the
exact 1 MiB image.  `--no-pad` makes a small patch; apply it with
`--pad-to 0x100000 --pad-byte 0xFF` (or let the flasher fill unused banks with
erased flash).  Standard IPS supports offsets up to 16 MiB; the HC007 maximum
is 8 MiB, so IPS32 is not needed.

## SML2 case tools (reference example)

These are in `games/sml2/tools/` and are the reference for a complete case.
Copy the pattern into `games/<slug>/tools/` for a new game; the scripts are
case-specific, not generic.

### `build_save.py`

Assembles `games/sml2/src/sml2_save.asm` with the GBDK tools, parses the Intel
HEX output and writes the injectable blobs to `games/sml2/build/`:

- `hooks.bin` - bank 0 save/clear hooks at `0x1967`;
- `boothook.bin` - bank 0 boot hook at `0x1AFF`;
- `boot.bin` - bank `0x24` boot code at `0x4000`;
- `clear.bin` - the relocated file-select CLEAR body at bank `0x24` `0x4500`;
- `journal.bin` - save/boot-restore/scan code at bank `0x24` `0x4800`;
- `wram.bin` - WRAM helper source at bank `0x24` `0x4C00`, copied to WRAM
  `0xC100` on demand.

It also asserts that the hook blobs fit their bank-0 caves and that the
journal and WRAM helper do not overlap.

```powershell
python games/sml2/tools/build_save.py
```

### `seed-log.py`

Write a valid 0xF6-byte log record into a patched ROM at the log file offset
`0x82000`, for reader-path emulator tests.

```powershell
python games/sml2/tools/seed-log.py roms/sml2-hc007.gb crafted.sav --index 0
python games/sml2/tools/seed-log.py roms/sml2-hc007.gb empty.sav --index 1
```

The later record wins at boot, so record 0 = save and record 1 = empty is a
delete-persistence test.

### `test_save_emulator.mjs`

End-to-end test of the SML2 save path.  It installs a small NOR-flash model for
the log window (serverboy drops real ROM writes), calls the patched save hook
with a synthetic save, and checks:

- record magic, length, checksum and commit byte;
- duplicate saves do not append;
- changed saves append at `0xF6`;
- a full log erases and restarts at 0;
- the boot restore reproduces the record payload;
- the CLEAR routine appends a delete record and the delete survives a boot.

```powershell
node games/sml2/tools/test_save_emulator.mjs [roms/sml2-hc007.gb]
```

### `test_save_after_level.mjs`

Regression for the old SML2 failure: it enters a real level, lets the game
overwrite SRAM `0xAD00-0xB0DF`, then calls the save hook.  It checks a valid
record, the game WRAM restore, and the boot restore.

```powershell
node games/sml2/tools/test_save_after_level.mjs [roms/sml2-hc007.gb]
```

### `test_death_flash.mjs`

Follows the natural title -> file select -> level -> death/transition route
with a NOR-flash model and verifies that the game's own save call writes a
valid record.

```powershell
node games/sml2/tools/test_death_flash.mjs [roms/sml2-hc007.gb]
```

### `check_wram_restore.mjs`

Boots the patched ROM to file select and checks that the boot restore leaves
the WRAM helper block (`0xC100-0xC3FF`) in its original state.

### `death_probe.mjs`

Drives the route to a level/death and prints state/PC transitions.  Useful for
finding the natural save event and choosing a trace route.

## `patcher/hc007_patcher.py` (legacy)

The original universal prototype.  Useful as a header parser and as a reference
for the old blob injection, but not the default per-game path.

```powershell
python patcher/hc007_patcher.py info game.gb
python patcher/hc007_patcher.py plan game.gb
python patcher/hc007_patcher.py patch game.gb
```

## Hardware tools

- `probe/mapperprobe.c` and `probe/flashprobe.c` - verify flash ID,
  program/erase and mapper mode on the real cart.
- `testrom/` - controlled SRAM + flash journal test ROM; use it to re-verify the
  cart after any hardware change.
- `tools/build_probe.ps1`, `tools/build_testrom.ps1`, `tools/build_plain.ps1` -
  GBDK builds for the above.
- `patcher/journal/` - the legacy injectable journal blob.

## Gearboy

The accuracy/visual oracle.  GUI:

```powershell
tools\gearboy\Gearboy.exe roms\game.gb
```

Headless MCP:

```powershell
tools\gearboy\Gearboy.exe --headless --mcp-stdio --portable roms\game.gb
node tools\gearboy_mcp_example.mjs roms\game.gb
```

Use Gearboy when serverboy's timing or rendering is suspect.  The MCP example
shows `get_media_info`, `debug_step_frame`, `controller_button`, `read_memory`,
`write_memory`, `get_screenshot`, `get_cpu_status` and save states.
