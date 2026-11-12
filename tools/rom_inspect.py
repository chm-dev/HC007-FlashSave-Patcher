#!/usr/bin/env python3
"""Inventory a Game Boy ROM before patching it.

Prints the header, hashes, mapper, checksums, bank usage and candidate free
space.  This is the first step of the per-game workflow in docs/WORKFLOW.md.

Usage:
    python tools/rom_inspect.py game.gb
    python tools/rom_inspect.py game.gb --json reports/game.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zlib
from dataclasses import asdict, dataclass, field
from pathlib import Path

CART_TYPES = {
    0x00: "ROM ONLY", 0x01: "MBC1", 0x02: "MBC1+RAM",
    0x03: "MBC1+RAM+BATTERY", 0x05: "MBC2", 0x06: "MBC2+BATTERY",
    0x08: "ROM+RAM", 0x09: "ROM+RAM+BATTERY", 0x0B: "MMM01",
    0x0C: "MMM01+RAM", 0x0D: "MMM01+RAM+BATTERY",
    0x0F: "MBC3+TIMER+BATTERY", 0x10: "MBC3+TIMER+RAM+BATTERY",
    0x11: "MBC3", 0x12: "MBC3+RAM", 0x13: "MBC3+RAM+BATTERY",
    0x19: "MBC5", 0x1A: "MBC5+RAM", 0x1B: "MBC5+RAM+BATTERY",
    0x1C: "MBC5+RUMBLE", 0x1D: "MBC5+RUMBLE+RAM",
    0x1E: "MBC5+RUMBLE+RAM+BATTERY", 0x20: "MBC6",
    0x22: "MBC7+SENSOR+RUMBLE+RAM+BATTERY", 0xFC: "POCKET CAMERA",
    0xFD: "BANDAI TAMA5", 0xFE: "HuC3", 0xFF: "HuC1+RAM+BATTERY",
}

ROM_SIZE_CODES = {
    0x00: 32 * 1024, 0x01: 64 * 1024, 0x02: 128 * 1024,
    0x03: 256 * 1024, 0x04: 512 * 1024, 0x05: 1024 * 1024,
    0x06: 2048 * 1024, 0x07: 4096 * 1024, 0x08: 8192 * 1024,
    0x52: 1152 * 1024, 0x53: 1280 * 1024, 0x54: 1536 * 1024,
}

RAM_SIZE_CODES = {
    0x00: 0, 0x01: 2 * 1024, 0x02: 8 * 1024, 0x03: 32 * 1024,
    0x04: 128 * 1024, 0x05: 64 * 1024,
}

BATTERY_TYPES = {0x03, 0x06, 0x09, 0x0D, 0x0F, 0x10, 0x13,
                 0x1B, 0x1E, 0x22, 0xFF}
RTC_TYPES = {0x0F, 0x10}
RUMBLE_TYPES = {0x1C, 0x1D, 0x1E}


def mapper_family(cart_type: int) -> str:
    if 0x01 <= cart_type <= 0x03:
        return "MBC1"
    if 0x05 <= cart_type <= 0x06:
        return "MBC2"
    if 0x0F <= cart_type <= 0x13:
        return "MBC3"
    if 0x19 <= cart_type <= 0x1E:
        return "MBC5"
    if cart_type in (0x08, 0x09):
        return "ROM+RAM"
    return "UNSUPPORTED"


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


def entry_target(data: bytes) -> int | None:
    op = data[0x100]
    if op == 0x18:
        rel = data[0x101]
        if rel >= 0x80:
            rel -= 0x100
        return 0x102 + rel
    if op == 0x00 and data[0x101] == 0xC3:
        return data[0x102] | (data[0x103] << 8)
    if op == 0xC3:
        return data[0x101] | (data[0x102] << 8)
    return None


def longest_runs(data: bytes, value: int, minimum: int) -> list[dict]:
    runs = []
    current = 0
    start = 0
    for index, byte in enumerate(data):
        if byte == value:
            if current == 0:
                start = index
            current += 1
        else:
            if current >= minimum:
                runs.append({"offset": start, "length": current})
            current = 0
    if current >= minimum:
        runs.append({"offset": start, "length": current})
    return sorted(runs, key=lambda item: item["length"], reverse=True)


def bank_stats(data: bytes) -> list[dict]:
    rows = []
    for bank in range((len(data) + 0x3FFF) // 0x4000):
        chunk = data[bank * 0x4000:(bank + 1) * 0x4000]
        if not chunk:
            continue
        ff = chunk.count(0xFF)
        zero = chunk.count(0x00)
        unique = len(set(chunk))
        rows.append({
            "bank": bank,
            "file_offset": bank * 0x4000,
            "size": len(chunk),
            "ff_bytes": ff,
            "ff_percent": round(100.0 * ff / len(chunk), 1),
            "zero_bytes": zero,
            "zero_percent": round(100.0 * zero / len(chunk), 1),
            "unique_bytes": unique,
        })
    return rows


def blank_sectors(data: bytes, sector_size: int = 0x10000) -> list[int]:
    sectors = []
    for base in range(0, len(data) - sector_size + 1, sector_size):
        chunk = data[base:base + sector_size]
        if chunk.count(0xFF) == len(chunk):
            sectors.append(base)
    return sectors


@dataclass
class Report:
    path: str
    file_size: int
    sha1: str
    sha256: str
    crc32: str
    title: str
    cart_type: int
    cart_type_name: str
    mapper: str
    rom_size_code: int
    declared_rom_size: int
    ram_size_code: int
    declared_ram_size: int
    cgb_flag: int
    battery: bool
    rtc: bool
    rumble: bool
    header_checksum_stored: int
    header_checksum_computed: int
    global_checksum_stored: int
    global_checksum_computed: int
    nintendo_logo_ok: bool
    entry_target: int | None
    vectors: dict[str, dict]
    banks: list[dict]
    blank_64k_sectors: list[int]
    free_16k_banks: list[int]
    bank0_free_runs: list[dict]
    warnings: list[str] = field(default_factory=list)


def inspect(path: Path) -> Report:
    data = path.read_bytes()
    if len(data) < 0x150:
        raise ValueError(f"{path} is too small to be a Game Boy ROM")
    cart_type = data[0x147]
    rom_code = data[0x148]
    ram_code = data[0x149]
    title = data[0x134:0x144].split(b"\x00", 1)[0].decode("ascii", "replace").strip()
    stored_header = data[0x14D]
    computed_header = header_checksum(data)
    stored_global = (data[0x14E] << 8) | data[0x14F]
    computed_global = global_checksum(data)
    logo = data[0x104:0x134]
    logo_expected = bytes.fromhex(
        "CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DD"
        "DDD999BBBB67636E0EECCCDDDC999FBBB9333E")
    vectors = {}
    for name, address in (("vblank", 0x40), ("stat", 0x48), ("timer", 0x50),
                          ("serial", 0x58), ("joypad", 0x60)):
        raw = data[address:address + 8]
        vectors[name] = {
            "address": address,
            "bytes": raw.hex(" "),
            "opcode": raw[0],
            "target": (raw[1] | (raw[2] << 8)) if raw[0] in (0xC3, 0xCD) else None,
        }

    report = Report(
        path=str(path),
        file_size=len(data),
        sha1=hashlib.sha1(data).hexdigest(),
        sha256=hashlib.sha256(data).hexdigest(),
        crc32=f"{zlib.crc32(data) & 0xFFFFFFFF:08x}",
        title=title,
        cart_type=cart_type,
        cart_type_name=CART_TYPES.get(cart_type, f"UNKNOWN 0x{cart_type:02X}"),
        mapper=mapper_family(cart_type),
        rom_size_code=rom_code,
        declared_rom_size=ROM_SIZE_CODES.get(rom_code, 0),
        ram_size_code=ram_code,
        declared_ram_size=RAM_SIZE_CODES.get(ram_code, 0),
        cgb_flag=data[0x143],
        battery=cart_type in BATTERY_TYPES,
        rtc=cart_type in RTC_TYPES,
        rumble=cart_type in RUMBLE_TYPES,
        header_checksum_stored=stored_header,
        header_checksum_computed=computed_header,
        global_checksum_stored=stored_global,
        global_checksum_computed=computed_global,
        nintendo_logo_ok=(logo == logo_expected),
        entry_target=entry_target(data),
        vectors=vectors,
        banks=bank_stats(data),
        blank_64k_sectors=blank_sectors(data),
        free_16k_banks=[row["bank"] for row in bank_stats(data)
                        if row["ff_percent"] == 100.0],
        bank0_free_runs=longest_runs(data[:0x4000], 0xFF, 8),
    )

    if report.mapper == "UNSUPPORTED":
        report.warnings.append("mapper family is not handled by the HC007")
    if report.mapper == "MBC2":
        report.warnings.append("MBC2 has internal nibble RAM; not emulated by HC007")
    if report.rtc:
        report.warnings.append("RTC game: clock persistence needs a per-game plan")
    if report.declared_ram_size > 8 * 1024:
        report.warnings.append(
            f"declares {report.declared_ram_size // 1024} KiB SRAM; "
            "only bank 0 (8 KiB) is verified on the HC007")
    if report.declared_ram_size == 0:
        report.warnings.append("no cartridge RAM declared: nothing to journal")
    if report.header_checksum_stored != report.header_checksum_computed:
        report.warnings.append(
            f"header checksum mismatch (stored 0x{report.header_checksum_stored:02X}, "
            f"computed 0x{report.header_checksum_computed:02X})")
    if report.global_checksum_stored != report.global_checksum_computed:
        report.warnings.append("global checksum mismatch (emulators ignore it)")
    if not report.nintendo_logo_ok:
        report.warnings.append("Nintendo logo is not the canonical pattern")
    if report.entry_target is None:
        report.warnings.append("entry at 0x100 is not a simple JR/JP")
    if not report.blank_64k_sectors:
        report.warnings.append("no blank 64 KiB sector inside the image")
    if report.file_size == 8 * 1024 * 1024:
        report.warnings.append("8 MiB image: no spare flash sector for the log")
    return report


def format_report(report: Report) -> str:
    lines = [
        f"ROM:            {report.path}",
        f"size:           {report.file_size} bytes "
        f"(declared {report.declared_rom_size})",
        f"sha1:           {report.sha1}",
        f"crc32:          {report.crc32}",
        f"title:          {report.title!r}",
        f"cart type:      0x{report.cart_type:02X}  {report.cart_type_name}",
        f"mapper:         {report.mapper}",
        f"RAM:            {report.declared_ram_size // 1024} KiB declared",
        f"CGB flag:       0x{report.cgb_flag:02X}",
        f"battery/RTC:    {'battery' if report.battery else 'no battery'}"
        f" / {'RTC' if report.rtc else 'no RTC'}"
        f" / {'rumble' if report.rumble else 'no rumble'}",
        f"header csum:    stored 0x{report.header_checksum_stored:02X}"
        f" / computed 0x{report.header_checksum_computed:02X}",
        f"global csum:    stored 0x{report.global_checksum_stored:04X}"
        f" / computed 0x{report.global_checksum_computed:04X}",
        f"logo:           {'ok' if report.nintendo_logo_ok else 'BAD'}",
        f"entry:          "
        + (f"0x{report.entry_target:04X}" if report.entry_target is not None
           else "not a simple JP/JR"),
        "",
        "vectors:",
    ]
    for name, vector in report.vectors.items():
        target = f" -> 0x{vector['target']:04X}" if vector["target"] else ""
        lines.append(f"  {name:7s} 0x{vector['address']:04X}: "
                     f"{vector['bytes']}{target}")
    lines += [
        "",
        f"blank 64 KiB sectors: "
        + (", ".join(f"0x{x:X}" for x in report.blank_64k_sectors) or "none"),
        f"blank 16 KiB banks:   "
        + (", ".join(f"0x{x:02X}" for x in report.free_16k_banks) or "none"),
        "",
        "bank  ff%  zeros  unique",
    ]
    for row in report.banks:
        lines.append(
            f"  {row['bank']:02X}  {row['ff_percent']:5.1f}%"
            f"  {row['zero_percent']:5.1f}%  {row['unique_bytes']:3d}")
    lines.append("")
    lines.append("bank-0 free 0xFF runs (>= 8 bytes):")
    for run in report.bank0_free_runs:
        lines.append(f"  0x{run['offset']:04X}  {run['length']} bytes")
    if not report.bank0_free_runs:
        lines.append("  none")
    if report.warnings:
        lines.append("")
        lines.append("warnings:")
        lines.extend(f"  - {warning}" for warning in report.warnings)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--json", type=Path, help="write the full report as JSON")
    args = parser.parse_args(argv)
    try:
        report = inspect(args.rom)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(asdict(report), indent=2) + "\n",
                             encoding="utf-8")
    print(format_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
