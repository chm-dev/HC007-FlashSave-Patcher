#!/usr/bin/env python3
"""Build a valid Super Mario Land 2 SRAM image for reader-path testing.

The game has three 0x50-byte save slots at 0xA000, 0xA050 and 0xA0A0:

    0x00..0x3F  save data (copied from 0xA840)
    0x40        A262
    0x41        A263
    0x42        status/occupied (0 = empty, nonzero = used)
    0x43        A22C
    0x44        A28D
    0x45        checksum = sum(bytes 0x00..0x44) & 0xFF
    0x46..0x49  magic 12 34 56 78

Usage:
    python games/sml2/tools/make-save.py out.sav --slot 0
    python games/sml2/tools/make-save.py out.sav --slot 0 --status 1 --world 1
"""
from __future__ import annotations

import argparse
from pathlib import Path

SRAM_SIZE = 0x2000
SLOT_STRIDE = 0x50
SLOT_COUNT = 3
MAGIC = bytes([0x12, 0x34, 0x56, 0x78])


def empty_slot(sram: bytearray, slot: int) -> None:
    base = slot * SLOT_STRIDE
    sram[base:base + 0x50] = b"\x00" * 0x50
    # The game's own empty-slot pattern: invalid checksum (0x02) + magic.
    sram[base + 0x40:base + 0x4A] = bytes(
        [0x00, 0x00, 0x00, 0x05, 0x00, 0x02, 0x12, 0x34, 0x56, 0x78])


def make_slot(sram: bytearray, slot: int, status: int, world: int,
              level: int, lives: int, coins: int) -> int:
    base = slot * SLOT_STRIDE
    data = bytearray(0x40)
    # These fields are a guess for the first bytes; the status byte is what
    # the file-select screen uses to mark a slot as occupied.  Adjust after a
    # real save trace.
    data[0] = world & 0xFF
    data[1] = level & 0xFF
    data[2] = 0
    data[3] = 0
    sram[base:base + 0x40] = data
    sram[base + 0x40] = 0x00
    sram[base + 0x41] = 0x00
    sram[base + 0x42] = status & 0xFF
    sram[base + 0x43] = lives & 0xFF
    sram[base + 0x44] = coins & 0xFF
    checksum = sum(sram[base:base + 0x45]) & 0xFF
    sram[base + 0x45] = checksum
    sram[base + 0x46:base + 0x4A] = MAGIC
    return checksum


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--slot", type=int, default=0, choices=range(SLOT_COUNT))
    parser.add_argument("--status", type=lambda s: int(s, 0), default=1,
                        help="status byte at slot+0x42 (0 = empty, nonzero = used)")
    parser.add_argument("--world", type=int, default=1)
    parser.add_argument("--level", type=int, default=1)
    parser.add_argument("--lives", type=int, default=5)
    parser.add_argument("--coins", type=int, default=0)
    parser.add_argument("--all-empty", action="store_true",
                        help="ignore --slot and leave all slots empty")
    args = parser.parse_args()

    sram = bytearray(SRAM_SIZE)
    for slot in range(SLOT_COUNT):
        empty_slot(sram, slot)
    if not args.all_empty:
        checksum = make_slot(sram, args.slot, args.status, args.world,
                             args.level, args.lives, args.coins)
        print(f"slot {args.slot}: status=0x{args.status:02X} "
              f"checksum=0x{checksum:02X}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(sram)
    print(f"wrote {args.output} ({len(sram)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
