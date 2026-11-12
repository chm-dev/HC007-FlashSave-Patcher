===== READS =====

-- pc 0xFFA3 bank 0x04 count 95603 addr 0xA100-0xA1A1 frames 18-1288 --


-- pc 0x5297 bank 0x01 count 6144 addr 0xA8F7-0xA8F8 frames 218-1288 --
   527E: 26 A1       LD H,0xA1
   5280: F0 8D       LDH A,(0xFF8D)
   5282: 6F          LD L,A
   5283: F0 C4       LDH A,(0xFFC4)
   5285: 22          LD (HL+),A
   5286: F0 C5       LDH A,(0xFFC5)
   5288: 22          LD (HL+),A
   5289: C6 08       ADD A,0x08
   528B: E0 C5       LDH (0xFFC5),A
   528D: F0 98       LDH A,(0xFF98)
   528F: 22          LD (HL+),A
   5290: F0 C7       LDH A,(0xFFC7)
   5292: 22          LD (HL+),A
   5293: 7D          LD A,L
   5294: E0 8D       LDH (0xFF8D),A
>> 5296: C9          RET
   5297: 3E 01       LD A,0x01
   5299: EA 4E A2    LD (0xA24E),A  ; SRAM
   529C: EA 00 21    LD (0x2100),A
   529F: F0 C6       LDH A,(0xFFC6)
   52A1: 16 00       LD D,0x00
   52A3: 5F          LD E,A
   52A4: CB 23       SLA E
   52A6: CB 12       RL D
   52A8: 21 00 40    LD HL,0x4000
   52AB: 19          ADD HL,DE
   52AC: 2A          LD A,(HL+)
   52AD: 5F          LD E,A
   52AE: 7E          LD A,(HL)
   52AF: 57          LD D,A
   52B0: 26 A1       LD H,0xA1
   52B2: F0 8D       LDH A,(0xFF8D)
   52B4: 6F          LD L,A
   52B5: F0 C4       LDH A,(0xFFC4)
   52B7: 47          LD B,A
   52B8: F0 C5       LDH A,(0xFFC5)
   52BA: 4F          LD C,A
   52BB: 1A          LD A,(DE)
   52BC: FE 80       CP 0x80
   52BE: 28 26       JR Z,0x52E6  ; -> 0x52E6
   52C0: 80          ADD A,B
   52C1: 22          LD (HL+),A
   52C2: 13          INC DE
   52C3: 1A          LD A,(DE)
   52C4: 81          ADD A,C
   52C5: 22          LD (HL+),A

-- pc 0x527C bank 0x01 count 3072 addr 0xA8F9-0xA8FA frames 218-1288 --
   5263: 00          NOP
   5264: 69          LD L,C
   5265: 00          NOP
   5266: 80          ADD A,B
   5267: F0 C6       LDH A,(0xFFC6)
   5269: CB 37       SWAP A
   526B: E6 0F       AND 0x0F
   526D: C6 80       ADD A,0x80
   526F: CD 7C 52    CALL 0x527C  ; -> 0x527C
   5272: F0 C6       LDH A,(0xFFC6)
   5274: E6 0F       AND 0x0F
   5276: C6 80       ADD A,0x80
   5278: CD 7C 52    CALL 0x527C  ; -> 0x527C
>> 527B: C9          RET
   527C: E0 98       LDH (0xFF98),A
   527E: 26 A1       LD H,0xA1
   5280: F0 8D       LDH A,(0xFF8D)
   5282: 6F          LD L,A
   5283: F0 C4       LDH A,(0xFFC4)
   5285: 22          LD (HL+),A
   5286: F0 C5       LDH A,(0xFFC5)
   5288: 22          LD (HL+),A
   5289: C6 08       ADD A,0x08
   528B: E0 C5       LDH (0xFFC5),A
   528D: F0 98       LDH A,(0xFF98)
   528F: 22          LD (HL+),A
   5290: F0 C7       LDH A,(0xFFC7)
   5292: 22          LD (HL+),A
   5293: 7D          LD A,L
   5294: E0 8D       LDH (0xFF8D),A
   5296: C9          RET
   5297: 3E 01       LD A,0x01
   5299: EA 4E A2    LD (0xA24E),A  ; SRAM
   529C: EA 00 21    LD (0x2100),A
   529F: F0 C6       LDH A,(0xFFC6)
   52A1: 16 00       LD D,0x00
   52A3: 5F          LD E,A
   52A4: CB 23       SLA E
   52A6: CB 12       RL D
   52A8: 21 00 40    LD HL,0x4000

-- pc 0x2B4F bank 0x00 count 3072 addr 0xA8FB-0xA8FC frames 218-1288 --
   2B36: A2          AND D
   2B37: EA 00 21    LD (0x2100),A
   2B3A: C9          RET
   2B3B: 3E 01       LD A,0x01
   2B3D: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B40: EA 00 21    LD (0x2100),A
   2B43: CD 67 52    CALL 0x5267  ; -> 0x5267
   2B46: 3E 0C       LD A,0x0C
   2B48: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B4B: EA 00 21    LD (0x2100),A
>> 2B4E: C9          RET
   2B4F: 3E 01       LD A,0x01
   2B51: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B54: EA 00 21    LD (0x2100),A
   2B57: CD E7 52    CALL 0x52E7  ; -> 0x52E7
   2B5A: 3E 1A       LD A,0x1A
   2B5C: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B5F: EA 00 21    LD (0x2100),A
   2B62: C9          RET
   2B63: 3E 01       LD A,0x01
   2B65: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B68: EA 00 21    LD (0x2100),A
   2B6B: CD E7 52    CALL 0x52E7  ; -> 0x52E7
   2B6E: 3E 0C       LD A,0x0C
   2B70: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B73: EA 00 21    LD (0x2100),A
   2B76: C9          RET
   2B77: 3E 01       LD A,0x01
   2B79: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B7C: EA 00 21    LD (0x2100),A

-- pc 0x002A bank 0x00 count 2216 addr 0xA8F9-0xA8FC frames 17-1288 --
   0011: 28 E2       JR Z,0xFFF5  ; -> 0xFFF5
   0013: A2          AND D
   0014: 1A          LD A,(DE)
   0015: 28 02       JR Z,0x0019  ; -> 0x0019
   0017: 07          RLCA
   0018: 40          LD B,B
   0019: 20 C2       JR NZ,0xFFDD  ; -> 0xFFDD
   001B: AC          XOR H
   001C: BA          CP D
   001D: 33          INC SP
   001E: AE          XOR (HL)
   001F: 02          LD (BC),A
   0020: 80          ADD A,B
   0021: 21 88 8A    LD HL,0x8A88
   0024: 28 08       JR Z,0x002E  ; -> 0x002E
   0026: 63          LD H,E
   0027: 3A          LD A,(HL-)
   0028: 87          ADD A,A
>> 0029: E1          POP HL
   002A: 5F          LD E,A
   002B: 16 00       LD D,0x00
   002D: 19          ADD HL,DE
   002E: 5E          LD E,(HL)
   002F: 23          INC HL
   0030: 56          LD D,(HL)
   0031: D5          PUSH DE
   0032: E1          POP HL
   0033: E9          JP (HL)
   0034: 44          LD B,H
   0035: 0A          LD A,(BC)
   0036: 0A          LD A,(BC)
   0037: 26 41       LD H,0x41
   0039: 8A          ADC A,D
   003A: AA          XOR D
   003B: 28 00       JR Z,0x003D  ; -> 0x003D
   003D: 22          LD (HL+),A
   003E: 2A          LD A,(HL+)
   003F: CA C3 54    JP Z,0x54C3  ; -> 0x54C3
   0042: 01 F9 C4    LD BC,0xC4F9
   0045: 32          LD (HL-),A
   0046: 09          ADD HL,BC
   0047: 22          LD (HL+),A
   0048: C3 2A 37    JP 0x372A  ; -> 0x372A
   004B: 40          LD B,B
   004C: 21 22 84    LD HL,0x8422
   004F: 40          LD B,B
   0050: C3 47 03    JP 0x0347  ; -> 0x0347
   0053: 80          ADD A,B
   0054: 20 C2       JR NZ,0x0018  ; -> 0x0018
   0056: 00          NOP
   0057: 88          ADC A,B
   0058: C3 53 01    JP 0x0153  ; -> 0x0153

-- pc 0x0033 bank 0x00 count 2216 addr 0xA8F9-0xA8FC frames 17-1288 --
   001A: C2 AC BA    JP NZ,0xBAAC  ; -> 0xBAAC
   001D: 33          INC SP
   001E: AE          XOR (HL)
   001F: 02          LD (BC),A
   0020: 80          ADD A,B
   0021: 21 88 8A    LD HL,0x8A88
   0024: 28 08       JR Z,0x002E  ; -> 0x002E
   0026: 63          LD H,E
   0027: 3A          LD A,(HL-)
   0028: 87          ADD A,A
   0029: E1          POP HL
   002A: 5F          LD E,A
   002B: 16 00       LD D,0x00
   002D: 19          ADD HL,DE
   002E: 5E          LD E,(HL)
   002F: 23          INC HL
   0030: 56          LD D,(HL)
   0031: D5          PUSH DE
>> 0032: E1          POP HL
   0033: E9          JP (HL)
   0034: 44          LD B,H
   0035: 0A          LD A,(BC)
   0036: 0A          LD A,(BC)
   0037: 26 41       LD H,0x41
   0039: 8A          ADC A,D
   003A: AA          XOR D
   003B: 28 00       JR Z,0x003D  ; -> 0x003D
   003D: 22          LD (HL+),A
   003E: 2A          LD A,(HL+)
   003F: CA C3 54    JP Z,0x54C3  ; -> 0x54C3
   0042: 01 F9 C4    LD BC,0xC4F9
   0045: 32          LD (HL-),A
   0046: 09          ADD HL,BC
   0047: 22          LD (HL+),A
   0048: C3 2A 37    JP 0x372A  ; -> 0x372A
   004B: 40          LD B,B
   004C: 21 22 84    LD HL,0x8422
   004F: 40          LD B,B
   0050: C3 47 03    JP 0x0347  ; -> 0x0347
   0053: 80          ADD A,B
   0054: 20 C2       JR NZ,0x0018  ; -> 0x0018
   0056: 00          NOP
   0057: 88          ADC A,B
   0058: C3 53 01    JP 0x0153  ; -> 0x0153
   005B: 80          ADD A,B
   005C: 20 2B       JR NZ,0x0089  ; -> 0x0089
   005E: 8A          ADC A,D
   005F: A0          AND B
   0060: AE          XOR (HL)
   0061: 4C          LD C,H

-- pc 0x5A7A bank 0x04 count 2152 addr 0xA8F3-0xA8F6 frames 216-1288 --
   5A61: 14          INC D
   5A62: A5          AND L
   5A63: CD 71 5A    CALL 0x5A71  ; -> 0x5A71
   5A66: 7D          LD A,L
   5A67: E2          LD (C),A
   5A68: 12          LD (DE),A
   5A69: 0C          INC C
   5A6A: 1C          INC E
   5A6B: 7C          LD A,H
   5A6C: E6 0F       AND 0x0F
   5A6E: E2          LD (C),A
   5A6F: 12          LD (DE),A
   5A70: C9          RET
   5A71: FA 50 A4    LD A,(0xA450)  ; SRAM
   5A74: 3D          DEC A
   5A75: CB 27       SLA A
   5A77: 83          ADD A,E
   5A78: 5F          LD E,A
>> 5A79: C9          RET
   5A7A: 11 14 A5    LD DE,0xA514
   5A7D: CD 71 5A    CALL 0x5A71  ; -> 0x5A71
   5A80: 1A          LD A,(DE)
   5A81: 6F          LD L,A
   5A82: 1C          INC E
   5A83: 1A          LD A,(DE)
   5A84: 57          LD D,A
   5A85: 5D          LD E,L
   5A86: C9          RET
   5A87: D1          POP DE
   5A88: 11 20 A5    LD DE,0xA520
   5A8B: CD 71 5A    CALL 0x5A71  ; -> 0x5A71
   5A8E: 1A          LD A,(DE)
   5A8F: 3C          INC A
   5A90: 12          LD (DE),A
   5A91: 1C          INC E
   5A92: FE 19       CP 0x19
   5A94: 28 31       JR Z,0x5AC7  ; -> 0x5AC7
   5A96: FE 2D       CP 0x2D
   5A98: 28 26       JR Z,0x5AC0  ; -> 0x5AC0
   5A9A: 1A          LD A,(DE)
   5A9B: A7          AND A
   5A9C: CA 39 58    JP Z,0x5839  ; -> 0x5839
   5A9F: 1D          DEC E
   5AA0: 1A          LD A,(DE)
   5AA1: D6 19       SUB 0x19
   5AA3: CB 27       SLA A
   5AA5: 6F          LD L,A
   5AA6: 26 00       LD H,0x00
   5AA8: 11 CC 5A    LD DE,0x5ACC

-- pc 0x564B bank 0x04 count 2052 addr 0xA411-0xA441 frames 216-1288 --
   5632: 32          LD (HL-),A
   5633: 18 20       JR 0x5655  ; -> 0x5655
   5635: E1          POP HL
   5636: 18 BB       JR 0x55F3  ; -> 0x55F3
   5638: 21 69 A4    LD HL,0xA469
   563B: 7E          LD A,(HL)
   563C: A7          AND A
   563D: C8          RET Z
   563E: CD 21 54    CALL 0x5421  ; -> 0x5421
   5641: 3E 01       LD A,0x01
   5643: EA 50 A4    LD (0xA450),A  ; SRAM
   5646: 21 10 A4    LD HL,0xA410
   5649: 2C          INC L
>> 564A: 2A          LD A,(HL+)
   564B: A7          AND A
   564C: CA 96 55    JP Z,0x5596  ; -> 0x5596
   564F: 35          DEC (HL)
   5650: C2 65 55    JP NZ,0x5565  ; -> 0x5565
   5653: 2C          INC L
   5654: 2C          INC L
   5655: CD 5B 55    CALL 0x555B  ; -> 0x555B
   5658: FE 00       CP 0x00
   565A: CA 9B 55    JP Z,0x559B  ; -> 0x559B
   565D: FE 9D       CP 0x9D
   565F: CA 10 55    JP Z,0x5510  ; -> 0x5510
   5662: FE 9E       CP 0x9E
   5664: CA D6 55    JP Z,0x55D6  ; -> 0x55D6
   5667: FE 9F       CP 0x9F
   5669: CA EA 55    JP Z,0x55EA  ; -> 0x55EA
   566C: FE 9B       CP 0x9B
   566E: CA F8 55    JP Z,0x55F8  ; -> 0x55F8
   5671: FE 9C       CP 0x9C
   5673: CA 1C 56    JP Z,0x561C  ; -> 0x561C
   5676: FE 99       CP 0x99
   5678: CA 89 59    JP Z,0x5989  ; -> 0x5989

-- pc 0x57FB bank 0x04 count 2052 addr 0xA450-0xA450 frames 216-1288 --
   57E2: 20 0E       JR NZ,0x57F2  ; -> 0x57F2
   57E4: 7A          LD A,D
   57E5: B0          OR B
   57E6: E2          LD (C),A
   57E7: 0C          INC C
   57E8: 7B          LD A,E
   57E9: E2          LD (C),A
   57EA: 0C          INC C
   57EB: 2A          LD A,(HL+)
   57EC: E2          LD (C),A
   57ED: 0C          INC C
   57EE: 7E          LD A,(HL)
   57EF: F6 80       OR 0x80
   57F1: E2          LD (C),A
   57F2: E1          POP HL
   57F3: 2D          DEC L
   57F4: 3A          LD A,(HL-)
   57F5: 32          LD (HL-),A
   57F6: 2D          DEC L
   57F7: 11 50 A4    LD DE,0xA450
>> 57FA: 1A          LD A,(DE)
   57FB: FE 04       CP 0x04
   57FD: 28 09       JR Z,0x5808  ; -> 0x5808
   57FF: 3C          INC A
   5800: 12          LD (DE),A
   5801: 3E 10       LD A,0x10
   5803: 85          ADD A,L
   5804: 6F          LD L,A
   5805: C3 49 56    JP 0x5649  ; -> 0x5649
   5808: 21 1E A4    LD HL,0xA41E
   580B: 34          INC (HL)
   580C: 21 2E A4    LD HL,0xA42E
   580F: 34          INC (HL)
   5810: 21 3E A4    LD HL,0xA43E
   5813: 34          INC (HL)
   5814: C9          RET
   5815: E1          POP HL
   5816: C9          RET
   5817: E5          PUSH HL
   5818: 7D          LD A,L
   5819: C6 06       ADD A,0x06
   581B: 6F          LD L,A
   581C: 7E          LD A,(HL)
   581D: E6 0F       AND 0x0F
   581F: 28 18       JR Z,0x5839  ; -> 0x5839
   5821: EA 51 A4    LD (0xA451),A  ; SRAM
   5824: FA 50 A4    LD A,(0xA450)  ; SRAM
   5827: 0E 13       LD C,0x13
   5829: FE 01       CP 0x01

-- pc 0x558E bank 0x04 count 1844 addr 0xA8F7-0xA8F8 frames 218-1288 --
   5575: 06 20       LD B,0x20
   5577: 04          INC B
   5578: 3E 40       LD A,0x40
   557A: E0 1C       LDH (0xFF1C),A
   557C: E5          PUSH HL
   557D: 7D          LD A,L
   557E: C6 09       ADD A,0x09
   5580: 6F          LD L,A
   5581: 7E          LD A,(HL)
   5582: A7          AND A
   5583: 20 DD       JR NZ,0x5562  ; -> 0x5562
   5585: 7D          LD A,L
   5586: C6 04       ADD A,0x04
   5588: 6F          LD L,A
   5589: CB 7E       BIT 7,(HL)
   558B: 20 D5       JR NZ,0x5562  ; -> 0x5562
>> 558D: E1          POP HL
   558E: CD 17 58    CALL 0x5817  ; -> 0x5817
   5591: E5          PUSH HL
   5592: CD 99 58    CALL 0x5899  ; -> 0x5899
   5595: E1          POP HL
   5596: 2D          DEC L
   5597: 2D          DEC L
   5598: C3 F7 57    JP 0x57F7  ; -> 0x57F7
   559B: 2D          DEC L
   559C: 2D          DEC L
   559D: 2D          DEC L
   559E: 2D          DEC L
   559F: CD 52 55    CALL 0x5552  ; -> 0x5552
   55A2: 7D          LD A,L
   55A3: C6 04       ADD A,0x04
   55A5: 5F          LD E,A
   55A6: 54          LD D,H
   55A7: CD 49 54    CALL 0x5449  ; -> 0x5449
   55AA: FE 00       CP 0x00
   55AC: 28 1F       JR Z,0x55CD  ; -> 0x55CD
   55AE: FE FF       CP 0xFF
   55B0: 28 04       JR Z,0x55B6  ; -> 0x55B6
   55B2: 2C          INC L
   55B3: C3 53 56    JP 0x5653  ; -> 0x5653
   55B6: 2D          DEC L
   55B7: E5          PUSH HL
   55B8: CD 52 55    CALL 0x5552  ; -> 0x5552
   55BB: CD 5B 55    CALL 0x555B  ; -> 0x555B

-- pc 0x5816 bank 0x04 count 1844 addr 0xA8F5-0xA8F6 frames 219-1288 --
   57FD: 28 09       JR Z,0x5808  ; -> 0x5808
   57FF: 3C          INC A
   5800: 12          LD (DE),A
   5801: 3E 10       LD A,0x10
   5803: 85          ADD A,L
   5804: 6F          LD L,A
   5805: C3 49 56    JP 0x5649  ; -> 0x5649
   5808: 21 1E A4    LD HL,0xA41E
   580B: 34          INC (HL)
   580C: 21 2E A4    LD HL,0xA42E
   580F: 34          INC (HL)
   5810: 21 3E A4    LD HL,0xA43E
   5813: 34          INC (HL)
   5814: C9          RET
>> 5815: E1          POP HL
   5816: C9          RET
   5817: E5          PUSH HL
   5818: 7D          LD A,L
   5819: C6 06       ADD A,0x06
   581B: 6F          LD L,A
   581C: 7E          LD A,(HL)
   581D: E6 0F       AND 0x0F
   581F: 28 18       JR Z,0x5839  ; -> 0x5839
   5821: EA 51 A4    LD (0xA451),A  ; SRAM
   5824: FA 50 A4    LD A,(0xA450)  ; SRAM
   5827: 0E 13       LD C,0x13
   5829: FE 01       CP 0x01
   582B: 28 4C       JR Z,0x5879  ; -> 0x5879
   582D: 0E 18       LD C,0x18
   582F: FE 02       CP 0x02
   5831: 28 46       JR Z,0x5879  ; -> 0x5879
   5833: 0E 1D       LD C,0x1D
   5835: FE 03       CP 0x03
   5837: 28 40       JR Z,0x5879  ; -> 0x5879
   5839: FA 50 A4    LD A,(0xA450)  ; SRAM
   583C: FE 04       CP 0x04
   583E: CA 15 58    JP Z,0x5815  ; -> 0x5815
   5841: 0E 13       LD C,0x13
   5843: FE 01       CP 0x01

-- pc 0x5817 bank 0x04 count 1844 addr 0xA8F7-0xA8F8 frames 219-1288 --
   57FE: 09          ADD HL,BC
   57FF: 3C          INC A
   5800: 12          LD (DE),A
   5801: 3E 10       LD A,0x10
   5803: 85          ADD A,L
   5804: 6F          LD L,A
   5805: C3 49 56    JP 0x5649  ; -> 0x5649
   5808: 21 1E A4    LD HL,0xA41E
   580B: 34          INC (HL)
   580C: 21 2E A4    LD HL,0xA42E
   580F: 34          INC (HL)
   5810: 21 3E A4    LD HL,0xA43E
   5813: 34          INC (HL)
   5814: C9          RET
   5815: E1          POP HL
>> 5816: C9          RET
   5817: E5          PUSH HL
   5818: 7D          LD A,L
   5819: C6 06       ADD A,0x06
   581B: 6F          LD L,A
   581C: 7E          LD A,(HL)
   581D: E6 0F       AND 0x0F
   581F: 28 18       JR Z,0x5839  ; -> 0x5839
   5821: EA 51 A4    LD (0xA451),A  ; SRAM
   5824: FA 50 A4    LD A,(0xA450)  ; SRAM
   5827: 0E 13       LD C,0x13
   5829: FE 01       CP 0x01
   582B: 28 4C       JR Z,0x5879  ; -> 0x5879
   582D: 0E 18       LD C,0x18
   582F: FE 02       CP 0x02
   5831: 28 46       JR Z,0x5879  ; -> 0x5879
   5833: 0E 1D       LD C,0x1D
   5835: FE 03       CP 0x03
   5837: 28 40       JR Z,0x5879  ; -> 0x5879
   5839: FA 50 A4    LD A,(0xA450)  ; SRAM
   583C: FE 04       CP 0x04
   583E: CA 15 58    JP Z,0x5815  ; -> 0x5815
   5841: 0E 13       LD C,0x13
   5843: FE 01       CP 0x01
   5845: CA 51 58    JP Z,0x5851  ; -> 0x5851
