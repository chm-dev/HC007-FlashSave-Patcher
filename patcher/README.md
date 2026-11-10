# Patcher

`hc007_patcher.py` is the start of the binary patcher. It currently **plans**
patches; it does not modify ROMs yet.

## Commands

```powershell
python patcher/hc007_patcher.py info path\to\game.gb
python patcher/hc007_patcher.py plan path\to\game.gb
python patcher/hc007_patcher.py plan path\to\game.gb --json
```

### `info`

Prints:

- title, file size, declared ROM size,
- cart type and mapper family,
- declared SRAM size vs the HC007's 32 KiB,
- CGB flag, battery/RTC/rumble,
- stored vs computed header and global checksums,
- free 64 KiB sectors,
- compatibility warnings.

### `plan`

Adds the proposed patch layout:

- log sector (chip offset),
- log bank and CPU window,
- mapper-specific bank-select register values,
- the remaining implementation stages.

## Current limitations

- It does not write a patched ROM yet.
- It does not inject the trampoline, journal or hook.
- It does not handle RTC, >32 KiB SRAM, 8 MiB ROMs or MBC2/HuC mappers.
- Free-sector detection only looks inside the existing image; if none is free it
  proposes padding to the next 64 KiB boundary.

## Implementation order

1. `--patch` output: pad/append the log sector and a spare code bank.
2. Boot trampoline at `0x100` (restore SRAM, jump to `0x150`).
3. Mapper-aware WRAM flash driver.
4. SRAM page journal (append, replay, compact).
5. VBlank save-detection hook.
6. Header/global checksum fix.
7. Compatibility DB overrides.

See `../docs/PATCHER_DESIGN.md` for the architecture and record formats.
