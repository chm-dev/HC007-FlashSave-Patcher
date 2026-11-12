# SML2 IPS patches

Apply these patches to the **original, unpatched** Super Mario Land 2 ROM.
They produce a 1 MiB MBC5 image for the HC007 cart (or for an emulator).

## Source ROM

| Field | Value |
|---|---|
| File | `Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb` |
| Size | 524,288 bytes |
| SHA-1 | `bba408539ecbf8d322324956d859bc86e2a9977b` |
| CRC32 | `d5ec24e4` |

Do not apply a patch to an already-patched ROM.  Keep the original ROM and
the `.ips` file next to it.

## Targets

| Build | Target SHA-1 | Target size |
|---|---|---|
| Normal | `5a9378036073fb3f3b7dbff1c6dff6f56c166009` | 1,048,576 bytes |
| No-flash debug | `fa8557672acf8e5ae6408ddf05bfd797b1c071ae` | 1,048,576 bytes |

## Files

| File | Size | SHA-1 | Use |
|---|---:|---|---|
| `sml2-hc007.ips` | 524,654 | `4d2e11baff8b4508602fb9f9d3592c71a21902b7` | **Recommended.** Full 1 MiB result in any IPS patcher. |
| `sml2-hc007-min.ips` | 1,347 | `f3dc1b5ac2c38c2dca3ed4502a847ad37a09c882` | Small patch; requires 0xFF padding for the unused banks. |
| `sml2-hc007-noflash.ips` | 524,654 | `f270cd53b46ff14180a2574a74b9b41c19bec4ef` | No-flash debug build, full 1 MiB result. |
| `sml2-hc007-noflash-min.ips` | 1,347 | `2e35b0c429967dbad48ebe4919226f960621f0e9` | No-flash debug, small patch; requires 0xFF padding. |

The full patches explicitly write the 512 KiB of `0xFF` extension, so the
output is exactly the 1 MiB image.  The minimal patches omit erased padding;
most IPS tools fill new space with `0x00`, which would corrupt the log sector
and unused banks.  Apply a minimal patch with:

```powershell
python patcher/rom_ips.py apply games/sml2/ips/sml2-hc007-min.ips `
  "path/to/original.gb" patched.gb `
  --pad-to 0x100000 --pad-byte 0xFF
```

or use a flasher that fills unused banks with erased flash (`0xFF`).

## Verification

```powershell
# Inspect the records.
python patcher/rom_ips.py check games/sml2/ips/sml2-hc007.ips

# Apply and verify the normal build.
python patcher/rom_ips.py apply games/sml2/ips/sml2-hc007.ips `
  "path/to/original.gb" patched.gb `
  --expect-sha1 5a9378036073fb3f3b7dbff1c6dff6f56c166009

# Apply and verify the no-flash build.
python patcher/rom_ips.py apply games/sml2/ips/sml2-hc007-noflash.ips `
  "path/to/original.gb" noflash.gb `
  --expect-sha1 fa8557672acf8e5ae6408ddf05bfd797b1c071ae
```

The normal build passed on the HC007 cart: boot, life-loss save without a
reset, power-cycle/load and delete.  The no-flash build runs the same journal
path but never programs or erases the log; keep it for future regression
isolation.

## Regenerating

After changing the recipe or blobs, rebuild the target and regenerate the
patches:

```powershell
python games/sml2/tools/build_save.py
python patcher/rom_patch.py apply games/sml2/recipe.json
python patcher/rom_ips.py make --recipe games/sml2/recipe.json `
  --patch games/sml2/ips/sml2-hc007.ips
python patcher/rom_ips.py make --recipe games/sml2/recipe.json `
  --patch games/sml2/ips/sml2-hc007-min.ips --no-pad
python patcher/rom_patch.py apply games/sml2/recipe-noflash.json
python patcher/rom_ips.py make --recipe games/sml2/recipe-noflash.json `
  --patch games/sml2/ips/sml2-hc007-noflash.ips
python patcher/rom_ips.py make --recipe games/sml2/recipe-noflash.json `
  --patch games/sml2/ips/sml2-hc007-noflash-min.ips --no-pad
```

The `.ips` files contain only the changed bytes, the new patch code and the
`0xFF` padding.  They do not contain the original ROM image.
