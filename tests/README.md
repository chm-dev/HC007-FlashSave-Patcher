# Tests

The reader path (boot restore, journal replay) can be tested in emulators by
seeding records into a ROM copy.  The writer path can be construction-tested
with a small NOR-flash model; real flash timing, SRAM disable/re-enable and bank
mapping still need the real HC007 cart.

## Available now

- `../tools/rom_inspect.py` - static inventory.
- `../tools/gbdis.py` - disassembler and SRAM-reference finder.
- `../tools/sram_trace.mjs` - dynamic SRAM/mapper trace.
- `../tools/sram_activity.mjs` - SRAM-as-work-RAM screen.
- `../tools/gb_harness.mjs` - serverboy harness.
- `../patcher/rom_patch.py` - apply/check a per-game recipe.
- `../patcher/rom_ips.py` - create/apply IPS patches; unit-tested in
  `test_toolchain.py`.
- `../tools/build_probe.ps1` - builds the three mapper probe ROMs.
- `../tools/build_testrom.ps1` - builds the controlled save test ROMs.
- `testrom_reader.mjs` - reader regression for the test ROM (blank, last-wins,
  tombstone, torn, corrupt checksum, SRAM path).
- `patched_plain_reader.mjs` - reader regression for the legacy patched plain
  ROM (journal blob boot restore + SRAM path).
- `../games/sml2/tools/test_save_emulator.mjs` - SML2 end-to-end save/delete
  test with a small NOR-flash model for the log window, including the natural
  flash-ID probe.
- `../games/sml2/tools/test_save_after_level.mjs` - SML2 save after a real
  level load; this is the old failure scenario (SRAM `0xAD00-0xB0DF` is game
  work RAM).
- `../games/sml2/tools/test_death_flash.mjs` - SML2 natural death/transition
  with the NOR-flash model; verifies the real save call site produces a valid
  record.
- `../games/sml2/tools/check_wram_restore.mjs` - checks the SML2 boot restore
  leaves the WRAM helper block at `0xC100-0xC3FF` in its original state.
- `../tools/gearboy_mcp_example.mjs` - Gearboy headless MCP example.
- `../docs/examples/checkpoint30.mjs` - Robbo reference for seeding records at
  a file offset and testing the reader path.
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
   - `node tests/patched_plain_reader.mjs` (legacy patched plain ROM: blob boot
     restore + SRAM path);
   - or seed a journal at file offset `bank * 0x4000 + (cpu - 0x4000)` and boot
     a patched ROM.
3. **Test ROM on hardware** (writer path) - **done (2026-11-10):**
   - `roms/testrom-mbc5.gb`; A saves, power-cycle restores, START clears;
   - repeat MBC1/MBC3. See `../testrom/README.md`.
4. **Legacy patched plain ROM on hardware** - **pass (stage 6, MBC5):**
   - `roms/plain-mbc5-patched.gb` saves, power-cycles and restores;
   - MBC1/MBC3 retest still open.
5. **Patcher regression**:
   - `python ../patcher/rom_patch.py check games/<slug>/recipe.json`;
   - `python ../patcher/rom_patch.py apply ... --dry-run`;
   - verify header/global checksums and the log sector choice;
   - `python ../patcher/rom_ips.py make --recipe games/<slug>/recipe.json
     --patch out.ips`; apply it back to the source and compare SHA-1 with the
     built image.
6. **Per-game end-to-end**:
   - synthetic save/delete/full-log test with a NOR-flash model;
   - a save after a real level load (the game has overwritten work RAM);
   - a natural save event (death/level complete/menu) with the flash model;
   - boot/reader test with a seeded log;
   - hardware save, power-cycle, load, delete, power-cycle, reflash;
   - a no-flash debug build to isolate the flash path.
   SML2 has concrete examples in `../games/sml2/tools/`.

## Notes

- Emulators drop ROM writes by default; a plain "save" never reaches the
  flash.  The NOR-flash model tests record construction, not timing.
- Gearboy is the accuracy/visual oracle; serverboy is the fast functional
  harness.
- Keep test ROMs and screenshots out of version control (`roms/` is ignored).
