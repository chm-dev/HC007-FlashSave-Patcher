#!/usr/bin/env python3
"""Seed a Super Mario Land 2 flash-log record into a patched ROM.

The SML2 HC007 patch keeps a 0xF0-byte save region (three 0x50-byte slots at
SRAM 0xA000) in an append-only log at chip 0x82000.  This tool writes one
record for reader-path emulator tests.

Record (0xF6 bytes):
    0x00 'M'   0x01 'L'   0x02 0xF0
    0x03..0xF2  payload (SRAM 0xA000..0xA0EF)
    0xF3        checksum = sum(bytes 0x00..0xF2) & 0xFF
    0xF4        0x5A commit
    0xF5        0x00 pad

Usage:
    python games/sml2/tools/seed-log.py patched.gb crafted.sav --index 0
    python games/sml2/tools/seed-log.py patched.gb crafted.sav --index 1 --out seeded.gb
"""
from __future__ import annotations

import argparse
from pathlib import Path

REC_SIZE = 0xF6
PAYLOAD_SIZE = 0xF0
LOG_BANK = 0x20
LOG_CPU = 0x6000


def log_offset(index: int) -> int:
    return LOG_BANK * 0x4000 + (LOG_CPU - 0x4000) + index * REC_SIZE


def fix_global_checksum(data: bytearray) -> None:
    total = 0
    for index, value in enumerate(data):
        if index in (0x14E, 0x14F):
            continue
        total = (total + value) & 0xFFFF
    data[0x14E] = (total >> 8) & 0xFF
    data[0x14F] = total & 0xFF


def make_record(payload: bytes) -> bytes:
    if len(payload) != PAYLOAD_SIZE:
        raise ValueError(f"payload must be {PAYLOAD_SIZE} bytes")
    record = bytearray(REC_SIZE)
    record[0] = 0x4D  # 'M'
    record[1] = 0x4C  # 'L'
    record[2] = PAYLOAD_SIZE
    record[3:3 + PAYLOAD_SIZE] = payload
    record[0xF3] = sum(record[0:0xF3]) & 0xFF
    record[0xF4] = 0x5A
    record[0xF5] = 0x00
    return bytes(record)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("sav", type=Path,
                        help="8 KiB SRAM image; 0xA000..0xA0EF is used")
    parser.add_argument("--index", type=int, default=0,
                        help="record index (0-based; stride 0xF6)")
    parser.add_argument("--out", type=Path,
                        help="output ROM (default: rewrite the input)")
    args = parser.parse_args()

    sram = args.sav.read_bytes()
    if len(sram) < 0x100:
        raise SystemExit(f"{args.sav} is too small")
    payload = sram[0x000:0x0F0]
    record = make_record(payload)

    data = bytearray(args.rom.read_bytes())
    offset = log_offset(args.index)
    if offset + REC_SIZE > len(data):
        raise SystemExit(f"record {args.index} does not fit in {args.rom}")
    before = bytes(data[offset:offset + REC_SIZE])
    data[offset:offset + REC_SIZE] = record
    fix_global_checksum(data)

    out = args.out or args.rom
    out.write_bytes(data)
    print(f"seeded record {args.index} at file 0x{offset:05X} "
          f"(was {before[:3].hex(' ')})")
    print(f"checksum 0x{record[0xF3]:02X}, wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
