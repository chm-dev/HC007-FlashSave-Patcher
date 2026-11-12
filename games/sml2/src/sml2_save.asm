; SML2 HC007 batteryless-save patch
;
; Layout:
;   bank 0,   0x1967    save/clear hooks (44-byte FF run)
;   bank 0x24 0x4000    boot code
;   bank 0x24 0x4500    relocated file-select CLEAR routine
;   bank 0x24 0x4800    journal code (save, boot restore, scan)
;   bank 0x24 0x4C00    WRAM helper source (copied on demand)
;   bank 0,   0x1AFF    boot hook (27-byte FF run)
;   bank 0x20 0x6000    flash log window (chip 0x82000..0x83FFF)
;
; The game uses almost all SRAM and WRAM as work RAM, including the area
; that the previous design used for the SRAM manager and journal source.
; A level load overwrites SRAM 0xAD00-0xB0DF, so code stored there cannot
; survive to the next save.  This version keeps all code in the appended
; ROM bank 0x24 and copies only a small bank-switching helper to WRAM for
; the duration of a save/restore.  The game's WRAM 0xC100-0xC3FF is
; backed up to SRAM and restored afterwards.
;
; The log is append-only; a record is 0xF6 bytes with the commit byte
; programmed last.

    .module sml2_save

; ---- flash / save constants -------------------------------------
LOG_BANK        = 0x20
LOG_BASE        = 0x6000
LOG_SIZE        = 0x2000
REC_SIZE        = 0x00F6
PAYLOAD_SIZE    = 0x00F0
SRAM_SAVE       = 0xA000
GAME_BANK       = 0xA24E
BOOT_FLAG       = 0xB0E0
FLASH_OVERRIDE  = 0xB0E1

; ---- ROM / RAM layout -------------------------------------------
CODE_BANK       = 0x24
WRAM_HELPER     = 0xC100
WRAM_HELPER_SIZE = 0x0300
WRAM_HELPER_ROM = 0x4C00
; The game uses most SRAM as work RAM.  The boot restore uses the old
; manager area (0xAD00-0xAFFF), which the file-select code does not touch.
; The in-game save uses 0xB600-0xB8FF, quiet in the gameplay/level traces.
BOOT_SCRATCH    = 0xAD00
SAVE_SCRATCH    = 0xB600

; ---- WRAM variables (inside the backed-up helper block) ---------
var_last_lo     = 0xC3E0
var_last_hi     = 0xC3E1
var_append_lo   = 0xC3E2
var_append_hi   = 0xC3E3
var_ptr_lo      = 0xC3E4
var_ptr_hi      = 0xC3E5
var_count       = 0xC3E6
var_sum         = 0xC3E7
var_rec_lo      = 0xC3E8
var_rec_hi      = 0xC3E9
var_loop        = 0xC3EA

; -----------------------------------------------------------------
; Bank 0 hooks: 0x1967..0x1992 (44 bytes of FF)
; -----------------------------------------------------------------
    .area HCODE (ABS)
    .org 0x1967

; Called from the 11 save-writer call sites.  Runs the original writer,
; then journals the 0xF0-byte save region.  The bank is restored here,
; after journal_save returns: the journal code lives in bank 0x24 and
; would disappear if the bank were switched before its RET.
save_tramp:
    call 0x2934
    di
    ld a, #CODE_BANK
    ld (0x2000), a
    call 0x4800
    ld a, (GAME_BANK)
    ld (0x2000), a
    ei
    ret

; The file-select CLEAR path is relocated to bank 0x24 CPU 0x4500.
; This trampoline runs the original clear routine, then journals the
; cleared slot.  Bank 0x0C is restored after the journal returns.
clear_tramp:
    di
    ld a, #CODE_BANK
    ld (0x2000), a
    call 0x4500
    call 0x4800
    ld a, (GAME_BANK)
    ld (0x2000), a
    ei
    ret

hooks_end:

; -----------------------------------------------------------------
; Boot hook, in the 27-byte bank-0 cave at 0x1AFF.  The bank must be
; restored here (bank 0 is fixed), not in the bank 0x24 boot code:
; switching 0x2000 to 0x0C makes the bank 0x24 boot code disappear, so
; any instruction after the switch would run from bank 0x0C.
; -----------------------------------------------------------------
    .area BHOOK (ABS)
    .org 0x1AFF

boot_hook:
    ld a, (BOOT_FLAG)
    or a
    jr nz, boot_validate
    di
    ld a, #CODE_BANK
    ld (0x2000), a
    call 0x4000
    ld a, #0x0C
    ld (0x2000), a
    ei
boot_validate:
    jp 0x28D9

boothook_end:

; -----------------------------------------------------------------
; Bank 0x24 boot code, executed at CPU 0x4000.  The SRAM blob is gone;
; the boot restore reads the log directly with the WRAM helper.
; -----------------------------------------------------------------
    .area BCODE (ABS)
    .org 0x4000

boot_code:
    di
    call journal_boot_restore
    ld a, #1
    ld (BOOT_FLAG), a
    ret

boot_end:

; -----------------------------------------------------------------
; Journal code, linked at CPU 0x4800 and executed with bank 0x24
; selected.  All accesses to the flash bank go through the WRAM
; helper, which restores bank 0x24 before returning.
; -----------------------------------------------------------------
    .area JCODE (ABS)
    .org 0x4800

; ---- save entry --------------------------------------------------
journal_save:
    di
    ld de, #SAVE_SCRATCH
    call helper_install
    call scan_log

    ld a, (var_last_hi)
    cp #0xFF
    jr z, js_write
    ld a, (var_last_lo)
    ld l, a
    ld a, (var_last_hi)
    ld h, a
    ld de, #0x0003
    add hl, de
    ld de, #SRAM_SAVE
    ld bc, #PAYLOAD_SIZE
    call w_equal
    or a
    jr z, js_write
    jp js_finish

js_write:
    ; A hardware test can force the writer with SRAM 0xB0E1 = 1.
    ld a, (FLASH_OVERRIDE)
    cp #1
    jr z, js_flash_ok
    call w_detect
    or a
    jr z, js_finish
js_flash_ok:
    ld a, (var_append_hi)
    cp #(LOG_SIZE >> 8)
    jr c, js_append_ok
    call w_erase
    xor a
    ld (var_append_lo), a
    ld (var_append_hi), a
js_append_ok:
    call write_record

js_finish:
    ld hl, #SAVE_SCRATCH
    call helper_restore
    ret

; ---- boot restore entry -----------------------------------------
journal_boot_restore:
    di
    ld de, #BOOT_SCRATCH
    call helper_install
    call scan_log
    ld a, (var_last_hi)
    cp #0xFF
    jr z, jbr_done
    ld a, (var_last_lo)
    ld l, a
    ld a, (var_last_hi)
    ld h, a
    ld de, #0x0003
    add hl, de
    ld de, #SRAM_SAVE
    ld bc, #PAYLOAD_SIZE
    call w_boot_copy
jbr_done:
    ld hl, #BOOT_SCRATCH
    call helper_restore
    ret

; ---- scan the log ------------------------------------------------
; Sets var_last (0xFFFF if none) and var_append (first blank record,
; or 0x2000 if full).
scan_log:
    ld a, #0x00
    ld (var_ptr_lo), a
    ld a, #0x60
    ld (var_ptr_hi), a
    ld a, #33
    ld (var_count), a
    ld a, #0xFF
    ld (var_last_lo), a
    ld (var_last_hi), a
    xor a
    ld (var_append_lo), a
    ld (var_append_hi), a
scan_loop:
    ld a, (var_ptr_lo)
    ld l, a
    ld a, (var_ptr_hi)
    ld h, a
    ld bc, #REC_SIZE
    call w_blank
    or a
    jr nz, scan_blank
    ld a, (var_ptr_lo)
    ld l, a
    ld a, (var_ptr_hi)
    ld h, a
    call w_valid
    or a
    jr z, scan_next
    ld a, (var_ptr_lo)
    ld (var_last_lo), a
    ld a, (var_ptr_hi)
    ld (var_last_hi), a
scan_next:
    ld a, (var_ptr_lo)
    ld l, a
    ld a, (var_ptr_hi)
    ld h, a
    ld de, #REC_SIZE
    add hl, de
    ld a, l
    ld (var_ptr_lo), a
    ld a, h
    ld (var_ptr_hi), a
    ld a, (var_count)
    dec a
    ld (var_count), a
    jr nz, scan_loop
    xor a
    ld (var_append_lo), a
    ld a, #(LOG_SIZE >> 8)
    ld (var_append_hi), a
    ret
scan_blank:
    ld a, (var_ptr_lo)
    ld l, a
    ld a, (var_ptr_hi)
    ld h, a
    ld de, #LOG_BASE
    ld a, l
    sub e
    ld l, a
    ld a, h
    sbc a, d
    ld h, a
    ld a, l
    ld (var_append_lo), a
    ld a, h
    ld (var_append_hi), a
    ret

; ---- write a new record at var_append ---------------------------
write_record:
    ; checksum = 'M' + 'L' + 0xF0 + sum(payload)
    ld hl, #SRAM_SAVE
    ld b, #PAYLOAD_SIZE
    ld c, #0x89
wr_sum:
    ld a, (hl)
    inc hl
    add a, c
    ld c, a
    dec b
    jr nz, wr_sum
    ld a, c
    ld (var_sum), a

    ; record base = LOG_BASE + append
    ld a, (var_append_lo)
    ld l, a
    ld a, (var_append_hi)
    ld h, a
    ld de, #LOG_BASE
    add hl, de
    ld a, l
    ld (var_rec_lo), a
    ld a, h
    ld (var_rec_hi), a

    ; length at +2
    ld a, (var_rec_lo)
    ld l, a
    ld a, (var_rec_hi)
    ld h, a
    ld de, #0x0002
    add hl, de
    ld a, #PAYLOAD_SIZE
    call w_prog

    ; payload at +3, skipping erased 0xFF bytes
    ld de, #SRAM_SAVE
    ld a, #0x03
    ld (var_loop), a
    ld a, #PAYLOAD_SIZE
    ld b, a
wr_payload:
    ld a, (de)
    cp #0xFF
    jr z, wr_skip
    push de
    push bc
    ld c, a             ; save the payload byte
    ld a, (var_rec_lo)
    ld l, a
    ld a, (var_rec_hi)
    ld h, a
    ld a, (var_loop)
    add a, l
    ld l, a
    ld a, h
    adc a, #0x00
    ld h, a
    ld a, c             ; restore the payload byte
    call w_prog
    pop bc
    pop de
wr_skip:
    inc de
    ld a, (var_loop)
    inc a
    ld (var_loop), a
    dec b
    jr nz, wr_payload

    ; checksum at +0xF3
    ld a, (var_rec_lo)
    ld l, a
    ld a, (var_rec_hi)
    ld h, a
    ld de, #0x00F3
    add hl, de
    ld a, (var_sum)
    call w_prog

    ; pad at +0xF5
    ld a, (var_rec_lo)
    ld l, a
    ld a, (var_rec_hi)
    ld h, a
    ld de, #0x00F5
    add hl, de
    xor a
    call w_prog

    ; magic at +0 and +1
    ld a, (var_rec_lo)
    ld l, a
    ld a, (var_rec_hi)
    ld h, a
    ld a, #0x4D
    call w_prog
    ld a, (var_rec_lo)
    ld l, a
    ld a, (var_rec_hi)
    ld h, a
    inc hl
    ld a, #0x4C
    call w_prog

    ; commit at +0xF4, programmed last
    ld a, (var_rec_lo)
    ld l, a
    ld a, (var_rec_hi)
    ld h, a
    ld de, #0x00F4
    add hl, de
    ld a, #0x5A
    call w_prog
    ret

; ---- helper install / restore -----------------------------------
; Copy the game's WRAM 0xC100-0xC3FF to the quiet SRAM scratch, then
; copy the bank-switching helper from ROM to WRAM.  The game's stack
; and live SRAM work RAM are left untouched.
helper_install:
    ; DE = SRAM scratch address
    ld hl, #WRAM_HELPER
    ld bc, #WRAM_HELPER_SIZE
    call copy
    ld hl, #WRAM_HELPER_ROM
    ld de, #WRAM_HELPER
    ld bc, #WRAM_HELPER_SIZE
    call copy
    ret

helper_restore:
    ; HL = SRAM scratch address
    ld de, #WRAM_HELPER
    ld bc, #WRAM_HELPER_SIZE
    call copy
    ret

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

journal_end:

; -----------------------------------------------------------------
; WRAM helper, linked at 0xC100 and copied there from ROM 0x4C00.
; Every routine that selects the log bank restores bank 0x24 before
; returning.  Program/erase re-enable SRAM before returning.
; -----------------------------------------------------------------
    .area WCODE (ABS)
    .org WRAM_HELPER

; A = 1 if all BC bytes at HL are 0xFF.
w_blank:
    push hl
    push bc
    ld a, #LOG_BANK
    ld (0x2000), a
wb_loop:
    ld a, (hl)
    cp #0xFF
    jr nz, wb_no
    inc hl
    dec bc
    ld a, b
    or c
    jr nz, wb_loop
    ld a, #1
    jr wb_done
wb_no:
    xor a
wb_done:
    push af
    ld a, #CODE_BANK
    ld (0x2000), a
    pop af
    pop bc
    pop hl
    ret

; A = 1 if the record at HL has valid magic, length, checksum and commit.
w_valid:
    push hl
    push bc
    push de
    ld a, #LOG_BANK
    ld (0x2000), a
    ld d, h
    ld e, l
    ld a, (hl)
    cp #0x4D
    jr nz, wv_bad
    inc hl
    ld a, (hl)
    cp #0x4C
    jr nz, wv_bad
    inc hl
    ld a, (hl)
    cp #PAYLOAD_SIZE
    jr nz, wv_bad
    ld h, d
    ld l, e
    ld b, #0xF3
    ld c, #0x00
wv_sum:
    ld a, (hl)
    inc hl
    add a, c
    ld c, a
    dec b
    jr nz, wv_sum
    ld h, d
    ld l, e
    ld a, l
    add a, #0xF3
    ld l, a
    ld a, h
    adc a, #0x00
    ld h, a
    ld a, (hl)
    cp c
    jr nz, wv_bad
    inc hl
    ld a, (hl)
    cp #0x5A
    jr nz, wv_bad
    ld a, #1
    jr wv_done
wv_bad:
    xor a
wv_done:
    push af
    ld a, #CODE_BANK
    ld (0x2000), a
    pop af
    pop de
    pop bc
    pop hl
    ret

; A = 1 if BC bytes at HL equal BC bytes at DE.
w_equal:
    push hl
    push bc
    push de
    ld a, #LOG_BANK
    ld (0x2000), a
weq_loop:
    ld a, (de)
    ld c, a
    ld a, (hl)
    cp c
    jr nz, weq_no
    inc hl
    inc de
    dec bc
    ld a, b
    or c
    jr nz, weq_loop
    ld a, #1
    jr weq_done
weq_no:
    xor a
weq_done:
    push af
    ld a, #CODE_BANK
    ld (0x2000), a
    pop af
    pop de
    pop bc
    pop hl
    ret

; Copy BC bytes from the log at HL to DE.
w_boot_copy:
    push hl
    push bc
    push de
    ld a, #LOG_BANK
    ld (0x2000), a
wbc_loop:
    ld a, (hl)
    inc hl
    ld (de), a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, wbc_loop
    ld a, #CODE_BANK
    ld (0x2000), a
    pop de
    pop bc
    pop hl
    ret

; A = 1 if a plausible flash ID is readable.
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

; Program A at log address HL.  Runs with the log bank selected and no
; SRAM; restores bank 0x24 and re-enables SRAM before returning.
w_prog:
    ld e, a
    ld a, #LOG_BANK
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
    ld a, #CODE_BANK
    ld (0x2000), a
    ret

; Erase the 64 KiB sector containing the log window.
w_erase:
    ld a, #LOG_BANK
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
    ld a, #CODE_BANK
    ld (0x2000), a
    ret

wram_end:
