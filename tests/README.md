# Tests

The writer path (flash program/erase) can only be tested on the real HC007 cart.
The reader path (boot restore, journal replay) can be tested in emulators by
seeding records into a ROM copy.

## Available now

- `../tools/build_probe.ps1` - builds the three mapper probe ROMs.
- `../tools/build_testrom.ps1` - builds the controlled save test ROMs.
- `testrom_reader.mjs` - reader regression for the test ROM (blank, last-wins,
  tombstone, torn, corrupt checksum, SRAM path).
- `patched_plain_reader.mjs` - reader regression for the patched plain ROM
  (journal blob boot restore + SRAM path).
- `../tools/gb_harness.mjs` - serverboy harness (`loadRom`, `readMem`,
  `holdKey`, `tapKey`, `savePng`).
- `../tools/gearboy_mcp_example.mjs` - Gearboy headless MCP example.
- `../docs/examples/checkpoint30.mjs` - Robbo reference for seeding records at
  a file offset and testing the reader path (Robbo symbols, adapt as needed).
- `fixtures/robbo-hc007.gb` + `.noi` - known-good 512 KiB MBC5 image with the
  flash save log (local reference; git-ignored).

## Suggested test layers

1. **Probe on hardware** (writer path) - **done (2026-11-10):**
   - MBC1/MBC3/MBC5 all report `PROG err=00 rd=5A` and `ERASE err=00 rd=FF`;
   - `SRAM4: FAIL` in all three modes (only bank 0 verified).
   - See `../docs/HARDWARE.md`.
2. **Reader unit test** (emulator):
   - `node tests/testrom_reader.mjs` (test ROM: blank, last-wins, tombstone,
     torn, corrupt checksum, SRAM path);
   - `node tests/patched_plain_reader.mjs` (patched plain ROM: blob boot
     restore + SRAM path);
   - or seed a journal at file offset `bank * 0x4000 + (cpu - 0x4000)` and boot
     a patched ROM.
3. **Test ROM on hardware** (writer path) - **done (2026-11-10):**
   - `roms/testrom-mbc5.gb`; A saves, power-cycle restores, START clears;
   - repeat MBC1/MBC3. See `../testrom/README.md`.
4. **Patched plain ROM on hardware** - **first run failed (white screen):**
   - `roms/plain-mbc5-patched.gb` / MBC1 / MBC3 white-screened on GBC and DMG;
   - candidate fix: `j_boot` now sets `SP=0xE000` (WRAM stack); rebuilt;
   - retest: A saves, wait ~3 s, power-cycle, counter restored.
   - See `../docs/STATUS.md`.
5. **Patcher regression**:
   - `python ../patcher/hc007_patcher.py plan <rom>` on a small fixture set;
   - verify header/global checksums and the log sector choice.
6. **Hardware end-to-end**:
   - save, power-cycle, load, delete, power-cycle, reflash.

## Notes

- Emulators drop ROM writes, so a "save" made in an emulator never reaches the
  flash.
- Gearboy is the accuracy/visual oracle; serverboy is the fast functional
  harness.
- Keep test ROMs and screenshots out of version control (`roms/` is ignored).
