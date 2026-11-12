# Game cases

Each folder is one game.  The folder is the handoff package: a new session
should be able to read `case.json`, `notes.md` and `analysis/` and continue
without redoing the investigation.

## Layout

```
games/<slug>/
  README.md          # case entry point: status, outputs, first test to run
  case.json          # identity, strategy, status, key addresses
  notes.md           # findings, evidence and open questions
  HANDOFF.md         # optional short session handoff
  trace.json         # replayable sram_trace script that reaches a save
  recipe.json        # exact patch edits (once the hooks are known)
  recipe-*.json      # optional debug/special variants (e.g. no-flash)
  src/               # patch assembly/source files
  tools/             # case-specific build and test scripts
  tests/             # case-specific emulator checks (optional)
  ips/               # distributable IPS patches, manifest and README
  analysis/          # inventory, listings, traces, screenshots, crafted saves
  build/             # generated blobs (git-ignored)
```

## Rules

- Never commit a ROM.  Keep it in `roms/` and reference it in `case.json`.
- Record evidence, not guesses.  A save format claim needs a trace or a crafted
  save that the game accepted.
- Update `status`: `screening`, `investigating`, `patching`, `emulator-ready`,
  `hardware-smoke`, `hardware-pass`, `quirk`, `unsupported`.
- Keep the recipe runnable: `python patcher/rom_patch.py check recipe.json`.
- Keep the IPS patch reproducible and verified: apply it to the original ROM
  and compare the SHA-1 with the built image.
- Put open questions at the bottom of `notes.md` so the next session knows where
  to start.
- Do not put game-specific findings only in `docs/`; keep them in the case
  folder and link from the case README.

## Copy the template

```powershell
Copy-Item -Recurse games/_template games/<slug>
```

Then edit `case.json` and `notes.md`.
