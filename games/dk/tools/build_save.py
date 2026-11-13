#!/usr/bin/env python3
"""Build the Donkey Kong HC007 save blobs.

Assembles games/dk/src/dk_save.asm twice (normal and NOFLASH debug variant),
parses the Intel HEX, and writes one contiguous cave image per variant:

    games/dk/build/cave.bin            bank 0, CPU 0x3910 .. 0x3FC0
    games/dk/build/cave-noflash.bin

Cave image layout (bank 0 free run 0x390C-0x3FFF):
    0x3910  commit_stub   0x3A00 boot_tramp   0x3B00 journal
    0x3F00  WRAM helper source (linked at 0xC900, copied there on demand)
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
SRC = CASE / "src" / "dk_save.asm"
BUILD = CASE / "build"

CAVE_START = 0x3910
CAVE_LIMIT = 0x3FFF          # last usable byte of the bank-0 free run
CODE_LIMIT = 0x3F00          # main code must end before the helper source
HELPER_ROM = 0x3F00
HELPER_LINK = 0xC900
H_SIZE = 0xE0
EXPECT = {"commit_stub": 0x3910, "boot_tramp": 0x3A00, "journal": 0x3B00}


def run(cmd: list[str]) -> None:
    print("+", " ".join(str(c) for c in cmd))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(f"command failed ({r.returncode})")


def parse_ihx(path: Path) -> dict[int, int]:
    mem: dict[int, int] = {}
    for line in path.read_text(encoding="ascii").splitlines():
        line = line.strip()
        if not line.startswith(":"):
            continue
        raw = bytes.fromhex(line[1:])
        if sum(raw) & 0xFF:
            raise SystemExit(f"bad IHX checksum: {line}")
        n, addr, typ = raw[0], (raw[1] << 8) | raw[2], raw[3]
        if typ == 0:
            for i, b in enumerate(raw[4:4 + n]):
                if addr + i in mem:
                    raise SystemExit(f"overlapping output at 0x{addr + i:04X}")
                mem[addr + i] = b
        elif typ == 1:
            break
    return mem


def symbols(noi: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in noi.read_text(encoding="ascii", errors="replace").splitlines():
        m = re.match(r"DEF\s+(\S+)\s+0x([0-9A-Fa-f]+)\s*$", line)
        if m:
            out[m.group(1)] = int(m.group(2), 16)
    return out


SWITCHES = ("NOFLASH", "STUBONLY", "FLASHLVL")


def build(variant: str, on: tuple[str, ...] = (), level: int = 0) -> dict:
    """Assemble one variant; `on` lists the assembler switches set to 1."""
    BUILD.mkdir(parents=True, exist_ok=True)
    text = SRC.read_text(encoding="utf-8")
    for name in SWITCHES:
        value = level if name == "FLASHLVL" else (1 if name in on else 0)
        text, n = re.subn(rf"^{name}\s*=\s*\d", f"{name:<11} = {value}", text, count=1, flags=re.M)
        if n != 1:
            raise SystemExit(f"{name} switch not found in the source")
    asm = BUILD / f"dk_save{variant}.asm"
    asm.write_text(text, encoding="utf-8")
    rel, ihx, noi = (BUILD / f"dk_save{variant}.{e}" for e in ("rel", "ihx", "noi"))
    run([str(GBDK / "sdasgb.exe"), "-o", str(rel), str(asm)])
    run([str(GBDK / "sdldgb.exe"), "-i", "-j", "-m", str(ihx), str(rel)])
    mem = parse_ihx(ihx)
    syms = symbols(noi)

    for name, addr in EXPECT.items():
        if syms.get(name) != addr:
            raise SystemExit(f"{name} at {syms.get(name)} but the hooks assume 0x{addr:04X}")

    code = {a: b for a, b in mem.items() if a < 0x4000}
    helper = {a: b for a, b in mem.items() if a >= HELPER_LINK}
    if min(code) != CAVE_START:
        raise SystemExit(f"code starts at 0x{min(code):04X}, expected 0x{CAVE_START:04X}")
    if max(code) >= CODE_LIMIT:
        raise SystemExit(f"main code reaches 0x{max(code):04X}; limit 0x{CODE_LIMIT - 1:04X}")
    hsize = max(helper) - HELPER_LINK + 1
    if hsize > H_SIZE:
        raise SystemExit(f"WRAM helper is 0x{hsize:X} bytes; H_SIZE is 0x{H_SIZE:X}")
    if HELPER_ROM + H_SIZE - 1 > CAVE_LIMIT:
        raise SystemExit("helper source runs past the bank-0 free run")

    size = HELPER_ROM + H_SIZE - CAVE_START
    cave = bytearray(b"\xFF" * size)
    for a, b in code.items():
        cave[a - CAVE_START] = b
    for a, b in helper.items():
        cave[HELPER_ROM - CAVE_START + a - HELPER_LINK] = b
    (BUILD / f"cave{variant}.bin").write_bytes(cave)

    info = {
        "variant": variant or "normal",
        "cave_bytes": size,
        "main_code_end": f"0x{max(code):04X}",
        "helper_bytes": hsize,
        "symbols": {k: f"0x{v:04X}" for k, v in sorted(syms.items())
                    if k in ("commit_stub", "boot_tramp", "journal", "scan", "w_prog",
                             "w_erase", "w_detect", "cmp_payload", "write_rec")},
    }
    print(json.dumps(info, indent=2))
    return info


def main() -> int:
    infos = [
        build(""),
        build("-noflash", ("NOFLASH",)),
        build("-passthru", ("STUBONLY",)),
        build("-fl1", (), 1),
        build("-fl2", (), 2),
        build("-fl3", (), 3),
    ]
    (BUILD / "build-info.json").write_text(json.dumps(infos, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
