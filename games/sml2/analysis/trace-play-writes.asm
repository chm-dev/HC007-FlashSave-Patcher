===== WRITES =====

-- pc 0x411B bank 0x05 count 13120 addr 0xA100-0xA19F frames 31-201 --
   4102: 00          NOP
   4103: 19          ADD HL,DE
   4104: 7E          LD A,(HL)
   4105: EA 69 A2    LD (0xA269),A  ; SRAM
   4108: 3E FF       LD A,0xFF
   410A: EA 68 A4    LD (0xA468),A  ; SRAM
   410D: 3E 0B       LD A,0x0B
   410F: EA 9B FF    LD (0xFF9B),A
   4112: C9          RET
   4113: 26 A1       LD H,0xA1
   4115: FA 8D FF    LD A,(0xFF8D)
   4118: 6F          LD L,A
   4119: AF          XOR A
>> 411A: 22          LD (HL+),A
   411B: 7D          LD A,L
   411C: FE A0       CP 0xA0
   411E: 38 F9       JR C,0x4119  ; -> 0x4119
   4120: C9          RET
   4121: 00          NOP
   4122: 11 0E 14    LD DE,0x140E
   4125: 65          LD H,L
   4126: 41          LD B,C
   4127: 66          LD H,(HL)
   4128: 41          LD B,C
   4129: 69          LD L,C
   412A: 41          LD B,C
   412B: 6C          LD L,H
   412C: 41          LD B,C
   412D: 6F          LD L,A
   412E: 41          LD B,C
   412F: 74          LD (HL),H
   4130: 41          LD B,C
   4131: 77          LD (HL),A
   4132: 41          LD B,C
   4133: 7A          LD A,D
   4134: 41          LD B,C
   4135: 7D          LD A,L
   4136: 41          LD B,C
   4137: 7F          LD A,A
   4138: 41          LD B,C
   4139: 81          ADD A,C
   413A: 41          LD B,C
   413B: 84          ADD A,H
   413C: 41          LD B,C
   413D: 8C          ADC A,H
   413E: 41          LD B,C
   413F: 94          SUB H
   4140: 41          LD B,C
   4141: 9C          SBC A,H
   4142: 41          LD B,C
   4143: A4          AND H
   4144: 41          LD B,C
   4145: AC          XOR H
   4146: 41          LD B,C
   4147: B4          OR H
   4148: 41          LD B,C
   4149: B7          OR A

-- pc 0x0216 bank 0x00 count 7936 addr 0xA100-0xBFFF frames 7-13 --
   01FD: FE 94       CP 0x94
   01FF: 20 FA       JR NZ,0x01FB  ; -> 0x01FB
   0201: 3E 03       LD A,0x03
   0203: E0 40       LDH (0xFF40),A
   0205: 31 FF A8    LD SP,0xA8FF
   0208: 3E 0A       LD A,0x0A
   020A: EA 00 00    LD (0x0000),A
   020D: AF          XOR A
   020E: 21 FF DF    LD HL,0xDFFF
   0211: 0E 3F       LD C,0x3F
   0213: 06 00       LD B,0x00
>> 0215: 32          LD (HL-),A
   0216: 05          DEC B
   0217: 20 FC       JR NZ,0x0215  ; -> 0x0215
   0219: 0D          DEC C
   021A: 20 F9       JR NZ,0x0215  ; -> 0x0215
   021C: 21 FF FE    LD HL,0xFEFF
   021F: 06 00       LD B,0x00
   0221: 32          LD (HL-),A
   0222: 05          DEC B
   0223: 20 FC       JR NZ,0x0221  ; -> 0x0221
   0225: 21 FE FF    LD HL,0xFFFE
   0228: 06 80       LD B,0x80
   022A: 32          LD (HL-),A
   022B: 05          DEC B
   022C: 20 FC       JR NZ,0x022A  ; -> 0x022A
   022E: 3E 93       LD A,0x93
   0230: EA 7E A2    LD (0xA27E),A  ; SRAM
   0233: 3E D0       LD A,0xD0
   0235: EA 7F A2    LD (0xA27F),A  ; SRAM
   0238: 3E 38       LD A,0x38
   023A: EA 80 A2    LD (0xA280),A  ; SRAM
   023D: 0E A0       LD C,0xA0
   023F: 06 0A       LD B,0x0A
   0241: 21 58 20    LD HL,0x2058
   0244: 2A          LD A,(HL+)

-- pc 0x52C2 bank 0x01 count 4096 addr 0xA100-0xA11C frames 218-1288 --
   52A9: 00          NOP
   52AA: 40          LD B,B
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
>> 52C1: 22          LD (HL+),A
   52C2: 13          INC DE
   52C3: 1A          LD A,(DE)
   52C4: 81          ADD A,C
   52C5: 22          LD (HL+),A
   52C6: 13          INC DE
   52C7: 1A          LD A,(DE)
   52C8: 22          LD (HL+),A
   52C9: 13          INC DE
   52CA: F0 C7       LDH A,(0xFFC7)
   52CC: A7          AND A
   52CD: 28 05       JR Z,0x52D4  ; -> 0x52D4
   52CF: 1A          LD A,(DE)
   52D0: CB E7       SET 4,A
   52D2: 18 01       JR 0x52D5  ; -> 0x52D5
   52D4: 1A          LD A,(DE)
   52D5: 77          LD (HL),A
   52D6: F0 BB       LDH A,(0xFFBB)
   52D8: A7          AND A
   52D9: 20 04       JR NZ,0x52DF  ; -> 0x52DF
   52DB: 7E          LD A,(HL)
   52DC: CB FF       SET 7,A
   52DE: 77          LD (HL),A
   52DF: 23          INC HL
   52E0: 7D          LD A,L
   52E1: E0 8D       LDH (0xFF8D),A
   52E3: 13          INC DE
   52E4: 18 D5       JR 0x52BB  ; -> 0x52BB
   52E6: C9          RET
   52E7: F0 8D       LDH A,(0xFF8D)
   52E9: 47          LD B,A
   52EA: FA 6E A2    LD A,(0xA26E)  ; SRAM
   52ED: 4F          LD C,A
   52EE: B8          CP B
   52EF: 38 0B       JR C,0x52FC  ; -> 0x52FC

-- pc 0x52C6 bank 0x01 count 4096 addr 0xA101-0xA11D frames 218-1288 --
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
>> 52C5: 22          LD (HL+),A
   52C6: 13          INC DE
   52C7: 1A          LD A,(DE)
   52C8: 22          LD (HL+),A
   52C9: 13          INC DE
   52CA: F0 C7       LDH A,(0xFFC7)
   52CC: A7          AND A
   52CD: 28 05       JR Z,0x52D4  ; -> 0x52D4
   52CF: 1A          LD A,(DE)
   52D0: CB E7       SET 4,A
   52D2: 18 01       JR 0x52D5  ; -> 0x52D5
   52D4: 1A          LD A,(DE)
   52D5: 77          LD (HL),A
   52D6: F0 BB       LDH A,(0xFFBB)
   52D8: A7          AND A
   52D9: 20 04       JR NZ,0x52DF  ; -> 0x52DF
   52DB: 7E          LD A,(HL)
   52DC: CB FF       SET 7,A
   52DE: 77          LD (HL),A
   52DF: 23          INC HL
   52E0: 7D          LD A,L
   52E1: E0 8D       LDH (0xFF8D),A
   52E3: 13          INC DE
   52E4: 18 D5       JR 0x52BB  ; -> 0x52BB
   52E6: C9          RET
   52E7: F0 8D       LDH A,(0xFF8D)
   52E9: 47          LD B,A
   52EA: FA 6E A2    LD A,(0xA26E)  ; SRAM
   52ED: 4F          LD C,A
   52EE: B8          CP B
   52EF: 38 0B       JR C,0x52FC  ; -> 0x52FC
   52F1: 26 A1       LD H,0xA1
   52F3: F0 8D       LDH A,(0xFF8D)

-- pc 0x52C9 bank 0x01 count 4096 addr 0xA102-0xA11E frames 218-1288 --
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
   52C6: 13          INC DE
   52C7: 1A          LD A,(DE)
>> 52C8: 22          LD (HL+),A
   52C9: 13          INC DE
   52CA: F0 C7       LDH A,(0xFFC7)
   52CC: A7          AND A
   52CD: 28 05       JR Z,0x52D4  ; -> 0x52D4
   52CF: 1A          LD A,(DE)
   52D0: CB E7       SET 4,A
   52D2: 18 01       JR 0x52D5  ; -> 0x52D5
   52D4: 1A          LD A,(DE)
   52D5: 77          LD (HL),A
   52D6: F0 BB       LDH A,(0xFFBB)
   52D8: A7          AND A
   52D9: 20 04       JR NZ,0x52DF  ; -> 0x52DF
   52DB: 7E          LD A,(HL)
   52DC: CB FF       SET 7,A
   52DE: 77          LD (HL),A
   52DF: 23          INC HL
   52E0: 7D          LD A,L
   52E1: E0 8D       LDH (0xFF8D),A
   52E3: 13          INC DE
   52E4: 18 D5       JR 0x52BB  ; -> 0x52BB
   52E6: C9          RET
   52E7: F0 8D       LDH A,(0xFF8D)
   52E9: 47          LD B,A
   52EA: FA 6E A2    LD A,(0xA26E)  ; SRAM
   52ED: 4F          LD C,A
   52EE: B8          CP B
   52EF: 38 0B       JR C,0x52FC  ; -> 0x52FC
   52F1: 26 A1       LD H,0xA1
   52F3: F0 8D       LDH A,(0xFF8D)
   52F5: 6F          LD L,A
   52F6: AF          XOR A
   52F7: 22          LD (HL+),A

-- pc 0x52D6 bank 0x01 count 4096 addr 0xA103-0xA11F frames 218-1288 --
   52BD: 80          ADD A,B
   52BE: 28 26       JR Z,0x52E6  ; -> 0x52E6
   52C0: 80          ADD A,B
   52C1: 22          LD (HL+),A
   52C2: 13          INC DE
   52C3: 1A          LD A,(DE)
   52C4: 81          ADD A,C
   52C5: 22          LD (HL+),A
   52C6: 13          INC DE
   52C7: 1A          LD A,(DE)
   52C8: 22          LD (HL+),A
   52C9: 13          INC DE
   52CA: F0 C7       LDH A,(0xFFC7)
   52CC: A7          AND A
   52CD: 28 05       JR Z,0x52D4  ; -> 0x52D4
   52CF: 1A          LD A,(DE)
   52D0: CB E7       SET 4,A
   52D2: 18 01       JR 0x52D5  ; -> 0x52D5
   52D4: 1A          LD A,(DE)
>> 52D5: 77          LD (HL),A
   52D6: F0 BB       LDH A,(0xFFBB)
   52D8: A7          AND A
   52D9: 20 04       JR NZ,0x52DF  ; -> 0x52DF
   52DB: 7E          LD A,(HL)
   52DC: CB FF       SET 7,A
   52DE: 77          LD (HL),A
   52DF: 23          INC HL
   52E0: 7D          LD A,L
   52E1: E0 8D       LDH (0xFF8D),A
   52E3: 13          INC DE
   52E4: 18 D5       JR 0x52BB  ; -> 0x52BB
   52E6: C9          RET
   52E7: F0 8D       LDH A,(0xFF8D)
   52E9: 47          LD B,A
   52EA: FA 6E A2    LD A,(0xA26E)  ; SRAM
   52ED: 4F          LD C,A
   52EE: B8          CP B
   52EF: 38 0B       JR C,0x52FC  ; -> 0x52FC
   52F1: 26 A1       LD H,0xA1
   52F3: F0 8D       LDH A,(0xFF8D)
   52F5: 6F          LD L,A
   52F6: AF          XOR A
   52F7: 22          LD (HL+),A
   52F8: 7D          LD A,L
   52F9: B9          CP C
   52FA: 38 FA       JR C,0x52F6  ; -> 0x52F6
   52FC: F0 8D       LDH A,(0xFF8D)
   52FE: EA 6E A2    LD (0xA26E),A  ; SRAM
   5301: C9          RET
   5302: 21 00 A1    LD HL,0xA100

-- pc 0x2B46 bank 0x00 count 3072 addr 0xA8F9-0xA8FA frames 218-1288 --
   2B2D: 00          NOP
   2B2E: 21 CD 97    LD HL,0x97CD
   2B31: 52          LD D,D
   2B32: 3E 1A       LD A,0x1A
   2B34: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B37: EA 00 21    LD (0x2100),A
   2B3A: C9          RET
   2B3B: 3E 01       LD A,0x01
   2B3D: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B40: EA 00 21    LD (0x2100),A
   2B43: CD 67 52    CALL 0x5267  ; -> 0x5267
   2B46: 3E 0C       LD A,0x0C
   2B48: EA 4E A2    LD (0xA24E),A  ; SRAM
   2B4B: EA 00 21    LD (0x2100),A
   2B4E: C9          RET
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

-- pc 0x5272 bank 0x01 count 3072 addr 0xA8F7-0xA8F8 frames 218-1288 --
   5259: 00          NOP
   525A: 04          INC B
   525B: 00          NOP
   525C: 59          LD E,C
   525D: 00          NOP
   525E: 0C          INC C
   525F: F8 68       LD HL,SP+r
   5261: 00          NOP
   5262: 0C          INC C
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
   527B: C9          RET
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

-- pc 0x5286 bank 0x01 count 3072 addr 0xA120-0xA134 frames 218-1288 --
   526D: C6 80       ADD A,0x80
   526F: CD 7C 52    CALL 0x527C  ; -> 0x527C
   5272: F0 C6       LDH A,(0xFFC6)
   5274: E6 0F       AND 0x0F
   5276: C6 80       ADD A,0x80
   5278: CD 7C 52    CALL 0x527C  ; -> 0x527C
   527B: C9          RET
   527C: E0 98       LDH (0xFF98),A
   527E: 26 A1       LD H,0xA1
   5280: F0 8D       LDH A,(0xFF8D)
   5282: 6F          LD L,A
   5283: F0 C4       LDH A,(0xFFC4)
>> 5285: 22          LD (HL+),A
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
   52AB: 19          ADD HL,DE
   52AC: 2A          LD A,(HL+)
   52AD: 5F          LD E,A
   52AE: 7E          LD A,(HL)
   52AF: 57          LD D,A
   52B0: 26 A1       LD H,0xA1
   52B2: F0 8D       LDH A,(0xFF8D)
   52B4: 6F          LD L,A

-- pc 0x5289 bank 0x01 count 3072 addr 0xA121-0xA135 frames 218-1288 --
   5270: 7C          LD A,H
   5271: 52          LD D,D
   5272: F0 C6       LDH A,(0xFFC6)
   5274: E6 0F       AND 0x0F
   5276: C6 80       ADD A,0x80
   5278: CD 7C 52    CALL 0x527C  ; -> 0x527C
   527B: C9          RET
   527C: E0 98       LDH (0xFF98),A
   527E: 26 A1       LD H,0xA1
   5280: F0 8D       LDH A,(0xFF8D)
   5282: 6F          LD L,A
   5283: F0 C4       LDH A,(0xFFC4)
   5285: 22          LD (HL+),A
   5286: F0 C5       LDH A,(0xFFC5)
>> 5288: 22          LD (HL+),A
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

-- pc 0x5290 bank 0x01 count 3072 addr 0xA122-0xA136 frames 218-1288 --
   5277: 80          ADD A,B
   5278: CD 7C 52    CALL 0x527C  ; -> 0x527C
   527B: C9          RET
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
>> 528F: 22          LD (HL+),A
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

-- pc 0x5293 bank 0x01 count 3072 addr 0xA123-0xA137 frames 218-1288 --
   527A: 52          LD D,D
   527B: C9          RET
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
>> 5292: 22          LD (HL+),A
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

-- pc 0x527B bank 0x01 count 3072 addr 0xA8F7-0xA8F8 frames 218-1288 --
   5262: 0C          INC C
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
   527B: C9          RET
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

-- pc 0x557D bank 0x04 count 2868 addr 0xA8F7-0xA8F8 frames 218-1288 --
   5564: 31 FA 50    LD SP,0x50FA
   5567: A4          AND H
   5568: FE 03       CP 0x03
   556A: 20 10       JR NZ,0x557C  ; -> 0x557C
   556C: FA 38 A4    LD A,(0xA438)  ; SRAM
   556F: CB 7F       BIT 7,A
   5571: 28 09       JR Z,0x557C  ; -> 0x557C
   5573: 7E          LD A,(HL)
   5574: FE 06       CP 0x06
   5576: 20 04       JR NZ,0x557C  ; -> 0x557C
   5578: 3E 40       LD A,0x40
   557A: E0 1C       LDH (0xFF1C),A
>> 557C: E5          PUSH HL
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
   558D: E1          POP HL
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

-- pc 0x0032 bank 0x00 count 2216 addr 0xA8F9-0xA8FC frames 17-1288 --
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
   0029: E1          POP HL
   002A: 5F          LD E,A
   002B: 16 00       LD D,0x00
   002D: 19          ADD HL,DE
   002E: 5E          LD E,(HL)
   002F: 23          INC HL
   0030: 56          LD D,(HL)
>> 0031: D5          PUSH DE
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
   005B: 80          ADD A,B
   005C: 20 2B       JR NZ,0x0089  ; -> 0x0089
   005E: 8A          ADC A,D
   005F: A0          AND B
   0060: AE          XOR (HL)

-- pc 0x5591 bank 0x04 count 1844 addr 0xA8F7-0xA8F8 frames 219-1288 --
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
   558D: E1          POP HL
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
   55BE: 5F          LD E,A
   55BF: CD 46 55    CALL 0x5546  ; -> 0x5546
