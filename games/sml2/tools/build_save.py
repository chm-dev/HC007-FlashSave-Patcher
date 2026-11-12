#!/usr/bin/env python3
"""Build the SML2 HC007 save blobs.

Runs the GBDK assembler/linker, parses the Intel HEX output, and writes the
binary blobs the patch recipe injects:

    games/sml2/build/hooks.bin     bank 0,   CPU 0x1967
    games/sml2/build/boot.bin      bank 0x24 CPU 0x4000
    games/sml2/build/clear.bin     bank 0x24 CPU 0x4500
    games/sml2/build/journal.bin   bank 0x24 CPU 0x4800
    games/sml2/build/wram.bin      bank 0x24 CPU 0x4C00

journal.bin contains the save/boot-restore/scan code, which runs from
bank 0x24.  wram.bin is the bank-switching helper copied to WRAM
0xDD00 for the duration of a save/restore.  The game's WRAM
0xDD00-0xDFFF is backed up to free stack space below SP.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASE = HERE.parent
ROOT = CASE.parent.parent
GBDK = ROOT / "tools" / "gbdk" / "bin"
ASM = CASE / "src" / "sml2_save.asm"
RECIPE = CASE / "recipe.json"
BUILD = CASE / "build"
REL = BUILD / "sml2_save.rel"
IHX = BUILD / "sml2_save.ihx"
NOI = BUILD / "sml2_save.noi"

HOOKS_START = 0x1967
BOOT_HOOK_START = 0x1AFF
BOOT_START = 0x4000
JOURNAL_START = 0x4800
WRAM_START = 0xC100
WRAM_SIZE = 0x0300

# The file-select CLEAR path at bank 0x0C CPU 0x4227 is relocated to
# bank 0x24 CPU 0x4500 so the entry can be replaced with a JP.
CLEAR_BANK = 0x0C
CLEAR_ADDR = 0x4227
CLEAR_SIZE = 0x46
CLEAR_ROM_ADDR = 0x4500

# The WRAM helper bytes are linked at 0xDD00 but stored in bank 0x24 at
# CPU 0x4C00; the journal copies them from there.
WRAM_ROM_ADDR = 0x4C00

# Area sizes are written by the linker into the .noi file.
AREA_SYMBOLS = {
    "hooks": "l_HCODE0",
    "boothook": "l_BHOOK1",
    "boot": "l_BCODE2",
    "journal": "l_JCODE3",
    "wram": "l_WCODE4",
}


def run(cmd: list[str]) -> None:
    print("+", " ".join(str(part) for part in cmd))
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f"command failed with exit code {result.returncode}")


def parse_ihx(path: Path) -> dict[int, int]:
    memory: dict[int, int] = {}
    for line in path.read_text(encoding="ascii").splitlines():
        line = line.strip()
        if not line.startswith(":"):
            continue
        raw = bytes.fromhex(line[1:])
        length = raw[0]
        address = (raw[1] << 8) | raw[2]
        record_type = raw[3]
        data = raw[4:4 + length]
        if (sum(raw) & 0xFF) != 0:
            raise SystemExit(f"bad Intel HEX checksum: {line}")
        if record_type == 0x00:
            for offset, value in enumerate(data):
                memory[address + offset] = value
        elif record_type == 0x01:
            break
    return memory


def area_sizes(path: Path) -> dict[str, int]:
    sizes: dict[str, int] = {}
    for line in path.read_text(encoding="ascii", errors="replace").splitlines():
        match = re.match(r"DEF\s+(\S+)\s+0x([0-9A-Fa-f]+)\s*$", line)
        if not match:
            continue
        for key, symbol in AREA_SYMBOLS.items():
            if match.group(1) == symbol:
                sizes[key] = int(match.group(2), 16)
    missing = set(AREA_SYMBOLS) - set(sizes)
    if missing:
        raise SystemExit(f"missing area size(s) in {path}: {sorted(missing)}")
    return sizes


def extract(memory: dict[int, int], start: int, size: int, name: str) -> bytes:
    out = bytearray()
    for address in range(start, start + size):
        if address not in memory:
            raise SystemExit(
                f"{name}: no data at 0x{address:04X} "
                f"(start 0x{start:04X}, size 0x{size:X})")
        out.append(memory[address])
    return bytes(out)


def source_rom() -> Path:
    recipe = json.loads(RECIPE.read_text(encoding="utf-8"))
    path = Path(recipe["source"]["path"])
    if not path.is_absolute():
        path = RECIPE.parent / path
    if not path.exists():
        raise SystemExit(f"source ROM not found: {path}")
    return path.resolve()


def main() -> int:
    BUILD.mkdir(parents=True, exist_ok=True)
    run([str(GBDK / "sdasgb.exe"), "-o", str(REL), str(ASM)])
    run([str(GBDK / "sdldgb.exe"), "-i", "-j", "-m", str(IHX), str(REL)])

    if not NOI.exists():
        raise SystemExit(f"linker did not write {NOI}")
    sizes = area_sizes(NOI)
    memory = parse_ihx(IHX)

    hooks = extract(memory, HOOKS_START, sizes["hooks"], "hooks")
    boothook = extract(memory, BOOT_HOOK_START, sizes["boothook"], "boothook")
    boot = extract(memory, BOOT_START, sizes["boot"], "boot")
    journal = extract(memory, JOURNAL_START, sizes["journal"], "journal")
    wram = extract(memory, WRAM_START, sizes["wram"], "wram")

    rom = source_rom().read_bytes()
    clear_off = CLEAR_BANK * 0x4000 + (CLEAR_ADDR - 0x4000)
    clear = rom[clear_off:clear_off + CLEAR_SIZE]
    if len(clear) != CLEAR_SIZE or clear[0:3] != bytes([0xFA, 0xA3, 0xA2]):
        raise SystemExit(
            f"unexpected CLEAR routine at {CLEAR_BANK:02X}:{CLEAR_ADDR:04X}")
    if clear[-1] != 0xC9:
        raise SystemExit(
            f"CLEAR routine does not end in RET at "
            f"{CLEAR_BANK:02X}:{CLEAR_ADDR + CLEAR_SIZE - 1:04X}")

    if sizes["hooks"] > 0x2C:
        raise SystemExit("hooks blob exceeds the 44-byte bank-0 cave")
    if sizes["boothook"] > 0x1B:
        raise SystemExit("boot hook exceeds the 27-byte bank-0 cave at 0x1AFF")
    if sizes["boot"] > 0x500:
        raise SystemExit("boot blob overlaps the relocated CLEAR routine at 0x4500")
    if sizes["journal"] > (WRAM_ROM_ADDR - JOURNAL_START):
        raise SystemExit(
            f"journal is 0x{sizes['journal']:X} bytes; "
            f"the slot before 0x{WRAM_ROM_ADDR:04X} is only "
            f"0x{WRAM_ROM_ADDR - JOURNAL_START:X}")
    if sizes["wram"] > WRAM_SIZE:
        raise SystemExit(
            f"WRAM helper is 0x{sizes['wram']:X} bytes; "
            f"the copy window is 0x{WRAM_SIZE:X}")
    if JOURNAL_START + sizes["journal"] > WRAM_ROM_ADDR:
        raise SystemExit("journal overlaps the WRAM helper source")

    wram_padded = wram + b"\xFF" * (WRAM_SIZE - len(wram))

    (BUILD / "hooks.bin").write_bytes(hooks)
    (BUILD / "boothook.bin").write_bytes(boothook)
    (BUILD / "boot.bin").write_bytes(boot)
    (BUILD / "clear.bin").write_bytes(clear)
    (BUILD / "journal.bin").write_bytes(journal)
    (BUILD / "wram.bin").write_bytes(wram_padded)

    print()
    print(f"hooks:   0x{len(hooks):03X} bytes at CPU 0x{HOOKS_START:04X}")
    print(f"boothook:0x{len(boothook):03X} bytes at CPU 0x{BOOT_HOOK_START:04X}")
    print(f"boot:    0x{len(boot):03X} bytes at CPU 0x{BOOT_START:04X}")
    print(f"journal: 0x{sizes['journal']:03X} bytes at CPU 0x{JOURNAL_START:04X}")
    print(f"wram:    0x{sizes['wram']:03X} bytes at CPU 0x{WRAM_START:04X} "
          f"(copy 0x{WRAM_SIZE:03X} bytes from ROM 0x{WRAM_ROM_ADDR:04X})")
    print(f"clear:   0x{len(clear):03X} bytes -> CPU 0x{CLEAR_ROM_ADDR:04X}")
    print(f"wrote {BUILD / 'hooks.bin'}")
    print(f"wrote {BUILD / 'boothook.bin'}")
    print(f"wrote {BUILD / 'boot.bin'}")
    print(f"wrote {BUILD / 'clear.bin'}")
    print(f"wrote {BUILD / 'journal.bin'}")
    print(f"wrote {BUILD / 'wram.bin'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
