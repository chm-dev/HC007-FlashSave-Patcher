; Donkey Kong (GB 1994) HC007 batteryless-save patch
;
; Persistent state (see games/dk/notes.md):
;     SRAM A000..A18F   score table      (0x190)
;     SRAM BE2A..BFFF   checksum, backup table, slot headers, signature (0x1D6)
;   payload = 0x366 bytes.
;
; Layout (all code in the fixed bank 0 free run 0x390C-0x3FFF):
;   0x3910  commit_stub     target of the patched writer tails
;   0x3A00  boot_tramp      reset-entry restore (0x100 -> here)
;   0x3B00  journal code    scan / compare / write record
;   0x3F00  WRAM helper     flash primitives, copied to H_ADDR on demand
;   banks 0x20..0x23        log sector; records only in each bank's 0x6000-0x7FFF window (32 x 0x400)
;
; Record (0x400 bytes):
;   +0 'D'  +1 'K'  +2 sum8(payload)  +3 0
;   +4 .. +0x369   payload
;   +0x3FE 0x5A  +0x3FF 0xA5   commit, programmed last
;
; Scratch lives in SRAM 0xA500-0xA60F, a gap no game routine touches: the
; WRAM helper backup (0xE0) and the vars below.  The stub runs on the game's
; own HRAM stack (~20 bytes deep); a private stack in SRAM froze on the real
; cart.  Hardware-proven pieces (graded builds t1/t2/t4): RAM-bank write,
; bank restore from FF8C, SRAM vars, scan, compare, WRAM backup copy.
;
; Build with games/dk/tools/build_save.py.  NOFLASH = 1 builds a debug variant
; that runs every step except the flash writes.

    .module dk_save

    .globl commit_stub, boot_tramp, journal, scan, cmp_payload, write_rec, w_detect, w_prog, w_erase

NOFLASH     = 0                 ; build_save.py rewrites this for the debug variant
STUBONLY    = 0                 ; 1 = commit_stub is just JP 0x1EB2 (isolation build)
FLASHLVL    = 0                 ; hardware bisect: 0 full, 1 detect only, 2 + magic bytes, 3 + payload (no commit)

; ---- layout constants ---------------------------------------------
LOG_BANK0   = 0x20
SLOTS       = 32
PAY_LEN     = 0x0366
SEG1_LEN    = 0x0190
SEG2_LEN    = 0x01D6
SEG1_SRC    = 0xA000
SEG2_SRC    = 0xBE2A

BACKUP      = 0xA500            ; up to 0x100 bytes: WRAM helper block backup
V_LAST      = 0xA604
V_APP       = 0xA605
V_I         = 0xA606
V_BANK      = 0xA607
V_SUM       = 0xA608
V_SRC       = 0xA609            ; 2
V_OFF       = 0xA60B            ; 2
V_CNT       = 0xA60D            ; 2
V_BASEH     = 0xA60F

H_ADDR      = 0xC900            ; WRAM block borrowed for the flash helper
H_SIZE      = 0x00E0            ; >= helper size (checked by the build)
HELPER_ROM  = 0x3F00

; ---- commit stub ---------------------------------------------------
    .area CSTUB (ABS)
    .org 0x3910

; Entered by JP/CALL from the patched writer tails with SRAM still enabled.
; Preserves AF, BC, DE, HL and SP, journals the payload if it changed, then
; continues into the game's own RAM-disable epilogue at 0x1EB2.
commit_stub:
.if STUBONLY
    jp 0x1EB2
.endif
    di
    ; The cart's RAM-bank register powers up in an unknown state and the game
    ; never writes it, so select bank 0 first (LD does not touch flags).
    ld a, #0
    ld (0x4000), a
    ; A bank-register write may drop cart RAM on the HC007 (SML2's helper
    ; re-enables it after every such write): re-enable before any SRAM use.
    ld a, #0x0A
    ld (0x0000), a
    ; Runs on the game's own HRAM stack (about 20 bytes deep).  Moving SP into
    ; SRAM froze on the real cart (hardware builds s2/t3) although SRAM
    ; variables, the bank restore and the full journal all work (t1/t2/t4).
    push af
    push bc
    push de
    push hl
    call journal
    ld a, (0xFF8C)              ; game's ROM-bank shadow
    ld (0x2000), a
    ld a, #0x0A
    ld (0x0000), a              ; bank write may have dropped cart RAM
    pop hl
    pop de
    pop bc
    pop af
    ei
    jp 0x1EB2
cstub_end:

; ---- boot restore --------------------------------------------------
    .area BOOT (ABS)
    .org 0x3A00

; Reached from the reset vector (0x100: JP boot_tramp).  Boot registers are
; preserved because games inspect A/B at entry (SGB/CGB detection).
boot_tramp:
    push af
    push bc
    push de
    push hl
    xor a
    ld (0x4000), a              ; RAM bank 0 (power-on value is unknown)
    ld a, #0x0A
    ld (0x0000), a              ; enable SRAM
    call scan
    ld a, (V_LAST)
    cp #0xFF
    jr z, bt_blank
    ld a, (V_LAST)
    call slot_sel               ; HL = slot base, bank selected
    push hl
    ld de, #4
    add hl, de
    ld bc, #PAY_LEN
    call sum_block              ; A = sum8(payload)
    ld c, a
    pop hl
    push hl
    inc hl
    inc hl
    ld a, (hl)                  ; stored sum
    cp c
    pop hl
    jr nz, bt_blank
    ; Zero the whole cart RAM first so the game starts from the same state
    ; the emulator tests use: real SRAM powers up with garbage, and the
    ; game's own init only clears A000-A4AF and BFBE-BFFF.
    push hl
    call zero_sram
    pop hl
    ld de, #4
    add hl, de
    ld de, #SEG1_SRC
    ld bc, #SEG1_LEN
    call copy
    ld de, #SEG2_SRC
    ld bc, #SEG2_LEN
    call copy
    jr bt_done
bt_blank:
    ; No usable record (first boot after flashing, or a failed flash): start
    ; from blank SRAM too.  Otherwise power-on garbage in BE2A-BFBD (score
    ; checksum/backup, which the game's init never clears) would be journaled
    ; into every record and make the validator wipe the save on the next boot.
    ; Side effect: an emulator .sav is cleared at boot when the log is empty.
    call zero_sram
bt_done:
    xor a
    ld (0x0000), a              ; RAM disabled, as at power-on
    ld a, #1
    ld (0x2000), a              ; default ROM bank 1
    pop hl
    pop de
    pop bc
    pop af
    jp 0x0150

; Clear A000-BFFF (clobbers A, BC, HL).
zero_sram:
    ld hl, #0xA000
    ld bc, #0x2000
zs_loop:
    xor a
    ld (hl), a
    inc hl
    dec bc
    ld a, b
    or c
    jr nz, zs_loop
    ret

boot_end:

; ---- journal code --------------------------------------------------
    .area JCODE (ABS)
    .org 0x3B00

; Journal the payload if it differs from the newest valid record.
journal:
    call scan
    ld a, (V_LAST)
    cp #0xFF
    jr z, j_write
    call cmp_payload            ; Z = identical
    ret z
j_write:
    call install
.if NOFLASH
    jr j_done
.else
    call w_detect
    or a
    jr z, j_done
.ifeq FLASHLVL - 1
    jr j_done
.endif
    ld a, (V_APP)
    cp #SLOTS
    jr c, j_have
    call w_erase
    xor a
    ld (V_APP), a
j_have:
    call write_rec
.endif
j_done:
    call uninstall
    ret

; Sets V_LAST = newest committed slot (0xFF none) and V_APP = first slot whose
; first byte is still erased (SLOTS when the sector is full).
scan:
    ld a, #0xFF
    ld (V_LAST), a
    xor a
    ld (V_I), a
sc_loop:
    ld a, (V_I)
    call slot_sel
    ld a, (hl)
    cp #0xFF
    jr z, sc_free
    call rec_ok
    or a
    jr z, sc_next
    ld a, (V_I)
    ld (V_LAST), a
sc_next:
    ld a, (V_I)
    inc a
    ld (V_I), a
    cp #SLOTS
    jr nz, sc_loop
sc_free:
    ld a, (V_I)
    ld (V_APP), a
    ret

; A = 1 if the record at HL has magic and both commit bytes.
rec_ok:
    ld a, (hl)
    cp #0x44
    jr nz, ro_bad
    inc hl
    ld a, (hl)
    cp #0x4B
    jr nz, ro_bad
    ld de, #0x03FD
    add hl, de
    ld a, (hl)
    cp #0x5A
    jr nz, ro_bad
    inc hl
    ld a, (hl)
    cp #0xA5
    jr nz, ro_bad
    ld a, #1
    ret
ro_bad:
    xor a
    ret

; A = slot -> D = ROM bank, H = high byte of the slot base, L = 0.
slot_calc:
    ; Records live only in the 0x6000-0x7FFF window of each bank: 0x4000-0x5FFF is
    ; the RAM-bank register on stock MBC5, so keep flash data writes out of it (conservative).
    ; slot s -> bank 0x20 + (s >> 3), CPU 0x6000 + (s & 7) * 0x400
    ld d, a
    srl a
    srl a
    srl a
    add a, #LOG_BANK0
    ld e, a
    ld a, d
    and #0x07
    add a, a
    add a, a
    add a, #0x60
    ld h, a
    ld l, #0
    ld d, e
    ret

; Same, and select the bank.
slot_sel:
    call slot_calc
    ld a, d
    ld (0x2000), a
    ld a, #0x0A
    ld (0x0000), a              ; a bank write may drop cart RAM; callers use SRAM next
    ret

; Z = payload in SRAM equals the payload of slot V_LAST.
cmp_payload:
    ld a, (V_LAST)
    call slot_sel
    ld de, #4
    add hl, de
    ld de, #SEG1_SRC
    ld bc, #SEG1_LEN
    call cmp_block
    ret nz
    ld de, #SEG2_SRC
    ld bc, #SEG2_LEN
    call cmp_block
    ret

cmp_block:
    ld a, (de)
    cp (hl)
    jr nz, cb_ne
    inc de
    inc hl
    dec bc
    ld a, b
    or c
    jr nz, cmp_block
    xor a
    ret
cb_ne:
    ld a, #1
    or a
    ret

; A = sum8 of BC bytes at HL.
sum_block:
    ld e, #0
sb_loop:
    ld a, (hl)
    add a, e
    ld e, a
    inc hl
    dec bc
    ld a, b
    or c
    jr nz, sb_loop
    ld a, e
    ret

; Copy BC bytes HL -> DE.
copy:
    ld a, (hl)
    inc hl
    ld (de), a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, copy
    ret

; Back up the borrowed WRAM block to SRAM scratch, then copy the helper in.
install:
    ld hl, #H_ADDR
    ld de, #BACKUP
    ld bc, #H_SIZE
    call copy
    ld hl, #HELPER_ROM
    ld de, #H_ADDR
    ld bc, #H_SIZE
    call copy
    ret

uninstall:
    ld hl, #BACKUP
    ld de, #H_ADDR
    ld bc, #H_SIZE
    call copy
    ret

; Program A at record offset BC of the slot described by V_BANK / V_BASEH.
prog_off:
    push af
    ld a, (V_BASEH)
    add a, b
    ld h, a
    ld l, c
    ld a, (V_BANK)
    ld d, a
    pop af
    jp w_prog

; Append the payload as slot V_APP.  Magic first (marks the slot used), the
; commit bytes last.
write_rec:
    ld a, (V_APP)
    call slot_calc
    ld a, d
    ld (V_BANK), a
    ld a, h
    ld (V_BASEH), a
    xor a
    ld (V_SUM), a
    ld bc, #0
    ld a, #0x44
    call prog_off
    ld bc, #1
    ld a, #0x4B
    call prog_off
.ifeq FLASHLVL - 2
    ret
.endif
    ld a, #4
    ld (V_OFF), a
    xor a
    ld (V_OFF + 1), a
    ld a, #(SEG1_SRC & 0xFF)
    ld (V_SRC), a
    ld a, #(SEG1_SRC >> 8)
    ld (V_SRC + 1), a
    ld a, #(SEG1_LEN & 0xFF)
    ld (V_CNT), a
    ld a, #(SEG1_LEN >> 8)
    ld (V_CNT + 1), a
    call wr_seg
    ld a, #(SEG2_SRC & 0xFF)
    ld (V_SRC), a
    ld a, #(SEG2_SRC >> 8)
    ld (V_SRC + 1), a
    ld a, #(SEG2_LEN & 0xFF)
    ld (V_CNT), a
    ld a, #(SEG2_LEN >> 8)
    ld (V_CNT + 1), a
    call wr_seg
.ifeq FLASHLVL - 3
    ret
.endif
    ld bc, #2
    ld a, (V_SUM)
    call prog_off
    ld bc, #0x03FE
    ld a, #0x5A
    call prog_off
    ld bc, #0x03FF
    ld a, #0xA5
    call prog_off
    ret

; Program V_CNT bytes from V_SRC to record offset V_OFF (advancing both),
; adding every byte to V_SUM.  Erased (0xFF) bytes are not programmed.
wr_seg:
wl:
    ld a, (V_SRC)
    ld l, a
    ld a, (V_SRC + 1)
    ld h, a
    ld a, (hl)
    inc hl
    ld e, a
    ld a, l
    ld (V_SRC), a
    ld a, h
    ld (V_SRC + 1), a
    ld hl, #V_SUM
    ld a, e
    add a, (hl)
    ld (hl), a
    ld a, e
    cp #0xFF
    jr z, wl_skip
    ld a, (V_OFF)
    ld c, a
    ld a, (V_OFF + 1)
    ld b, a
    ld a, e
    call prog_off
wl_skip:
    ld hl, #V_OFF
    inc (hl)
    jr nz, wl_a
    inc hl
    inc (hl)
wl_a:
    ld hl, #V_CNT
    ld a, (hl)
    sub #1
    ld (hl), a
    inc hl
    ld a, (hl)
    sbc a, #0
    ld (hl), a
    dec hl
    or (hl)
    jr nz, wl
    ret

journal_end:

; ---- WRAM helper ---------------------------------------------------
; Linked at H_ADDR, stored at HELPER_ROM, copied on demand.  Every routine
; that touches the flash command interface runs from here (the chip returns
; status, not code, while busy), uses no stack while SRAM is disabled and
; re-enables SRAM before returning.  Sequences are the hardware-proven SML2
; ones (unlock 0xA9/0x56, flash ID 0x20 ...).
    .area WCODE (ABS)
    .org H_ADDR

; A = 1 if a plausible flash manufacturer ID is readable.
w_detect:
    di
    ld a, #0xF0
    ld (0x4000), a
    nop
    ld a, #0xA9
    ld (0x0AAA), a
    nop
    ld a, #0x56
    ld (0x0555), a
    nop
    ld a, #0x90
    ld (0x0AAA), a
    nop
    ld a, (0x0000)
    ld b, a
    ld a, #0xF0
    ld (0x4000), a
    nop
    xor a
    ld (0x4000), a
    ld a, #0x0A
    ld (0x0000), a
    ld a, b
    cp #0x20
    jr z, wd_yes
    cp #0x01
    jr z, wd_yes
    cp #0x1F
    jr z, wd_yes
    cp #0xBF
    jr z, wd_yes
    cp #0xC2
    jr z, wd_yes
    xor a
    ret
wd_yes:
    ld a, #1
    ret

; Program A at HL (window 0x4000-0x7FFF) in ROM bank D.
w_prog:
    ld e, a
    ld a, d
    ld (0x2000), a
    ld a, #0xF0
    ld (0x4000), a
    nop
    ld a, #0xA9
    ld (0x0AAA), a
    nop
    ld a, #0x56
    ld (0x0555), a
    nop
    ld a, #0xA0
    ld (0x0AAA), a
    nop
    ld a, e
    ld (hl), a
    ld bc, #0xFFFF
wp_poll:
    ld a, (hl)
    xor e
    and #0x80
    jr z, wp_done
    dec bc
    ld a, b
    or c
    jr nz, wp_poll
wp_done:
    ld a, #0xF0
    ld (0x4000), a
    nop
    xor a
    ld (0x4000), a
    ld a, #0x0A
    ld (0x0000), a
    ret

; Erase the 64 KiB sector that holds the log.
w_erase:
    ld a, #LOG_BANK0
    ld (0x2000), a
    ld a, #0xF0
    ld (0x4000), a
    nop
    ld a, #0xA9
    ld (0x0AAA), a
    nop
    ld a, #0x56
    ld (0x0555), a
    nop
    ld a, #0x80
    ld (0x0AAA), a
    nop
    ld a, #0xA9
    ld (0x0AAA), a
    nop
    ld a, #0x56
    ld (0x0555), a
    nop
    ld a, #0x30
    ld (0x6000), a
    nop
    ld hl, #0x0008
wer_outer:
    ld bc, #0xFFFF
wer_inner:
    ld a, (0x6000)
    cp #0xFF
    jr z, wer_done
    dec bc
    ld a, b
    or c
    jr nz, wer_inner
    dec hl
    ld a, h
    or l
    jr nz, wer_outer
wer_done:
    ld a, #0xF0
    ld (0x4000), a
    nop
    xor a
    ld (0x4000), a
    ld a, #0x0A
    ld (0x0000), a
    ret

wram_end:
