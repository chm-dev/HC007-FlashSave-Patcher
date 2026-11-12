28D9: 21 00 A0    LD HL,0xA000
28DC: CD EC 28    CALL 0x28EC  ; -> 0x28EC
28DF: 21 50 A0    LD HL,0xA050
28E2: CD EC 28    CALL 0x28EC  ; -> 0x28EC
28E5: 21 A0 A0    LD HL,0xA0A0
28E8: CD EC 28    CALL 0x28EC  ; -> 0x28EC
28EB: C9          RET
28EC: E5          PUSH HL
28ED: 5D          LD E,L
28EE: 54          LD D,H
28EF: 06 45       LD B,0x45
28F1: 0E 00       LD C,0x00
28F3: 2A          LD A,(HL+)
28F4: 81          ADD A,C
28F5: 4F          LD C,A
28F6: 05          DEC B
28F7: 20 FA       JR NZ,0x28F3  ; -> 0x28F3
28F9: 2A          LD A,(HL+)
28FA: B9          CP C
28FB: 20 16       JR NZ,0x2913  ; -> 0x2913
28FD: 2A          LD A,(HL+)
28FE: FE 12       CP 0x12
2900: 20 11       JR NZ,0x2913  ; -> 0x2913
2902: 2A          LD A,(HL+)
2903: FE 34       CP 0x34
2905: 20 0C       JR NZ,0x2913  ; -> 0x2913
2907: 2A          LD A,(HL+)
2908: FE 56       CP 0x56
290A: 20 07       JR NZ,0x2913  ; -> 0x2913
290C: 7E          LD A,(HL)
290D: FE 78       CP 0x78
290F: 20 02       JR NZ,0x2913  ; -> 0x2913
2911: E1          POP HL
2912: C9          RET
2913: E1          POP HL
2914: 06 40       LD B,0x40
2916: AF          XOR A
2917: 22          LD (HL+),A
2918: 05          DEC B
2919: 20 FC       JR NZ,0x2917  ; -> 0x2917
291B: AF          XOR A
291C: 22          LD (HL+),A
291D: 22          LD (HL+),A
291E: 22          LD (HL+),A
291F: 3E 05       LD A,0x05
2921: 22          LD (HL+),A
2922: AF          XOR A
2923: 22          LD (HL+),A
2924: 3E 02       LD A,0x02
2926: 22          LD (HL+),A
2927: 3E 12       LD A,0x12
2929: 22          LD (HL+),A
292A: 3E 34       LD A,0x34
292C: 22          LD (HL+),A
292D: 3E 56       LD A,0x56
292F: 22          LD (HL+),A
2930: 3E 78       LD A,0x78
2932: 77          LD (HL),A
2933: C9          RET
2934: 21 00 A0    LD HL,0xA000
2937: FA A3 A2    LD A,(0xA2A3)  ; SRAM
293A: 47          LD B,A
293B: CB 27       SLA A
293D: CB 27       SLA A
293F: 80          ADD A,B
2940: CB 37       SWAP A
2942: 5F          LD E,A
2943: 16 00       LD D,0x00
2945: 19          ADD HL,DE
2946: 0E 00       LD C,0x00
2948: 11 40 A8    LD DE,0xA840
294B: 06 40       LD B,0x40
294D: 1A          LD A,(DE)
294E: 22          LD (HL+),A
294F: 81          ADD A,C
2950: 4F          LD C,A
2951: 13          INC DE
2952: 05          DEC B
2953: 20 F8       JR NZ,0x294D  ; -> 0x294D
2955: FA 62 A2    LD A,(0xA262)  ; SRAM
2958: 22          LD (HL+),A
2959: 81          ADD A,C
295A: 4F          LD C,A
295B: FA 63 A2    LD A,(0xA263)  ; SRAM
295E: 22          LD (HL+),A
295F: 81          ADD A,C
2960: 4F          LD C,A
2961: FA C5 A2    LD A,(0xA2C5)  ; SRAM
2964: 22          LD (HL+),A
2965: 81          ADD A,C
2966: 4F          LD C,A
2967: FA 2C A2    LD A,(0xA22C)  ; SRAM
296A: 22          LD (HL+),A
296B: 81          ADD A,C
296C: 4F          LD C,A
296D: FA 8D A2    LD A,(0xA28D)  ; SRAM
2970: 22          LD (HL+),A
2971: 81          ADD A,C
2972: 77          LD (HL),A
2973: C9          RET
