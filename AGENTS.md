# Agent start here

This repo is a **per-game Game Boy save investigation and patching workbench**
for the HC007-BGA-V2 bootleg cart.  It is not a universal patcher.

## Read first

1. `docs/START_HERE.md` - project overview and new-game onboarding.
2. `docs/WORKFLOW.md` - the per-game investigation and patch procedure.
3. `games/README.md` - case-folder layout and rules.
4. `docs/PATCHER_DESIGN.md` - patch architecture and hard-won lessons.
5. `docs/TOOLCHAIN.md` - every tool and option.
6. `docs/TESTING.md` - emulator, flash-model and hardware test layers.
7. `docs/PATCH_RECIPE.md` - JSON recipe format.
8. `docs/COMPATIBILITY.md` - per-game status matrix.

## Current state

- SML2 is **hardware-pass**.  Case folder: `games/sml2/`; entry point:
  `games/sml2/README.md`; evidence: `games/sml2/notes.md`.
- IPS patches live in `games/sml2/ips/` with `README.md` and `manifest.json`.
- **Donkey Kong** (games/dk/) is **hardware-pass** (build 6 retains saves on a known-good cart; an earlier cart was faulty): oms/dk-hc007.gb +oms/dk-hc007-noflash.gb, IPS in games/dk/ips/, test plan in games/dk/README.md.

## Starting the next game

1. `Copy-Item -Recurse games/_template games/<slug>`.
2. Fill `games/<slug>/case.json` and `README.md`.
3. Follow `docs/WORKFLOW.md`.  Trace SRAM **and** WRAM over a real level load.
4. Keep patch code in an appended ROM bank; copy only a small flash/bank helper
   to WRAM on demand.  Restore the caller's bank from fixed bank 0.
5. Test synthetic save/delete, a save after a real level load, and a natural
   save event with a NOR-flash model.
6. Hardware-test the normal build; keep a no-flash debug build for isolation.
7. Generate and verify an IPS with `patcher/rom_ips.py`.

## Guardrails

- ROMs and built blobs are git-ignored; do not commit them.
- Never erase a flash sector that contains code or data.
- Do not store patch code or persistent flags in game SRAM/WRAM without proof
  they are unused in every mode.
- Never put `EI`/`RET` after a bank switch inside switchable-bank code.
- Emulators drop ROM writes by default.  The NOR-flash model tests record
  construction, not real timing.
- Keep game-specific findings in `games/<slug>/`; put reusable lessons in
  `docs/`.
- Verify an IPS by applying it to the original ROM and matching the built
  image's SHA-1.

## Common commands

```powershell
python tools/rom_inspect.py roms/<game>.gb
python tools/gbdis.py roms/<game>.gb --sram-refs
node tools/sram_trace.mjs roms/<game>.gb --script-file games/<slug>/trace.json
node tools/wram_trace.mjs roms/<game>.gb --script-file games/<slug>/trace.json

python patcher/rom_patch.py check games/<slug>/recipe.json
python patcher/rom_patch.py apply games/<slug>/recipe.json
python patcher/rom_ips.py make --recipe games/<slug>/recipe.json `
  --patch games/<slug>/ips/<slug>-hc007.ips
```

Reference implementation: `games/sml2/` and `games/sml2/tools/`.

Do not commit or push anything to this repository on your own unless asked directly for it.
