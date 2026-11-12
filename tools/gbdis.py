#!/usr/bin/env python3
"""Small Game Boy (LR35902) disassembler and static SRAM-reference finder.

This is intentionally dependency-free.  It is a workbench tool for per-game
save investigation, not a full reconstructing disassembler.

Examples:
    python tools/gbdis.py rom.gb --bank 0 --range 0x100:0x180
    python tools/gbdis.py rom.gb --bank 3 --range 0x4000:0x4100
    python tools/gbdis.py rom.gb --sram-refs
    python tools/gbdis.py rom.gb --sram-refs --json analysis/sram-refs.json
    python tools/gbdis.py rom.gb --around 0x4A2B --bank 3
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Instruction table
# ---------------------------------------------------------------------------

R8 = ("B", "C", "D", "E", "H", "L", "(HL)", "A")
R16 = ("BC", "DE", "HL", "SP")
R16_STACK = ("BC", "DE", "HL", "AF")
ALU = ("ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP ")
COND = ("NZ", "Z", "NC", "C")


@dataclass(frozen=True)
class Op:
    text: str
    length: int
    kind: str = "data"      # code | data | branch | call | ret | jump | halt
    target: int | None = None
    mem_addr: int | None = None
    immediate: int | None = None


def _fmt8(value: int) -> str:
    return f"0x{value:02X}"


def _fmt16(value: int) -> str:
    return f"0x{value:04X}"


def _signed8(value: int) -> int:
    return value - 0x100 if value >= 0x80 else value


def _base_table() -> list[Op | None]:
    table: list[Op | None] = [None] * 0x100

    simple = {
        0x00: ("NOP", "code"),
        0x07: ("RLCA", "code"),
        0x08: ("LD (nn),SP", "code"),
        0x0F: ("RRCA", "code"),
        0x10: ("STOP", "halt"),
        0x17: ("RLA", "code"),
        0x1F: ("RRA", "code"),
        0x27: ("DAA", "code"),
        0x2F: ("CPL", "code"),
        0x37: ("SCF", "code"),
        0x3F: ("CCF", "code"),
        0x76: ("HALT", "halt"),
        0xC9: ("RET", "ret"),
        0xD9: ("RETI", "ret"),
        0xE9: ("JP (HL)", "jump"),
        0xF3: ("DI", "code"),
        0xFB: ("EI", "code"),
    }
    for opcode, (text, kind) in simple.items():
        length = 3 if opcode == 0x08 else 2 if opcode in (0x10, 0x18) else 1
        table[opcode] = Op(text, length, kind)

    # 8-bit loads with immediate / register operands.
    table[0x01] = Op("LD BC,nn", 3)
    table[0x11] = Op("LD DE,nn", 3)
    table[0x21] = Op("LD HL,nn", 3)
    table[0x31] = Op("LD SP,nn", 3)
    table[0x02] = Op("LD (BC),A", 1)
    table[0x12] = Op("LD (DE),A", 1)
    table[0x22] = Op("LD (HL+),A", 1)
    table[0x32] = Op("LD (HL-),A", 1)
    table[0x0A] = Op("LD A,(BC)", 1)
    table[0x1A] = Op("LD A,(DE)", 1)
    table[0x2A] = Op("LD A,(HL+)", 1)
    table[0x3A] = Op("LD A,(HL-)", 1)
    table[0x36] = Op("LD (HL),n", 2)
    table[0x3E] = Op("LD A,n", 2)
    table[0x06] = Op("LD B,n", 2)
    table[0x0E] = Op("LD C,n", 2)
    table[0x16] = Op("LD D,n", 2)
    table[0x1E] = Op("LD E,n", 2)
    table[0x26] = Op("LD H,n", 2)
    table[0x2E] = Op("LD L,n", 2)
    table[0xEA] = Op("LD (nn),A", 3)
    table[0xFA] = Op("LD A,(nn)", 3)
    table[0xE0] = Op("LDH (n),A", 2)
    table[0xF0] = Op("LDH A,(n)", 2)
    table[0xE2] = Op("LD (C),A", 1)
    table[0xF2] = Op("LD A,(C)", 1)

    # INC/DEC r8 and r16, ADD HL,r16.
    for index, register in enumerate(R8):
        table[0x04 + index * 8] = Op(f"INC {register}", 1)
        table[0x05 + index * 8] = Op(f"DEC {register}", 1)
    for index, register in enumerate(R16):
        table[0x03 + index * 16] = Op(f"INC {register}", 1)
        table[0x0B + index * 16] = Op(f"DEC {register}", 1)
        table[0x09 + index * 16] = Op(f"ADD HL,{register}", 1)

    # LD r,r'
    for dst in range(8):
        for src in range(8):
            opcode = 0x40 | (dst << 3) | src
            if opcode == 0x76:
                continue
            table[opcode] = Op(f"LD {R8[dst]},{R8[src]}", 1)

    # ALU A,r
    for operation in range(8):
        for register in range(8):
            table[0x80 | (operation << 3) | register] = Op(
                f"{ALU[operation]}{R8[register]}", 1)

    # Stack and accumulator immediates.
    for index, register in enumerate(R16_STACK):
        table[0xC1 + index * 16] = Op(f"POP {register}", 1)
        table[0xC5 + index * 16] = Op(f"PUSH {register}", 1)
    table[0xC6] = Op("ADD A,n", 2)
    table[0xCE] = Op("ADC A,n", 2)
    table[0xD6] = Op("SUB n", 2)
    table[0xDE] = Op("SBC A,n", 2)
    table[0xE6] = Op("AND n", 2)
    table[0xEE] = Op("XOR n", 2)
    table[0xF6] = Op("OR n", 2)
    table[0xFE] = Op("CP n", 2)

    # Jumps, calls, returns, RST.
    table[0x18] = Op("JR r", 2)
    for index, condition in enumerate(COND):
        table[0x20 + index * 8] = Op(f"JR {condition},r", 2)
        table[0xC0 + index * 8] = Op(f"RET {condition}", 1)
        table[0xC2 + index * 8] = Op(f"JP {condition},nn", 3)
        table[0xC4 + index * 8] = Op(f"CALL {condition},nn", 3)
    table[0xC3] = Op("JP nn", 3)
    table[0xCD] = Op("CALL nn", 3)
    for index in range(8):
        table[0xC7 + index * 8] = Op(f"RST {index * 8:02X}", 1)

    table[0xE8] = Op("ADD SP,r", 2)
    table[0xF8] = Op("LD HL,SP+r", 2)
    table[0xF9] = Op("LD SP,HL", 1)

    # CB is decoded separately.
    table[0xCB] = Op("CB", 1, "data")

    # Illegal opcodes (D3, DB, DD, E3, E4, EB, EC, ED, F4, FC, FD).
    for opcode in (0xD3, 0xDB, 0xDD, 0xE3, 0xE4, 0xEB, 0xEC, 0xED, 0xF4, 0xFC, 0xFD):
        table[opcode] = Op("DB", 1, "data")

    return table


BASE_TABLE = _base_table()


def _decode_cb(addr: int, opcode: int) -> Op:
    register = R8[opcode & 0x07]
    group = opcode >> 6
    if group == 0:
        names = ("RLC", "RRC", "RL", "RR", "SLA", "SRA", "SWAP", "SRL")
        return Op(f"{names[(opcode >> 3) & 0x07]} {register}", 2)
    if group == 1:
        return Op(f"BIT {(opcode >> 3) & 0x07},{register}", 2)
    if group == 2:
        return Op(f"RES {(opcode >> 3) & 0x07},{register}", 2)
    return Op(f"SET {(opcode >> 3) & 0x07},{register}", 2)


def decode(data: bytes, offset: int, addr: int) -> Op:
    """Decode one instruction.  `offset` indexes `data`; `addr` is its CPU address."""
    opcode = data[offset] if offset < len(data) else 0xFF
    if opcode == 0xCB and offset + 1 < len(data):
        return _decode_cb(addr, data[offset + 1])
    op = BASE_TABLE[opcode]
    if op is None:
        return Op("DB", 1, "data")

    text = op.text
    kind = op.kind
    target = None
    mem_addr = None
    immediate = None

    if op.length >= 2 and offset + 1 >= len(data):
        return Op("DB", 1, "data")
    if op.length == 3 and offset + 2 >= len(data):
        return Op("DB", 1, "data")

    if opcode in (0x01, 0x11, 0x21, 0x31):
        value = data[offset + 1] | (data[offset + 2] << 8)
        text = f"{op.text[:-2].rstrip(',')},{_fmt16(value)}"
        immediate = value
    elif opcode in (0xC2, 0xC3, 0xC4, 0xCA, 0xCC, 0xCD, 0xD2, 0xD4,
                    0xDA, 0xDC, 0xEA, 0xFA, 0x08):
        value = data[offset + 1] | (data[offset + 2] << 8)
        text = f"{op.text.replace('nn', _fmt16(value))}"
        if opcode in (0xC2, 0xC3, 0xCA, 0xD2, 0xDA):
            kind = "jump"
            target = value
        elif opcode in (0xC4, 0xCC, 0xD4, 0xDC, 0xCD):
            kind = "call"
            target = value
        elif opcode in (0xEA, 0xFA):
            mem_addr = value
        else:
            immediate = value
    elif opcode in (0x18, 0x20, 0x28, 0x30, 0x38):
        rel = data[offset + 1]
        target_addr = (addr + 2 + _signed8(rel)) & 0xFFFF
        text = f"{op.text.replace('r', _fmt16(target_addr))}"
        kind = "branch"
        target = target_addr
    elif opcode in (0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E, 0x36, 0x3E,
                    0xC6, 0xCE, 0xD6, 0xDE, 0xE6, 0xEE, 0xF6, 0xFE):
        value = data[offset + 1]
        text = f"{op.text.replace(',n', f',{_fmt8(value)}')}"
        if op.text.endswith(",n"):
            pass
        elif " n" in op.text:
            text = f"{op.text.replace(' n', ' ' + _fmt8(value))}"
        immediate = value
    elif opcode in (0xE0, 0xF0):
        value = data[offset + 1]
        text = f"{op.text.replace('(n)', f'(0xFF{value:02X})')}"
        mem_addr = 0xFF00 | value
    elif opcode in (0xE8, 0xF8):
        value = _signed8(data[offset + 1])
        text = f"{op.text.replace(',r', f',{value:+d}')}"

    if opcode == 0xE9:
        kind = "jump"
    if opcode == 0xC9 or opcode == 0xD9 or 0xC0 <= opcode <= 0xD8 and opcode % 8 == 0:
        kind = "ret"

    return Op(text, op.length, kind, target, mem_addr, immediate)


def hex_bytes(data: bytes, offset: int, length: int) -> str:
    return " ".join(f"{b:02X}" for b in data[offset:offset + length])


def _bank_slice(rom: bytes, bank: int) -> tuple[bytes, int, int]:
    """Return (bank bytes, CPU base, file offset)."""
    if bank == 0:
        return rom[:0x4000], 0x0000, 0x0000
    file_offset = bank * 0x4000
    return rom[file_offset:file_offset + 0x4000], 0x4000, file_offset


def disassemble_range(rom: bytes, bank: int, start: int, end: int,
                      symbols: dict[str, int] | None = None) -> list[dict]:
    bank_data, cpu_base, _ = _bank_slice(rom, bank)
    # Accept bank-local offsets or full CPU addresses for banked data.
    if end <= 0x4000:
        local_start, local_end = start, end
    else:
        local_start, local_end = start - 0x4000, end - 0x4000
    local_start = max(0, min(local_start, 0x4000))
    local_end = max(local_start, min(local_end, 0x4000))

    rows = []
    offset = local_start
    while offset < local_end:
        addr = cpu_base + offset
        op = decode(bank_data, offset, addr)
        if op.text == "CB":
            op = Op("DB", 1, "data")
        row = {
            "bank": bank,
            "offset": offset,
            "addr": addr,
            "bytes": hex_bytes(bank_data, offset, op.length),
            "text": op.text,
            "kind": op.kind,
            "target": op.target,
            "mem_addr": op.mem_addr,
            "immediate": op.immediate,
        }
        if symbols:
            for name, symbol_addr in symbols.items():
                if symbol_addr == addr:
                    row["label"] = name
        rows.append(row)
        offset += op.length
    return rows


def _load_symbols(path: Path | None) -> dict[str, int]:
    if path is None:
        return {}
    symbols: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"^DEF _?([A-Za-z0-9_]+) (0x[0-9A-Fa-f]+)", line)
        if match:
            symbols[match.group(1)] = int(match.group(2), 16)
        match = re.match(r"^([0-9A-Fa-f]{2}:[0-9A-Fa-f]{4}) (\S+)", line)
        if match:
            symbols[match.group(2)] = int(match.group(1).split(":", 1)[1], 16)
    return symbols


def format_listing(rows: list[dict]) -> str:
    lines = []
    for row in rows:
        label = row.get("label")
        if label:
            lines.append(f"\n; ---- {label} ----")
        comment = ""
        if row["target"] is not None:
            comment = f"  ; -> 0x{row['target']:04X}"
        elif row["mem_addr"] is not None and 0xA000 <= row["mem_addr"] < 0xC000:
            comment = "  ; SRAM"
        lines.append(
            f"{row['addr']:04X}: {row['bytes']:<11} "
            f"{row['text']}{comment}")
    return "\n".join(lines)


def sram_refs(rom: bytes) -> list[dict]:
    """Linear-scan every bank for direct SRAM operands and SRAM pointer loads."""
    refs = []
    bank_count = max(1, len(rom) // 0x4000)
    for bank in range(bank_count):
        bank_data, cpu_base, _ = _bank_slice(rom, bank)
        offset = 0
        while offset < 0x4000:
            addr = cpu_base + offset
            op = decode(bank_data, offset, addr)
            if op.text == "CB":
                op = Op("DB", 1, "data")
            entry = None
            if op.mem_addr is not None and 0xA000 <= op.mem_addr < 0xC000:
                entry = {
                    "kind": "direct",
                    "bank": bank,
                    "addr": addr,
                    "bytes": hex_bytes(bank_data, offset, op.length),
                    "text": op.text,
                    "sram_addr": op.mem_addr,
                }
            elif op.immediate is not None and 0xA000 <= op.immediate < 0xC000:
                entry = {
                    "kind": "pointer",
                    "bank": bank,
                    "addr": addr,
                    "bytes": hex_bytes(bank_data, offset, op.length),
                    "text": op.text,
                    "sram_addr": op.immediate,
                }
            elif op.text in ("LD (HL),A", "LD A,(HL)", "LD (HL),n",
                             "INC (HL)", "DEC (HL)", "LD (HL+),A",
                             "LD A,(HL+)", "LD (HL-),A", "LD A,(HL-)"):
                entry = {
                    "kind": "indirect",
                    "bank": bank,
                    "addr": addr,
                    "bytes": hex_bytes(bank_data, offset, op.length),
                    "text": op.text,
                    "sram_addr": None,
                }
            elif op.text.startswith(ALU) and op.text.endswith("(HL)"):
                entry = {
                    "kind": "indirect",
                    "bank": bank,
                    "addr": addr,
                    "bytes": hex_bytes(bank_data, offset, op.length),
                    "text": op.text,
                    "sram_addr": None,
                }
            elif op.mem_addr is not None and op.mem_addr < 0x8000:
                entry = {
                    "kind": "mapper",
                    "bank": bank,
                    "addr": addr,
                    "bytes": hex_bytes(bank_data, offset, op.length),
                    "text": op.text,
                    "sram_addr": None,
                }
            if entry:
                refs.append(entry)
            offset += op.length
    return refs


def find_instruction_start(rom: bytes, bank: int, target_cpu: int,
                           max_back: int = 4) -> int | None:
    """Find the instruction start for a trace PC.

    serverboy records `programCounter` after the opcode/operands have been
    fetched, so the memory access that produced the trace happened at an
    instruction that starts 1..4 bytes before the recorded PC.  Search for an
    instruction whose decoded length ends exactly at `target_cpu`; if none
    matches, treat the PC itself as an instruction start.
    """
    bank_data, cpu_base, _ = _bank_slice(rom, bank)
    target_off = target_cpu - cpu_base
    if target_off < 0 or target_off >= 0x4000:
        return None
    for back in range(1, max_back + 1):
        start = target_off - back
        if start < 0:
            continue
        offset = start
        while offset < target_off:
            op = decode(bank_data, offset, cpu_base + offset)
            if op.text == "CB":
                op = Op("DB", 1, "data")
            offset += op.length
        if offset == target_off:
            return start
    return target_off


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--bank", type=lambda s: int(s, 0), default=0)
    parser.add_argument("--range", dest="range_text",
                        help="start:end (bank-local offset or CPU address)")
    parser.add_argument("--around", type=lambda s: int(s, 0),
                        help="CPU address to centre a listing on")
    parser.add_argument("--before", type=int, default=48)
    parser.add_argument("--after", type=int, default=96)
    parser.add_argument("--noi", type=Path, help="optional .noi symbol file")
    parser.add_argument("--sram-refs", action="store_true",
                        help="scan all banks for SRAM accesses/pointers")
    parser.add_argument("--context", type=int, default=0,
                        help="bytes of context around each SRAM ref")
    parser.add_argument("--limit", type=int, default=0,
                        help="maximum rows to print (0 = all)")
    parser.add_argument("--json", type=Path, help="write machine-readable output")
    args = parser.parse_args(argv)

    try:
        rom = args.rom.read_bytes()
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    symbols = _load_symbols(args.noi)
    if args.sram_refs:
        refs = sram_refs(rom)
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(refs, indent=2) + "\n",
                                 encoding="utf-8")
        direct = [r for r in refs if r["kind"] == "direct"]
        pointer = [r for r in refs if r["kind"] == "pointer"]
        print(f"SRAM direct accesses: {len(direct)}")
        print(f"SRAM pointer loads:   {len(pointer)}")
        print(f"indirect/mapper ops:  {len(refs) - len(direct) - len(pointer)}")
        print()
        shown = direct + pointer
        if args.limit:
            shown = shown[:args.limit]
        for ref in shown:
            print(f"bank {ref['bank']:02X}  {ref['addr']:04X}: "
                  f"{ref['bytes']:<11} {ref['text']}  "
                  f"({ref['kind']}, SRAM 0x{ref['sram_addr']:04X})")
            if args.context:
                start = max(0, ref["addr"] - args.context)
                end = min(0x8000 if ref["bank"] else 0x4000,
                          ref["addr"] + args.context)
                rows = disassemble_range(rom, ref["bank"], start, end, symbols)
                print(format_listing(rows))
                print()
        if args.limit and len(direct) + len(pointer) > args.limit:
            print(f"... {len(direct) + len(pointer) - args.limit} more "
                  f"(use --limit 0)")
        return 0

    if args.around is not None:
        start = args.around - args.before
        end = args.around + args.after
    elif args.range_text:
        try:
            start_text, end_text = args.range_text.split(":", 1)
            start = int(start_text, 0)
            end = int(end_text, 0)
        except ValueError:
            print("error: --range must be START:END", file=sys.stderr)
            return 1
    else:
        start, end = 0, 0x4000 if args.bank == 0 else 0x8000

    rows = disassemble_range(rom, args.bank, start, end, symbols)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(rows, indent=2) + "\n",
                             encoding="utf-8")
    else:
        print(format_listing(rows))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        # Windows/PowerShell may close the pipe early (e.g. `| Select -First`).
        import os
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
        raise SystemExit(0)
