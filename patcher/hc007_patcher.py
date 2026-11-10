#!/usr/bin/env python3
"""HC007 batteryless save patcher - project skeleton.

This is deliberately a *planning* tool right now: it parses a Game Boy ROM
header, classifies the mapper, checks the HC007 hardware limits, and proposes
where the flash save log could live.  The actual ROM patching (boot trampoline,
SRAM journal, save hook) is the next implementation stage; the TODO markers
below show where each piece goes.

Usage:
    python patcher/hc007_patcher.py info  path/to/game.gb
    python patcher/hc007_patcher.py plan  path/to/game.gb
    python patcher/hc007_patcher.py plan  path/to/game.gb --json

No third-party dependencies.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# HC007 hardware constants (confirmed by the probe in this repo)
# ---------------------------------------------------------------------------

HC007_FLASH_SIZE = 8 * 1024 * 1024
HC007_SECTOR_SIZE = 64 * 1024
# The probe's 4-bank SRAM test fails on the real cart in every mapper mode, so
# only bank 0 is verified.  Treat the usable SRAM as 8 KiB; games that declare
# 32 KiB and actually use banks 1-3 are unsupported until that is re-tested.
HC007_SRAM_SIZE = 8 * 1024
HC007_FLASH_UNLOCK = "0xA9/0x56 (D0/D1 swapped)"

# CPU window used for flash data writes.  0x4000..0x5FFF is the MBC5 RAM bank
# register, so only 0x6000..0x7FFF is safe on MBC5.
LOG_CPU_ADDR = 0x6000

# ---------------------------------------------------------------------------
# Game Boy header tables
# ---------------------------------------------------------------------------

CART_TYPES = {
    0x00: "ROM ONLY",
    0x01: "MBC1",
    0x02: "MBC1+RAM",
    0x03: "MBC1+RAM+BATTERY",
    0x05: "MBC2",
    0x06: "MBC2+BATTERY",
    0x08: "ROM+RAM",
    0x09: "ROM+RAM+BATTERY",
    0x0B: "MMM01",
    0x0C: "MMM01+RAM",
    0x0D: "MMM01+RAM+BATTERY",
    0x0F: "MBC3+TIMER+BATTERY",
    0x10: "MBC3+TIMER+RAM+BATTERY",
    0x11: "MBC3",
    0x12: "MBC3+RAM",
    0x13: "MBC3+RAM+BATTERY",
    0x19: "MBC5",
    0x1A: "MBC5+RAM",
    0x1B: "MBC5+RAM+BATTERY",
    0x1C: "MBC5+RUMBLE",
    0x1D: "MBC5+RUMBLE+RAM",
    0x1E: "MBC5+RUMBLE+RAM+BATTERY",
    0x20: "MBC6",
    0x22: "MBC7+SENSOR+RUMBLE+RAM+BATTERY",
    0xFC: "POCKET CAMERA",
    0xFD: "BANDAI TAMA5",
    0xFE: "HuC3",
    0xFF: "HuC1+RAM+BATTERY",
}

ROM_SIZE_CODES = {
    0x00: 32 * 1024,
    0x01: 64 * 1024,
    0x02: 128 * 1024,
    0x03: 256 * 1024,
    0x04: 512 * 1024,
    0x05: 1024 * 1024,
    0x06: 2 * 1024 * 1024,
    0x07: 4 * 1024 * 1024,
    0x08: 8 * 1024 * 1024,
    0x52: 1152 * 1024,
    0x53: 1280 * 1024,
    0x54: 1536 * 1024,
}

RAM_SIZE_CODES = {
    0x00: 0,
    0x01: 2 * 1024,       # unofficial
    0x02: 8 * 1024,
    0x03: 32 * 1024,
    0x04: 128 * 1024,
    0x05: 64 * 1024,
}


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


def has_rtc(cart_type: int) -> bool:
    return cart_type in (0x0F, 0x10)


def has_rumble(cart_type: int) -> bool:
    return cart_type in (0x1C, 0x1D, 0x1E)


# ---------------------------------------------------------------------------
# Header parsing / checksums
# ---------------------------------------------------------------------------


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


@dataclass
class RomInfo:
    path: str
    file_size: int
    title: str
    cart_type: int
    cart_type_name: str
    mapper: str
    rom_size_code: int
    declared_rom_size: int
    ram_size_code: int
    declared_ram_size: int
    cgb_flag: int
    header_checksum_stored: int
    header_checksum_computed: int
    global_checksum_stored: int
    global_checksum_computed: int
    has_battery: bool
    has_rtc: bool
    has_rumble: bool
    free_sectors: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    proposed_log_sector: int | None = None
    proposed_log_bank: int | None = None
    proposed_log_cpu: int = LOG_CPU_ADDR


def parse_rom(path: Path) -> RomInfo:
    data = path.read_bytes()
    if len(data) < 0x150:
        raise ValueError(f"{path} is too small to be a Game Boy ROM")

    cart_type = data[0x147]
    rom_code = data[0x148]
    ram_code = data[0x149]
    title_bytes = data[0x134:0x144]
    title = title_bytes.split(b"\x00", 1)[0].decode("ascii", "replace").strip()

    declared_rom = ROM_SIZE_CODES.get(rom_code, 0)
    declared_ram = RAM_SIZE_CODES.get(ram_code, 0)

    info = RomInfo(
        path=str(path),
        file_size=len(data),
        title=title,
        cart_type=cart_type,
        cart_type_name=CART_TYPES.get(cart_type, f"UNKNOWN 0x{cart_type:02X}"),
        mapper=mapper_family(cart_type),
        rom_size_code=rom_code,
        declared_rom_size=declared_rom,
        ram_size_code=ram_code,
        declared_ram_size=declared_ram,
        cgb_flag=data[0x143],
        header_checksum_stored=data[0x14D],
        header_checksum_computed=header_checksum(data),
        global_checksum_stored=(data[0x14E] << 8) | data[0x14F],
        global_checksum_computed=global_checksum(data),
        has_battery=cart_type in (0x03, 0x06, 0x09, 0x0D, 0x0F, 0x10, 0x13,
                                  0x1B, 0x1E, 0x22, 0xFF),
        has_rtc=has_rtc(cart_type),
        has_rumble=has_rumble(cart_type),
    )

    # --- hardware compatibility warnings ---------------------------------
    if info.mapper == "UNSUPPORTED":
        info.warnings.append(
            f"mapper {info.cart_type_name} is not handled by the HC007 "
            "(MBC1/MBC3/MBC5 families only)")
    if info.mapper == "MBC2":
        info.warnings.append("MBC2 uses internal 4-bit RAM; the HC007 cannot emulate it")
    if info.has_rtc:
        info.warnings.append(
            "cartridge has an RTC; clock persistence is not implemented yet")
    if info.has_rumble:
        info.warnings.append("rumble is not present on the HC007 (usually harmless)")
    if info.declared_ram_size > HC007_SRAM_SIZE:
        info.warnings.append(
            f"declares {info.declared_ram_size // 1024} KiB SRAM; the HC007 "
            f"4-bank probe test fails, so only bank 0 "
            f"({HC007_SRAM_SIZE // 1024} KiB) is verified")
    if info.declared_ram_size == 0:
        info.warnings.append("declares no cartridge RAM; nothing to journal")
    if info.file_size > HC007_FLASH_SIZE - HC007_SECTOR_SIZE:
        info.warnings.append(
            "image leaves no spare 64 KiB flash sector for the save log")
    if info.header_checksum_stored != info.header_checksum_computed:
        info.warnings.append(
            f"header checksum mismatch (stored 0x{info.header_checksum_stored:02X}, "
            f"computed 0x{info.header_checksum_computed:02X})")

    info.free_sectors = find_free_sectors(data)
    if info.free_sectors:
        info.proposed_log_sector = info.free_sectors[-1]
    elif info.file_size + HC007_SECTOR_SIZE <= HC007_FLASH_SIZE:
        info.proposed_log_sector = (
            (info.file_size + HC007_SECTOR_SIZE - 1) // HC007_SECTOR_SIZE
        ) * HC007_SECTOR_SIZE
        info.warnings.append(
            "no free sector inside the image; the log would go in a new sector "
            f"at 0x{info.proposed_log_sector:X} and the image would be padded")
    else:
        info.warnings.append("no flash sector is available for the save log")

    if info.proposed_log_sector is not None:
        info.proposed_log_bank = info.proposed_log_sector // 0x4000

    return info


def find_free_sectors(data: bytes) -> list[int]:
    """Return chip offsets of 64 KiB sectors that are entirely 0xFF."""
    free = []
    limit = min(len(data), HC007_FLASH_SIZE)
    for base in range(0, limit, HC007_SECTOR_SIZE):
        chunk = data[base:base + HC007_SECTOR_SIZE]
        if len(chunk) == HC007_SECTOR_SIZE and chunk.count(0xFF) == len(chunk):
            free.append(base)
    return free


def bank_select_registers(family: str, bank: int) -> dict[str, int]:
    """Registers a patched ROM must write to select `bank` at 0x4000..0x7FFF."""
    if family == "MBC1":
        return {
            "0x4000": (bank >> 5) & 0x03,   # high 2 bits, mode 0
            "0x2000": bank & 0x1F,          # low 5 bits
        }
    if family == "MBC3":
        return {"0x2000": bank & 0x7F}
    if family == "MBC5":
        return {"0x3000": (bank >> 8) & 0x01, "0x2000": bank & 0xFF}
    return {}


# ---------------------------------------------------------------------------
# Planning output
# ---------------------------------------------------------------------------


def format_info(info: RomInfo) -> str:
    lines = [
        f"ROM: {info.path}",
        f"  title:        {info.title!r}",
        f"  size:         {info.file_size} bytes (declared {info.declared_rom_size})",
        f"  cart type:    0x{info.cart_type:02X}  {info.cart_type_name}",
        f"  mapper:       {info.mapper}",
        f"  RAM:          {info.declared_ram_size // 1024} KiB declared"
        f" (HC007 usable: {HC007_SRAM_SIZE // 1024} KiB, bank 0)",
        f"  CGB flag:     0x{info.cgb_flag:02X}",
        f"  battery:      {'yes' if info.has_battery else 'no'}"
        f"   RTC: {'yes' if info.has_rtc else 'no'}"
        f"   rumble: {'yes' if info.has_rumble else 'no'}",
        f"  header csum:  stored 0x{info.header_checksum_stored:02X}"
        f" / computed 0x{info.header_checksum_computed:02X}",
        f"  global csum:  stored 0x{info.global_checksum_stored:04X}"
        f" / computed 0x{info.global_checksum_computed:04X}",
    ]
    if info.free_sectors:
        lines.append("  free 64K sectors: " +
                     ", ".join(f"0x{x:X}" for x in info.free_sectors))
    else:
        lines.append("  free 64K sectors: none")
    if info.warnings:
        lines.append("  warnings:")
        lines.extend(f"    - {w}" for w in info.warnings)
    return "\n".join(lines)


def format_plan(info: RomInfo) -> str:
    lines = [format_info(info), "", "PLAN"]
    lines.append(
        "  note: flash program/erase is verified in MBC1, MBC3 and MBC5 mode; "
        "the journal must use SRAM bank 0 (8 KiB)")
    if info.declared_ram_size > HC007_SRAM_SIZE:
        lines.append(
            "  WARNING: the journal covers bank 0 only; multi-bank saves will "
            "be incomplete")
    if info.proposed_log_sector is None:
        lines.append("  no usable log sector: this ROM cannot be patched as-is")
        return "\n".join(lines)

    sector = info.proposed_log_sector
    bank = info.proposed_log_bank
    assert bank is not None
    lines += [
        f"  log sector:   0x{sector:06X}..0x{sector + HC007_SECTOR_SIZE - 1:06X}",
        f"  log window:   bank 0x{bank:02X}, CPU 0x{LOG_CPU_ADDR:04X}..0x{LOG_CPU_ADDR + 0x1FFF:04X}",
        f"  chip window:  0x{sector + 0x2000:06X}..0x{sector + 0x3FFF:06X}",
        f"  unlock:       {HC007_FLASH_UNLOCK}",
        f"  bank select:  {bank_select_registers(info.mapper, bank)}",
        "",
        "  TODO (next stage):",
        "    1. append/pad the image so the log sector is 0xFF",
        "    2. inject the boot trampoline at 0x100 and a spare bank",
        "    3. add the mapper-aware WRAM flash driver",
        "    4. add the SRAM page journal + save-detection hook",
        "    5. fix header/global checksums",
    ]
    return "\n".join(lines)


def parse_noi_symbols(path: Path) -> dict[str, int]:
    symbols: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^DEF _([A-Za-z0-9_]+) (0x[0-9A-Fa-f]+)", line)
        if m:
            symbols[m.group(1)] = int(m.group(2), 16)
    return symbols


def fix_checksums(data: bytearray) -> None:
    data[0x14D] = header_checksum(data)
    total = global_checksum(data)
    data[0x14E] = (total >> 8) & 0xFF
    data[0x14F] = total & 0xFF


def entry_target(data: bytes) -> int:
    """Return the address the original 0x100 entry code reaches."""
    op = data[0x100]
    if op == 0x18:                      # jr rel
        rel = data[0x101]
        if rel >= 0x80:
            rel -= 0x100
        return 0x102 + rel
    if op == 0x00 and data[0x101] == 0xC3:   # nop; jp nn
        return data[0x102] | (data[0x103] << 8)
    if op == 0xC3:                      # jp nn
        return data[0x101] | (data[0x102] << 8)
    raise ValueError(
        f"unsupported entry at 0x100: {data[0x100:0x104].hex(' ')}")


def patch_rom(target_path: Path, blob_path: Path, noi_path: Path,
              output_path: Path | None, log_sector: int,
              install_vblank_hook: bool = True) -> None:
    target = bytearray(target_path.read_bytes())
    blob = blob_path.read_bytes()
    symbols = parse_noi_symbols(noi_path)

    required = ("j_boot", "j_vblank", "j_boot_default", "j_vblank_stub")
    missing = [name for name in required if name not in symbols]
    if missing:
        raise ValueError(f"blob .noi is missing symbols: {', '.join(missing)}")

    info = parse_rom(target_path)
    if info.mapper not in ("MBC1", "MBC3", "MBC5"):
        raise ValueError(f"unsupported mapper: {info.mapper}")
    if info.declared_ram_size == 0:
        raise ValueError("target declares no cartridge RAM")
    if info.declared_ram_size > HC007_SRAM_SIZE:
        raise ValueError(
            f"target declares {info.declared_ram_size // 1024} KiB SRAM; "
            f"only {HC007_SRAM_SIZE // 1024} KiB (bank 0) is verified")
    if log_sector != 0x60000:
        raise ValueError("this blob is built for log sector 0x60000")
    if len(target) < log_sector + HC007_SECTOR_SIZE:
        raise ValueError(
            f"target is {len(target)} bytes; log sector 0x{log_sector:X} "
            "does not fit (pad the image first)")

    if any(b != 0xFF for b in target[0x2000:0x4000]):
        raise ValueError("target 0x2000..0x3FFF is not free for the blob")
    if any(b != 0xFF for b in target[log_sector:log_sector + HC007_SECTOR_SIZE]):
        raise ValueError(
            f"log sector 0x{log_sector:X} is not blank; refusing to erase it")

    entry = entry_target(target)
    original_vblank = bytes(target[0x40:0x48])

    # Copy the blob's bank-0 code/data window.
    target[0x2000:0x4000] = blob[0x2000:0x4000]

    def put16(addr: int, value: int) -> None:
        target[addr] = value & 0xFF
        target[addr + 1] = (value >> 8) & 0xFF

    put16(symbols["j_boot_default"], entry)

    stub = symbols["j_vblank_stub"]
    target[stub:stub + 8] = original_vblank

    jb = symbols["j_boot"]
    jv = symbols["j_vblank"]
    target[0x100:0x104] = bytes([0xC3, jb & 0xFF, (jb >> 8) & 0xFF, 0x00])
    if install_vblank_hook:
        target[0x40:0x43] = bytes([0xC3, jv & 0xFF, (jv >> 8) & 0xFF])

    fix_checksums(target)

    if output_path is None:
        output_path = target_path.with_name(target_path.stem + "-patched.gb")
    output_path.write_bytes(target)

    print(f"patched: {target_path} -> {output_path}")
    print(f"  mapper:         {info.mapper}")
    print(f"  entry:          0x{entry:04X} (boot trampoline 0x{jb:04X})")
    if install_vblank_hook:
        print(f"  vblank:         original {original_vblank.hex(' ')} "
              f"-> stub 0x{stub:04X} (hook 0x{jv:04X})")
    else:
        print(f"  vblank:         original {original_vblank.hex(' ')} "
              f"-> unchanged (hook not installed, --no-vblank-hook)")
    print(f"  blob:           0x2000..0x3FFF")
    print(f"  log sector:     0x{log_sector:06X} (bank 0x18)")
    print(f"  header checksum: 0x{target[0x14D]:02X}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("info", "plan", "patch"))
    parser.add_argument("rom", type=Path)
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--blob", type=Path, default=Path("roms/journal-blob.gb"),
                        help="journal blob image (code at 0x2000)")
    parser.add_argument("--blob-noi", type=Path, default=Path("roms/journal-blob.noi"),
                        help="journal blob .noi symbols")
    parser.add_argument("-o", "--output", type=Path,
                        help="patched output path")
    parser.add_argument("--log-sector", type=lambda s: int(s, 0), default=0x60000,
                        help="flash log sector (this blob is built for 0x60000)")
    parser.add_argument("--no-vblank-hook", action="store_true",
                        help="do not patch 0x40 (isolation: boot restore only, "
                        "or trampoline only with a stage-0 blob)")
    args = parser.parse_args(argv)

    if args.command == "patch":
        try:
            patch_rom(args.rom, args.blob, args.blob_noi, args.output,
                      args.log_sector,
                      install_vblank_hook=not args.no_vblank_hook)
        except (OSError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        return 0

    try:
        info = parse_rom(args.rom)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(asdict(info), indent=2))
    elif args.command == "info":
        print(format_info(info))
    else:
        print(format_plan(info))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
