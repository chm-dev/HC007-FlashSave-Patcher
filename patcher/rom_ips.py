#!/usr/bin/env python3
"""Create and apply IPS patches for the HC007 per-game ROMs.

IPS is the simple format understood by Lunar IPS, Floating IPS, flashers and
most emulators.  A record is a 3-byte big-endian offset, a 2-byte big-endian
length and the replacement bytes.  The patch ends with ``EOF``.

The SML2 patch grows the original 512 KiB ROM to 1 MiB.  By default ``make``
writes the complete extension as 0xFF, so the patched file is exactly the
1 MiB build regardless of how the IPS tool fills new space.  Use ``--no-pad``
for a small patch; then apply it with ``--pad-to 0x100000 --pad-byte 0xFF``
(or let your flasher pad the image) so the unused banks are erased flash.

Usage:
    python patcher/rom_ips.py make original.gb patched.gb out.ips
    python patcher/rom_ips.py make --recipe games/sml2/recipe.json --patch out.ips
    python patcher/rom_ips.py check out.ips
    python patcher/rom_ips.py apply out.ips original.gb rebuilt.gb
    python patcher/rom_ips.py apply out.ips original.gb rebuilt.gb --pad-to 0x100000 --pad-byte 0xFF
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

IPS_HEADER = b"PATCH"
IPS_EOF = b"EOF"
IPS_EOF_OFFSET = 0x454F46
MAX_RECORD = 0xFFFF


def sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def changed_runs(source: bytes, target: bytes, no_pad: bool) -> list[tuple[int, bytes]]:
    """Return (offset, data) records that transform source into target."""
    if len(target) < len(source):
        raise SystemExit(
            f"target is {len(target)} bytes, smaller than source {len(source)}")
    changed = bytearray(len(target))
    common = min(len(source), len(target))
    for i in range(common):
        if source[i] != target[i]:
            changed[i] = 1
    # Bytes past the end of the source are new.  Include the 0xFF padding by
    # default so the output size is exact; --no-pad skips pure padding.
    for i in range(common, len(target)):
        if no_pad and target[i] == 0xFF:
            continue
        changed[i] = 1

    records: list[tuple[int, bytes]] = []
    i = 0
    while i < len(target):
        if not changed[i]:
            i += 1
            continue
        start = i
        while i < len(target) and changed[i] and i - start < MAX_RECORD:
            i += 1
        records.append((start, target[start:i]))
    return records


def build_ips(records: list[tuple[int, bytes]]) -> bytes:
    out = bytearray(IPS_HEADER)
    for offset, payload in records:
        if offset > 0xFFFFFF:
            raise SystemExit(
                f"offset 0x{offset:X} does not fit a standard IPS record")
        if offset == IPS_EOF_OFFSET:
            raise SystemExit(
                "record starts at the IPS EOF offset 0x454F46; split it")
        if not payload:
            continue
        out += offset.to_bytes(3, "big")
        out += len(payload).to_bytes(2, "big")
        out += payload
    out += IPS_EOF
    return bytes(out)


def parse_ips(data: bytes) -> tuple[str, list[tuple[int, bytes]]]:
    if data[:5] == b"PATCH":
        offset_size = 3
    elif data[:5] == b"IPS32":
        offset_size = 4
    else:
        raise SystemExit("not an IPS patch (missing PATCH/IPS32 header)")
    pos = 5
    records: list[tuple[int, bytes]] = []
    while pos < len(data):
        if data[pos:pos + 3] == IPS_EOF:
            return ("IPS32" if offset_size == 4 else "IPS", records)
        if pos + offset_size > len(data):
            raise SystemExit("truncated IPS offset")
        offset = int.from_bytes(data[pos:pos + offset_size], "big")
        pos += offset_size
        if offset_size == 3 and offset == IPS_EOF_OFFSET:
            # Standard IPS EOF marker is the 3-byte offset 0x454F46 followed
            # by "EOF"; accept both forms.
            if data[pos:pos + 3] == IPS_EOF:
                return ("IPS", records)
            raise SystemExit("record at the reserved IPS offset 0x454F46")
        if pos + 2 > len(data):
            raise SystemExit("truncated IPS length")
        length = int.from_bytes(data[pos:pos + 2], "big")
        pos += 2
        if length == 0:
            continue
        if pos + length > len(data):
            raise SystemExit("truncated IPS data")
        records.append((offset, data[pos:pos + length]))
        pos += length
    raise SystemExit("IPS patch has no EOF marker")


def apply_ips(rom: bytes, records: list[tuple[int, bytes]],
              pad_to: int | None, pad_byte: int) -> bytes:
    size = max([len(rom)] + [offset + len(payload) for offset, payload in records])
    if pad_to is not None:
        if pad_to < size:
            raise SystemExit(
                f"--pad-to 0x{pad_to:X} is smaller than the patched data "
                f"(0x{size:X})")
        size = pad_to
    out = bytearray(rom)
    if len(out) < size:
        out.extend(bytes([pad_byte]) * (size - len(out)))
    for offset, payload in records:
        out[offset:offset + len(payload)] = payload
    return bytes(out)


def recipe_paths(recipe_path: Path) -> tuple[Path, Path]:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    source = recipe.get("source", {}).get("path")
    output = recipe.get("output")
    if not source or not output:
        raise SystemExit(f"{recipe_path}: recipe needs source.path and output")
    source_path = Path(source)
    if not source_path.is_absolute():
        source_path = recipe_path.parent / source_path
    output_path = Path(output)
    if not output_path.is_absolute():
        output_path = recipe_path.parent / output_path
    return source_path.resolve(), output_path.resolve()


def cmd_make(args: argparse.Namespace) -> int:
    if args.recipe:
        source_path, target_path = recipe_paths(args.recipe)
    else:
        if not args.source or not args.target:
            raise SystemExit("make needs source and target, or --recipe")
        source_path = Path(args.source)
        target_path = Path(args.target)
    if not source_path.exists():
        raise SystemExit(f"source {source_path} does not exist")
    if not target_path.exists():
        raise SystemExit(
            f"target {target_path} does not exist; run rom_patch.py apply first")
    source = source_path.read_bytes()
    target = target_path.read_bytes()
    if args.recipe:
        recipe = json.loads(args.recipe.read_text(encoding="utf-8"))
        expected = recipe.get("source", {}).get("sha1")
        if expected and sha1(source).lower() != expected.lower():
            raise SystemExit(
                f"source SHA-1 mismatch: recipe expects {expected}, "
                f"got {sha1(source)}")
    records = changed_runs(source, target, args.no_pad)
    patch = build_ips(records)
    out = Path(args.patch)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(patch)
    print(f"source: {source_path} ({len(source)} bytes, sha1 {sha1(source)})")
    print(f"target: {target_path} ({len(target)} bytes, sha1 {sha1(target)})")
    print(f"patch:  {out} ({len(patch)} bytes, {len(records)} record(s))")
    if args.no_pad:
        print("note: --no-pad omits erased padding; apply with "
              "--pad-to 0x100000 --pad-byte 0xFF or let the flasher pad.")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    patch = Path(args.patch).read_bytes()
    kind, records = parse_ips(patch)
    total = sum(len(payload) for _, payload in records)
    print(f"patch: {args.patch} ({len(patch)} bytes, {kind})")
    print(f"records: {len(records)}, data bytes: {total}")
    if records:
        print(f"range: 0x{records[0][0]:X} .. "
              f"0x{records[-1][0] + len(records[-1][1]):X}")
    for offset, payload in records:
        print(f"  0x{offset:06X}  {len(payload):5d} bytes")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    patch = Path(args.patch).read_bytes()
    _, records = parse_ips(patch)
    source = Path(args.rom).read_bytes()
    out = apply_ips(source, records, args.pad_to, args.pad_byte & 0xFF)
    Path(args.output).write_bytes(out)
    print(f"applied {len(records)} record(s) to {args.rom}")
    print(f"wrote {args.output} ({len(out)} bytes, sha1 {sha1(out)})")
    if args.expect_sha1 and sha1(out).lower() != args.expect_sha1.lower():
        raise SystemExit(
            f"sha1 mismatch: expected {args.expect_sha1}, got {sha1(out)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    make = sub.add_parser("make", help="create an IPS patch")
    make.add_argument("source", nargs="?", type=Path)
    make.add_argument("target", nargs="?", type=Path)
    make.add_argument("--recipe", type=Path,
                      help="read source/output paths from a recipe")
    make.add_argument("--patch", required=True, type=Path,
                      help="output .ips file")
    make.add_argument("--no-pad", action="store_true",
                      help="omit erased extension bytes (small patch)")
    make.set_defaults(func=cmd_make)

    check = sub.add_parser("check", help="list IPS records")
    check.add_argument("patch", type=Path)
    check.set_defaults(func=cmd_check)

    apply = sub.add_parser("apply", help="apply an IPS patch")
    apply.add_argument("patch", type=Path)
    apply.add_argument("rom", type=Path)
    apply.add_argument("output", type=Path)
    apply.add_argument("--pad-to", type=lambda s: int(s, 0),
                       help="pad the output to this size (e.g. 0x100000)")
    apply.add_argument("--pad-byte", type=lambda s: int(s, 0), default=0,
                       help="byte used for new/padded space (default 0)")
    apply.add_argument("--expect-sha1",
                       help="fail unless the output has this SHA-1")
    apply.set_defaults(func=cmd_apply)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
