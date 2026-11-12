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
