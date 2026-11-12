#!/usr/bin/env python3
"""Apply a per-game binary patch recipe to a Game Boy ROM.

The recipe is JSON.  It is deliberately small and explicit: the investigation
tooling finds the hook points, then a human/agent records the exact edits here.

Example recipe:
{
  "name": "example",
  "source": {"sha1": "..."},
  "output": "example-hc007.gb",
  "base_rom_size": 524288,
  "append_banks": 1,
  "rom_size_code": 5,
  "edits": [
    {"name": "entry trampoline", "offset": 256, "hex": "C3 00 40"},
    {"name": "save return", "bank": 0, "addr": "0x2973", "hex": "C3 00 41"}
  ],
  "blobs": [
    {"name": "journal", "path": "build/journal.bin", "bank": 32, "offset": 0}
  ],
  "fix_checksums": true
}

Address forms:
  - "offset": file offset (decimal or 0x..)
  - "bank" + "addr": CPU address in a 16 KiB bank.  Bank 0 covers
    0x0000-0x3FFF; bank N covers 0x4000-0x7FFF.

Commands:
  python patcher/rom_patch.py apply recipe.json [--dry-run] [--force]
  python patcher/rom_patch.py check recipe.json
  python patcher/rom_patch.py diff recipe.json --other patched.gb
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path


def parse_int(value) -> int:
    if isinstance(value, int):
        return value
    return int(str(value), 0)


def header_checksum(data: bytes) -> int:
    total = 0
    for value in data[0x134:0x14D]:
        total = (total - value - 1) & 0xFF
    return total


def global_checksum(data: bytes) -> int:
    total = 0
    for i, value in enumerate(data):
        if i in (0x14E, 0x14F):
            continue
        total = (total + value) & 0xFFFF
    return total


def fix_checksums(data: bytearray) -> None:
    data[0x14D] = header_checksum(data)
    total = global_checksum(data)
    data[0x14E] = (total >> 8) & 0xFF
    data[0x14F] = total & 0xFF


def cpu_to_offset(bank: int, addr: int) -> int:
    if bank == 0:
        if not 0x0000 <= addr < 0x4000:
            raise ValueError(f"bank 0 address 0x{addr:04X} is outside 0x0000-0x3FFF")
        return addr
    if not 0x4000 <= addr < 0x8000:
        raise ValueError(
            f"bank {bank} address 0x{addr:04X} is outside 0x4000-0x7FFF")
    return bank * 0x4000 + (addr - 0x4000)


def edit_offset(edit: dict) -> int:
    if "offset" in edit:
        return parse_int(edit["offset"])
    if "bank" in edit and "addr" in edit:
        return cpu_to_offset(parse_int(edit["bank"]), parse_int(edit["addr"]))
    raise ValueError(f"edit {edit.get('name', '?')} has no offset or bank/addr")


@dataclass
class Applied:
    name: str
    offset: int
    length: int
    before: bytes
    after: bytes


def apply_recipe(recipe_path: Path, dry_run: bool, force: bool) -> int:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    source_path = recipe.get("source", {}).get("path")
    if not source_path:
        source_path = recipe.get("rom")
    if not source_path:
        print("error: recipe needs source.path or rom", file=sys.stderr)
        return 2
    source_path = Path(source_path)
    if not source_path.is_absolute():
        source_path = recipe_path.parent / source_path
    data = bytearray(source_path.read_bytes())

    expected_sha1 = recipe.get("source", {}).get("sha1")
    if expected_sha1:
        actual = hashlib.sha1(data).hexdigest()
        if actual.lower() != expected_sha1.lower():
            print(f"error: source SHA-1 mismatch\n  expected {expected_sha1}\n"
                  f"  actual   {actual}", file=sys.stderr)
            if not force:
                return 2

    base_size = parse_int(recipe.get("base_rom_size", len(data)))
    if len(data) < base_size:
        print(f"error: source is {len(data)} bytes; recipe expects {base_size}",
              file=sys.stderr)
        return 2
    if len(data) > base_size:
        print(f"note: truncating source from {len(data)} to {base_size} bytes")
        del data[base_size:]

    append_banks = parse_int(recipe.get("append_banks", 0))
    if append_banks:
        target_size = len(data) + append_banks * 0x4000
        data.extend(b"\xFF" * (append_banks * 0x4000))
        print(f"append: {append_banks} bank(s) -> {target_size} bytes")

    applied: list[Applied] = []

    for blob in recipe.get("blobs", []):
        path = Path(blob["path"])
        if not path.is_absolute():
            path = recipe_path.parent / path
        payload = path.read_bytes()
        bank = parse_int(blob["bank"])
        offset = parse_int(blob.get("offset", 0))
        dest = bank * 0x4000 + offset
        if dest + len(payload) > len(data):
            print(f"error: blob {blob.get('name', '?')} does not fit "
                  f"(ends at 0x{dest + len(payload):X}, image 0x{len(data):X})",
                  file=sys.stderr)
            return 2
        before = bytes(data[dest:dest + len(payload)])
        data[dest:dest + len(payload)] = payload
        applied.append(Applied(blob.get("name", path.name), dest, len(payload),
                               before, payload))
        print(f"blob:   {blob.get('name', path.name)} -> 0x{dest:06X} "
              f"({len(payload)} bytes)")

    for edit in recipe.get("edits", []):
        payload = bytes.fromhex(edit["hex"].replace(" ", ""))
        dest = edit_offset(edit)
        if dest + len(payload) > len(data):
            print(f"error: edit {edit.get('name', '?')} at 0x{dest:X} "
                  f"overruns the image", file=sys.stderr)
            return 2
        before = bytes(data[dest:dest + len(payload)])
        data[dest:dest + len(payload)] = payload
        applied.append(Applied(edit.get("name", "edit"), dest, len(payload),
                               before, payload))
        print(f"edit:   {edit.get('name', 'edit'):28s} 0x{dest:06X}  "
              f"{before.hex(' ')} -> {payload.hex(' ')}")

    if recipe.get("rom_size_code") is not None:
        data[0x148] = parse_int(recipe["rom_size_code"])
    if recipe.get("ram_size_code") is not None:
        data[0x149] = parse_int(recipe["ram_size_code"])
    if recipe.get("cart_type") is not None:
        data[0x147] = parse_int(recipe["cart_type"])

    if recipe.get("fix_checksums", True):
        fix_checksums(data)

    if dry_run:
        print(f"dry run: {len(applied)} change(s); no file written")
        return 0

    output = Path(recipe["output"])
    if not output.is_absolute():
        output = recipe_path.parent / output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)

    print(f"\nwrote {output} ({len(data)} bytes, sha1 "
          f"{hashlib.sha1(data).hexdigest()})")
    print(f"header checksum 0x{data[0x14D]:02X}, global checksum "
          f"0x{data[0x14E]:02X}{data[0x14F]:02X}")

    report = {
        "recipe": str(recipe_path),
        "source": str(source_path),
        "output": str(output),
        "output_sha1": hashlib.sha1(data).hexdigest(),
        "output_crc32": f"{zlib.crc32(data) & 0xFFFFFFFF:08x}",
        "size": len(data),
        "changes": [
            {
                "name": item.name,
                "offset": item.offset,
                "length": item.length,
                "before": item.before.hex(" "),
                "after": item.after.hex(" "),
            }
            for item in applied
        ],
    }
    report_path = output.with_suffix(output.suffix + ".report.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"report {report_path}")
    return 0


def check_recipe(recipe_path: Path) -> int:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    ok = True
    source = recipe.get("source", {}).get("path") or recipe.get("rom")
    if source:
        path = Path(source)
        if not path.is_absolute():
            path = recipe_path.parent / path
        if not path.exists():
            print(f"missing source: {path}")
            ok = False
        else:
            data = path.read_bytes()
            print(f"source: {path} ({len(data)} bytes)")
            expected = recipe.get("source", {}).get("sha1")
            if expected:
                actual = hashlib.sha1(data).hexdigest()
                match = actual.lower() == expected.lower()
                print(f"  sha1: {actual} {'OK' if match else 'MISMATCH'}")
                ok = ok and match
    for blob in recipe.get("blobs", []):
        path = Path(blob["path"])
        if not path.is_absolute():
            path = recipe_path.parent / path
        if not path.exists():
            print(f"missing blob: {path}")
            ok = False
        else:
            print(f"blob: {path} ({path.stat().st_size} bytes)")
    for edit in recipe.get("edits", []):
        try:
            offset = edit_offset(edit)
        except ValueError as exc:
            print(f"bad edit: {exc}")
            ok = False
            continue
        print(f"edit: {edit.get('name', '?'):28s} 0x{offset:06X} "
              f"{bytes.fromhex(edit['hex'].replace(' ', '')).hex(' ')}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


def diff_recipe(recipe_path: Path, other_path: Path) -> int:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    source = Path(recipe.get("source", {}).get("path") or recipe.get("rom"))
    if not source.is_absolute():
        source = recipe_path.parent / source
    a = source.read_bytes()
    b = other_path.read_bytes()
    limit = min(len(a), len(b))
    changes = 0
    for index in range(limit):
        if a[index] != b[index]:
            if changes < 40:
                print(f"0x{index:06X}: {a[index]:02X} -> {b[index]:02X}")
            changes += 1
    if len(a) != len(b):
        print(f"size: {len(a)} -> {len(b)}")
    print(f"{changes} differing byte(s)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("apply", "check", "diff"))
    parser.add_argument("recipe", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true",
                        help="apply even if the source SHA-1 does not match")
    parser.add_argument("--other", type=Path, help="other ROM for diff")
    args = parser.parse_args(argv)
    try:
        if args.command == "apply":
            return apply_recipe(args.recipe, args.dry_run, args.force)
        if args.command == "check":
            return check_recipe(args.recipe)
        if args.other is None:
            parser.error("diff needs --other")
        return diff_recipe(args.recipe, args.other)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
