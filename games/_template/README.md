# <Game title>

## Status

- Stage: screening / investigating / patching / emulator-ready / hardware-pass
- Build: `roms/<slug>-hc007.gb` (SHA-1 `<sha1>`)
- IPS: `games/<slug>/ips/<slug>-hc007.ips` (once available)
- Hardware: not tested / pass / fail

## First test to run

```powershell
python games/<slug>/tools/<build-script>.py
python patcher/rom_patch.py check games/<slug>/recipe.json
python patcher/rom_patch.py apply games/<slug>/recipe.json
node games/<slug>/tools/test_save_emulator.mjs
```

Replace `<build-script>` and the test name with the scripts you add.

## What is known

Link to `notes.md#...` for the save format, routines and evidence.

## Open questions

List the next experiments, highest priority first.

## Files

- `case.json` - identity, strategy, addresses, status.
- `notes.md` - full evidence and findings.
- `recipe.json` - exact patch edits and blobs.
- `src/` - patch source.
- `tools/` - build and test scripts.
- `ips/` - distributable patches and manifest.
- `analysis/` - inventory, traces, screenshots, crafted saves.
