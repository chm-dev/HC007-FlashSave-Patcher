#!/usr/bin/env python3
"""Unit tests for the per-game toolchain (no emulator needed).

Run: python tests/test_toolchain.py
"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gbdis = load_module("hc007_gbdis", ROOT / "tools" / "gbdis.py")
rom_inspect = load_module("hc007_rom_inspect", ROOT / "tools" / "rom_inspect.py")
rom_patch = load_module("hc007_rom_patch", ROOT / "patcher" / "rom_patch.py")


def synthetic_rom(size: int = 0x8000) -> bytearray:
    rom = bytearray(size)
    rom[0x100:0x104] = bytes([0x00, 0xC3, 0x50, 0x01])
    rom[0x104:0x134] = bytes.fromhex(
        "CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DD"
        "DDD999BBBB67636E0EECCCDDDC999FBBB9333E")
    rom[0x134:0x13A] = b"TEST01"
    rom[0x147] = 0x1B
    rom[0x148] = 0x01
    rom[0x149] = 0x02
    rom[0x14D] = rom_inspect.header_checksum(rom)
    checksum = rom_inspect.global_checksum(rom)
    rom[0x14E] = (checksum >> 8) & 0xFF
    rom[0x14F] = checksum & 0xFF
    return rom


class DisassemblerTests(unittest.TestCase):
    def test_jp(self):
        data = bytes([0xC3, 0x50, 0x01])
        op = gbdis.decode(data, 0, 0x0100)
        self.assertEqual(op.text, "JP 0x0150")
        self.assertEqual(op.kind, "jump")
        self.assertEqual(op.target, 0x0150)

    def test_ld_hl_sram(self):
        data = bytes([0x21, 0x00, 0xA0])
        op = gbdis.decode(data, 0, 0x0100)
        self.assertEqual(op.text, "LD HL,0xA000")
        self.assertEqual(op.immediate, 0xA000)

    def test_ld_a_sram(self):
        data = bytes([0xFA, 0x00, 0xA0])
        op = gbdis.decode(data, 0, 0x0100)
        self.assertEqual(op.text, "LD A,(0xA000)")
        self.assertEqual(op.mem_addr, 0xA000)

    def test_cb(self):
        data = bytes([0xCB, 0x37])
        op = gbdis.decode(data, 0, 0x0100)
        self.assertEqual(op.text, "SWAP A")
        self.assertEqual(op.length, 2)

    def test_relative(self):
        data = bytes([0x20, 0xFE])
        op = gbdis.decode(data, 0, 0x0100)
        self.assertEqual(op.text, "JR NZ,0x0100")
        self.assertEqual(op.target, 0x0100)

    def test_trace_pc_backtrack(self):
        bank = bytearray(0x4000)
        bank[0x100] = 0x22      # LD (HL+),A (1-byte instruction)
        start = gbdis.find_instruction_start(bytes(bank), 0, 0x0101)
        self.assertEqual(start, 0x0100)

    def test_sram_refs(self):
        rom = synthetic_rom()
        rom[0x200:0x203] = bytes([0xEA, 0x34, 0xA0])   # LD (0xA034),A
        refs = gbdis.sram_refs(bytes(rom))
        hits = [r for r in refs if r["addr"] == 0x0200]
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["kind"], "direct")
        self.assertEqual(hits[0]["sram_addr"], 0xA034)


class HeaderTests(unittest.TestCase):
    def test_checksums(self):
        rom = synthetic_rom()
        self.assertEqual(rom_inspect.header_checksum(rom), rom[0x14D])
        self.assertEqual(
            rom_inspect.global_checksum(rom),
            (rom[0x14E] << 8) | rom[0x14F])

    def test_inspect(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.gb"
            path.write_bytes(synthetic_rom())
            report = rom_inspect.inspect(path)
        self.assertEqual(report.mapper, "MBC5")
        self.assertEqual(report.declared_ram_size, 8192)
        self.assertEqual(report.entry_target, 0x0150)
        self.assertTrue(report.nintendo_logo_ok)


class RecipeTests(unittest.TestCase):
    def test_apply_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "source.gb"
            source.write_bytes(synthetic_rom())
            recipe = {
                "name": "test",
                "source": {"path": "source.gb",
                           "sha1": rom_patch.hashlib.sha1(source.read_bytes()).hexdigest()},
                "output": "patched.gb",
                "base_rom_size": 0x8000,
                "append_banks": 1,
                "rom_size_code": 5,
                "edits": [
                    {"name": "entry", "offset": 0x100, "hex": "C3 00 40"}
                ],
                "fix_checksums": True,
            }
            recipe_path = tmp_path / "recipe.json"
            recipe_path.write_text(json.dumps(recipe), encoding="utf-8")
            result = rom_patch.apply_recipe(recipe_path, dry_run=False, force=False)
            self.assertEqual(result, 0)
            patched = (tmp_path / "patched.gb").read_bytes()
            self.assertEqual(len(patched), 0x8000 + 0x4000)
            self.assertEqual(patched[0x100:0x103], bytes([0xC3, 0x00, 0x40]))
            self.assertEqual(patched[0x14D], rom_patch.header_checksum(patched))
            self.assertEqual(
                (patched[0x14E] << 8) | patched[0x14F],
                rom_patch.global_checksum(patched))
            self.assertTrue((tmp_path / "patched.gb.report.json").exists())

    def test_sha1_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "source.gb"
            source.write_bytes(synthetic_rom())
            recipe = {
                "source": {"path": "source.gb", "sha1": "0" * 40},
                "output": "patched.gb",
                "edits": [],
            }
            recipe_path = tmp_path / "recipe.json"
            recipe_path.write_text(json.dumps(recipe), encoding="utf-8")
            self.assertEqual(
                rom_patch.apply_recipe(recipe_path, dry_run=False, force=False), 2)
            self.assertFalse((tmp_path / "patched.gb").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
