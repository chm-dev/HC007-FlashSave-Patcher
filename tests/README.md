# Tests

The writer path (flash program/erase) can only be tested on the real HC007 cart.
The reader path (boot restore, journal replay) can be tested in emulators by
seeding records into a ROM copy.

## Available now

- `../tools/build_probe.ps1` - builds the three mapper probe ROMs.
- `../tools/gb_harness.mjs` - serverboy harness (`loadRom`, `readMem`,
  `holdKey`, `tapKey`, `savePng`).
- `../tools/gearboy_mcp_example.mjs` - Gearboy headless MCP example.
- `../docs/examples/checkpoint30.mjs` - Robbo reference for seeding records at
  a file offset and testing the reader path (Robbo symbols, adapt as needed).
- `fixtures/robbo-hc007.gb` + `.noi` - known-good 512 KiB MBC5 image with the
  flash save log (local reference; git-ignored).

## Suggested test layers

1. **Probe on hardware** (writer path):
   - flash `roms/mapperprobe-mbc1.gb`, `-mbc3.gb`, `-mbc5.gb`;
   - press A (program) / B (erase);
   - record `PROG`/`ERASE`/`ID`/`SRAM4` lines.
2. **Reader unit test** (emulator):
   - seed a valid journal at file offset `bank * 0x4000 + (cpu - 0x4000)`;
   - boot the patched ROM;
   - check the game sees the restored save.
3. **Patcher regression**:
   - `python ../patcher/hc007_patcher.py plan <rom>` on a small fixture set;
   - verify header/global checksums and the log sector choice.
4. **Hardware end-to-end**:
   - save, power-cycle, load, delete, power-cycle, reflash.

## Notes

- Emulators drop ROM writes, so a "save" made in an emulator never reaches the
  flash.
- Gearboy is the accuracy/visual oracle; serverboy is the fast functional
  harness.
- Keep test ROMs and screenshots out of version control (`roms/` is ignored).
