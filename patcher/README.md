# Patcher

Two generations live here.

## Current: `rom_patch.py`

Generic per-game patch-recipe applier.  This is the tool the workflow uses.

```powershell
python patcher/rom_patch.py check games\sml2\recipe.json
python patcher/rom_patch.py apply games\sml2\recipe.json --dry-run
python patcher/rom_patch.py apply games\sml2\recipe.json
python patcher/rom_patch.py diff games\sml2\recipe.json --other patched.gb
```

It:

- verifies the source SHA-1;
- appends blank 16 KiB banks;
- injects binary blobs at a bank/offset;
- applies byte edits by file offset or CPU bank/address;
- updates `0x147/0x148/0x149` when the recipe asks;
- recomputes the header and global checksums;
- writes a `.report.json` beside the output with every before/after byte.

Recipe format: `../docs/PATCH_RECIPE.md`.

## Legacy: `hc007_patcher.py`

The original universal-prototype CLI.  It parses headers, plans a log sector,
and patches the controlled plain-ROM layout with the VBlank journal blob.

```powershell
python patcher/hc007_patcher.py info  path\to\game.gb
python patcher/hc007_patcher.py plan  path\to\game.gb
python patcher/hc007_patcher.py patch path\to\game.gb
```

It is still useful as:

- a header/inventory reference;
- a reference for the old blob injection, vector patching and checksum fixes;
- a test bed for the legacy VBlank journal.

It is **not** the default path for commercial games.  Use the per-game workflow
in `../docs/WORKFLOW.md`.

## `journal/`

The legacy injectable VBlank journal blob:

- boot trampoline at `0x100`;
- SRAM page restore from flash;
- mapper-aware WRAM flash driver;
- VBlank save-detection writer.

It proved the end-to-end hardware path.  Its limitations (bank 0, whole-SRAM
journal, VBlank budget) are why the project moved to per-game save hooks.
See `journal/README.md` for details and staged builds.
