#!/usr/bin/env python3
r"""Turn an sram_trace JSON report into code context.

This is the bridge between "PC X touched SRAM" and "what is the routine?".
It reads a trace produced by tools/sram_trace.mjs, finds the top access PCs,
recovers the instruction start, and prints the surrounding disassembly.

Usage:
    node tools/sram_trace.mjs game.gb --script-file trace.json --json trace.json
    python tools/trace_report.py game.gb trace.json --top 12
    python tools/trace_report.py game.gb trace.json --type writes --before 16 --after 32
    python tools/trace_report.py game.gb trace.json --out analysis\writes.asm
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_gbdis():
    path = ROOT / "tools" / "gbdis.py"
    spec = importlib.util.spec_from_file_location("hc007_gbdis", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["hc007_gbdis"] = module
    spec.loader.exec_module(module)
    return module


gbdis = load_gbdis()


def instruction_start(rom: bytes, bank: int, pc: int) -> int:
    """Return the CPU address of the instruction containing/ending at pc."""
    start = gbdis.find_instruction_start(rom, bank, pc)
    if start is not None:
        bank_data, cpu_base, _ = gbdis._bank_slice(rom, bank)
        return cpu_base + start
    return pc


def context(rom: bytes, bank: int, pc: int, before: int, after: int) -> str:
    start = instruction_start(rom, bank, pc)
    low = max(0x4000 if bank else 0x0000, start - before)
    high = min(0x8000 if bank else 0x4000, start + after)
    rows = gbdis.disassemble_range(rom, bank, low, high)
    lines = []
    for row in rows:
        marker = ">>" if row["addr"] == start else "  "
        comment = ""
        if row["target"] is not None:
            comment = f"  ; -> 0x{row['target']:04X}"
        elif row["mem_addr"] is not None and 0xA000 <= row["mem_addr"] < 0xC000:
            comment = "  ; SRAM"
        lines.append(f"{marker} {row['addr']:04X}: {row['bytes']:<11} "
                     f"{row['text']}{comment}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("trace", type=Path)
    parser.add_argument("--type", choices=("writes", "reads", "both"), default="writes")
    parser.add_argument("--top", type=int, default=12)
    parser.add_argument("--before", type=int, default=24)
    parser.add_argument("--after", type=int, default=48)
    parser.add_argument("--out", type=Path, help="write the listing to a file")
    args = parser.parse_args(argv)

    rom = args.rom.read_bytes()
    report = json.loads(args.trace.read_text(encoding="utf-8"))
    groups = []
    if args.type in ("writes", "both"):
        groups.append(("WRITES", report.get("writes", [])))
    if args.type in ("reads", "both"):
        groups.append(("READS", report.get("reads", [])))

    output = []
    for label, entries in groups:
        output.append(f"===== {label} =====")
        seen = set()
        shown = 0
        for entry in entries:
            key = (entry["pc"], entry["romBank"])
            if key in seen:
                continue
            seen.add(key)
            output.append(
                f"\n-- pc 0x{entry['pc']:04X} bank 0x{entry['romBank']:02X} "
                f"count {entry['count']} "
                f"addr 0x{entry['minAddr']:04X}-0x{entry['maxAddr']:04X} "
                f"frames {entry['firstFrame']}-{entry['lastFrame']} --")
            output.append(context(rom, entry["romBank"], entry["pc"],
                                  args.before, args.after))
            shown += 1
            if shown >= args.top:
                break
    text = "\n".join(output)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
