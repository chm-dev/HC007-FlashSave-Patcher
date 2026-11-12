# Game cases

Each folder is one game.  The folder is the handoff package: a new session
should be able to read `case.json`, `notes.md` and `analysis/` and continue
without redoing the investigation.

## Layout

```
games/<slug>/
  case.json          # identity, strategy, status, key addresses
  notes.md           # findings, evidence and open questions
  trace.json         # replayable sram_trace script that reaches a save
  recipe.json        # exact patch edits (once the hooks are known)
  analysis/          # inventory, listings, traces, screenshots, crafted saves
  tools/             # case-specific helper scripts (optional)
  tests/             # case-specific emulator checks (optional)
```

## Rules

- Never commit a ROM.  Keep it in `roms/` and reference it in `case.json`.
- Record evidence, not guesses.  A save format claim needs a trace or a crafted
  save that the game accepted.
- Update `status`: `screening`, `investigating`, `patching`, `emulator-pass`,
  `hardware-pass`, `quirk`, `unsupported`.
- Keep the recipe runnable: `python patcher/rom_patch.py check recipe.json`.
- Put open questions at the bottom of `notes.md` so the next session knows where
  to start.

## Copy the template

```powershell
Copy-Item -Recurse games/_template games/<slug>
```

Then edit `case.json` and `notes.md`.
