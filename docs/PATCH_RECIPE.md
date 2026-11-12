# Patch recipe format

A recipe is a JSON file in `games/<slug>/recipe.json`.  It records the source
ROM identity, the exact byte edits, the injected blobs and the output name.  The
investigation is reproducible from the recipe plus the blobs.

## Example

```json
{
  "name": "example-hc007",
  "source": {
    "path": "../../roms/example.gb",
    "sha1": "0000000000000000000000000000000000000000"
  },
  "output": "../../roms/example-hc007.gb",
  "base_rom_size": 524288,
  "append_banks": 32,
  "rom_size_code": 5,
  "cart_type": 27,
  "edits": [
    {"name": "entry trampoline", "offset": 256, "hex": "C3 00 40"},
    {"name": "save call site", "bank": 0, "addr": "0x2862", "hex": "CD 00 41"}
  ],
  "blobs": [
    {"name": "journal", "path": "../../build/journal.bin", "bank": 26, "offset": 0}
  ],
  "fix_checksums": true
}
```

Paths are relative to the recipe file.  That keeps a case folder self-contained
except for the ROM and built blobs (which are git-ignored).

## Fields

| Field | Meaning |
|---|---|
| `name` | Human-readable recipe name |
| `source.path` | Source ROM path |
| `source.sha1` | Required source identity; `--force` bypasses a mismatch |
| `rom` | Alternative to `source.path` |
| `output` | Output path; a `.report.json` is written next to it |
| `base_rom_size` | Truncate/pad reference size; defaults to the source size |
| `append_banks` | Append N blank 16 KiB banks before applying edits |
| `rom_size_code` | New header `0x148` value (if the image grows) |
| `ram_size_code` | New header `0x149` value |
| `cart_type` | New header `0x147` value (normally unchanged) |
| `fix_checksums` | Recompute header/global checksums (default `true`) |
| `edits` | List of byte replacements |
| `blobs` | List of binary blobs to inject at a bank/offset |

## Address forms

### File offset

```json
{"offset": 256, "hex": "C3 00 40"}
```

`offset` is a byte offset in the image (decimal or `0x...`).

### CPU address in a bank

```json
{"bank": 0, "addr": "0x2973", "hex": "C3 00 41"}
```

- bank 0 covers CPU `0x0000-0x3FFF`;
- bank N covers CPU `0x4000-0x7FFF`;
- file offset = `bank * 0x4000 + (addr - 0x4000)` for bank N > 0.

Use this form for hook patches; it survives small layout changes better than a
raw file offset.

## Blobs

```json
{"name": "journal", "path": "../../build/journal.bin", "bank": 32, "offset": 0}
```

`bank` and `offset` are **bank-relative**: the blob starts at file offset
`bank * 0x4000 + offset`.  A blob must fit in the image after `append_banks`.

## Commands

```powershell
# Verify paths, hashes and edit offsets without writing anything.
python patcher/rom_patch.py check games\mygame\recipe.json

# Show the planned changes without writing.
python patcher/rom_patch.py apply games\mygame\recipe.json --dry-run

# Apply and write the output + report.
python patcher/rom_patch.py apply games\mygame\recipe.json

# Compare the source and a patched image.
python patcher/rom_patch.py diff games\mygame\recipe.json --other patched.gb
```

## Rules

- Always include `source.sha1`.  A recipe that applies to the wrong ROM is a
  silent brick.
- Keep the original mapper byte unless you are deliberately converting it.
  The HC007 runs MBC1/MBC3/MBC5 headers.
- Do not place the flash log in a sector that contains code or data.
- Update `0x148` if `append_banks` changes the declared ROM size.
- Recompute both checksums after all edits.
- Store the recipe and notes in the case folder; the ROM and built blobs stay
  git-ignored.
