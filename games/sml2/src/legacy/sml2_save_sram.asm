; SML2 HC007 batteryless-save patch
;
; Layout:
;   bank 0, 0x1967..  save/clear/boot hooks (43 bytes of a 44-byte FF run)
;   bank 0x24 0x4000  boot code (copies the SRAM blob, runs boot restore)
;   bank 0x24 0x4100  SRAM blob: manager (0x100) + journal source (0x2E0)
;   bank 0x24 0x4500  relocated file-select CLEAR routine (from bank 0x0C)
;   bank 0x20 0x6000  flash log window (chip 0x82000..0x83FFF)
;   SRAM 0xAD00       manager (copy/backup/restore, runs from SRAM)
;   SRAM 0xAE00       journal source (copied to WRAM on demand)
;   SRAM 0xB0E0       "boot restore done" flag
;   SRAM 0xB0E1       "flash present" flag
;   SRAM 0xB200       game WRAM backup (0x400 bytes)
;   WRAM 0xDC00       journal code at run time (game data is restored after)
;
; SML2 fills almost all of WRAM during a level load, so the journal code
; cannot live there permanently.  It is stored in SRAM and copied to WRAM
; only for the save/restore call; the game's WRAM 0xDC00-0xDFFF is backed
; up to SRAM and restored afterwards.  The flash unlock writes disable
; SRAM, so they execute from the WRAM copy, which uses no stack while SRAM
; is disabled and re-enables it before returning.

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
FLASH_FLAG      = 0xB0E1

; ---- SRAM manager / journal source ------------------------------
SRAM_MANAGER    = 0xAD00
SRAM_JOURNAL    = 0xAE00
SRAM_BACKUP     = 0xB200
WRAM_JOURNAL    = 0xDC00
JOURNAL_SIZE    = 0x02E0

; ---- WRAM variables (inside the backed-up 0xDC00 block) ---------
var_game_bank   = 0xDFC0
var_append_lo   = 0xDFC1
var_append_hi   = 0xDFC2
var_last_lo     = 0xDFC3
var_last_hi     = 0xDFC4
var_ptr_lo      = 0xDFC5
var_ptr_hi      = 0xDFC6
var_count       = 0xDFC7
var_sum         = 0xDFC8
var_prog_off_lo = 0xDFC9
var_prog_off_hi = 0xDFCA
var_prog_val    = 0xDFCB
var_id0         = 0xDFCD

; -----------------------------------------------------------------
; Bank 0 hooks: 0x1967 (44 bytes of FF, verified no xrefs)
; -----------------------------------------------------------------
    .area HCODE (ABS)
    .org 0x1967

; Called from the 11 save-writer call sites.  Runs the original writer,
; then journals the 0xF0-byte save region.  journal_save restores the
; caller's bank from 0xA24E.
save_tramp:
    call 0x2934
    call sram_save
    ret

; The file-select CLEAR path is relocated to bank 0x24 CPU 0x4500.
; This trampoline runs the original clear routine, then journals the
; cleared slot.  sram_save restores the game's bank (0x0C).
clear_tramp:
    di
    ld a, #0x24
    ld (0x2000), a
    call 0x4500
    call sram_save
    ret

; Called from bank 0x0C CALL 0x28D9 (file-select setup).  The first call
; copies the journal code, probes flash and restores the slots; later
; calls fall straight through to the original validator.  The tail jump
; lets the validator's RET return to the original caller (0x4037).
boot_hook:
    ld a, (BOOT_FLAG)
    or a
    jr nz, boot_validate
    di
    ld a, #0x24
    ld (0x2000), a
    call 0x4000
    ld a, #0x0C
    ld (0x2000), a
    ei
boot_validate:
    jp 0x28D9

hooks_end:

; -----------------------------------------------------------------
; Bank 0x24 boot code, executed at CPU 0x4000.  Returns with bank 0x0C
; selected, i.e. the bank that called the file-select validator.
; -----------------------------------------------------------------
    .area BCODE (ABS)
    .org 0x4000

boot_code:
    di
    ; copy the SRAM blob (manager + journal source) to 0xAD00
    ld hl, #0x4100
    ld de, #0xAD00
    ld bc, #0x03E0
bcopy:
    ld a, (hl)
    inc hl
    ld (de), a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, bcopy
    call sram_boot
    ld a, #1
    ld (BOOT_FLAG), a
    ret

boot_end:

; -----------------------------------------------------------------
; SRAM manager, linked at 0xAD00.  Startup copies this block and the
; journal source to SRAM; the save/clear hooks call sram_save.
; -----------------------------------------------------------------
    .area MCODE (ABS)
    .org 0xAD00

; Boot entry: WRAM was just cleared by the game.  Copy the journal code
; to 0xDC00, probe flash, restore the save slots, then clear 0xDC00-0xDFFF
; again so the game's boot-time WRAM state is unchanged.
sram_boot:
    di
    ld hl, #SRAM_JOURNAL
    ld de, #WRAM_JOURNAL
    ld bc, #JOURNAL_SIZE
    call m_copy
    call flash_detect
    call journal_boot_restore
    ld hl, #WRAM_JOURNAL
    ld bc, #0x0400
    call m_fill
    ret

; Save/clear entry: back up the game's 0xDC00-0xDFFF, install the
; journal code, run it, then restore the game's data.
sram_save:
    di
    ld hl, #WRAM_JOURNAL
    ld de, #SRAM_BACKUP
    ld bc, #0x0400
    call m_copy
    ld hl, #SRAM_JOURNAL
    ld de, #WRAM_JOURNAL
    ld bc, #JOURNAL_SIZE
    call m_copy
    call journal_save
    ld hl, #SRAM_BACKUP
    ld de, #WRAM_JOURNAL
    ld bc, #0x0400
    call m_copy
    ei
    ret

; HL -> DE, BC bytes.
m_copy:
    ld a, (hl)
    inc hl
    ld (de), a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, m_copy
    ret

; Fill HL..HL+BC-1 with zero.
m_fill:
    xor a
    ld (hl), a
    inc hl
    dec bc
    ld a, b
    or c
    jr nz, m_fill
    ret

manager_end:

; -----------------------------------------------------------------
; WRAM journal code, linked at its execution address 0xDC00.
; The bytes are stored at SRAM 0xAA00 and copied on demand.
; -----------------------------------------------------------------
    .area JCODE (ABS)
    .org 0xDC00

; ---- flash ID probe ---------------------------------------------
; Reads the manufacturer ID with the HC007 0xA9/0x56 unlock.  Sets
; FLASH_FLAG (SRAM 0xAD01) = 1 for a plausible flash, 0 in emulators.
flash_detect:
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
    ld (var_id0), a
    ld a, #0xF0
    ld (0x4000), a
    nop
    xor a
    ld (0x4000), a
    ld a, #0x0A
    ld (0x0000), a
    ld a, (var_id0)
    cp #0x20
    jr z, fd_yes
    cp #0x01
    jr z, fd_yes
    cp #0x1F
    jr z, fd_yes
    cp #0xBF
    jr z, fd_yes
    cp #0xC2
    jr z, fd_yes
    xor a
    ld (FLASH_FLAG), a
    ret
fd_yes:
    ld a, #1
    ld (FLASH_FLAG), a
    ret

; ---- program one byte at 0x6000 + var_prog_off -------------------
; Run with log bank selected.  No stack access while SRAM is off.
flash_prog:
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
    ld a, #0xA0
    ld (0x0AAA), a
    nop
    ld hl, #0x6000
    ld a, (var_prog_off_lo)
    add a, l
    ld l, a
    ld a, (var_prog_off_hi)
    adc a, h
    ld h, a
    ld a, (var_prog_val)
    ld (hl), a
    ld e, a
    ld bc, #0xFFFF
fp_poll:
    ld a, (hl)
    xor e
    and #0x80
    jr z, fp_done
    dec bc
    ld a, b
    or c
    jr nz, fp_poll
fp_done:
    ld a, #0xF0
    ld (0x4000), a
    nop
    xor a
    ld (0x4000), a
    ld a, #0x0A
    ld (0x0000), a
    ret

; ---- erase the log sector ---------------------------------------
; Run with log bank selected.  No stack access while SRAM is off.
flash_erase:
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
fe_outer:
    ld bc, #0xFFFF
fe_inner:
    ld a, (0x6000)
    cp #0xFF
    jr z, fe_done
    dec bc
    ld a, b
    or c
    jr nz, fe_inner
    dec hl
    ld a, h
    or l
    jr nz, fe_outer
fe_done:
    ld a, #0xF0
    ld (0x4000), a
    nop
    xor a
    ld (0x4000), a
    ld a, #0x0A
    ld (0x0000), a
    ret

; ---- helpers -----------------------------------------------------
; HL = record base.  A = 1 if all REC_SIZE bytes are 0xFF.
record_blank:
    push hl
    push bc
    ld b, #0xF6
rb_loop:
    ld a, (hl)
    inc hl
    cp #0xFF
    jr nz, rb_no
    dec b
    jr nz, rb_loop
    ld a, #1
    jr rb_done
rb_no:
    xor a
rb_done:
    pop bc
    pop hl
    ret

; HL = record base.  A = 1 if magic/length/checksum/commit are valid.
;   +0x00 'M'  +0x01 'L'  +0x02 0xF0
;   +0x03..+0xF2 payload
;   +0xF3 checksum (sum of +0x00..+0xF2)
;   +0xF4 0x5A commit
;   +0xF5 0x00 pad
record_valid:
    push hl
    push bc
    push de
    ld d, h
    ld e, l
    ld a, (hl)
    cp #0x4D
    jr nz, rv_bad
    inc hl
    ld a, (hl)
    cp #0x4C
    jr nz, rv_bad
    inc hl
    ld a, (hl)
    cp #0xF0
    jr nz, rv_bad
    ld h, d
    ld l, e
    ld b, #0xF3
    ld c, #0x00
rv_sum:
    ld a, (hl)
    inc hl
    add a, c
    ld c, a
    dec b
    jr nz, rv_sum
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
    jr nz, rv_bad
    inc hl
    ld a, (hl)
    cp #0x5A
    jr nz, rv_bad
    ld a, #1
    jr rv_done
rv_bad:
    xor a
rv_done:
    pop de
    pop bc
    pop hl
    ret

; Scan the log.  Sets var_last to the last valid record (0xFFFF if none)
; and var_append to the first blank record, or 0x2000 if full.
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
    call record_blank
    or a
    jr nz, scan_blank
    ld a, (var_ptr_lo)
    ld l, a
    ld a, (var_ptr_hi)
    ld h, a
    call record_valid
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
    ld de, #0x00F6
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
    ld a, #0x20
    ld (var_append_hi), a
    ret
scan_blank:
    ld a, (var_ptr_lo)
    ld l, a
    ld a, (var_ptr_hi)
    ld h, a
    ld de, #0x6000
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

; HL = record base.  A = 1 if record payload equals SRAM 0xA000..0xA0EF.
payload_equal:
    push hl
    push bc
    push de
    ld de, #0x0003
    add hl, de
    ld de, #0xA000
    ld b, #0xF0
pe_loop:
    ld a, (de)
    ld c, a
    ld a, (hl)
    cp c
    jr nz, pe_no
    inc hl
    inc de
    dec b
    jr nz, pe_loop
    ld a, #1
    jr pe_done
pe_no:
    xor a
pe_done:
    pop de
    pop bc
    pop hl
    ret

; Program A at record offset BC (relative to var_append).
; Preserves HL, BC, DE.  Uses the WRAM flash primitive.
prog_record_byte:
    push hl
    push bc
    push de
    ld (var_prog_val), a
    ld a, (var_append_lo)
    ld l, a
    ld a, (var_append_hi)
    ld h, a
    ld a, c
    add a, l
    ld l, a
    ld a, b
    adc a, h
    ld h, a
    ld a, l
    ld (var_prog_off_lo), a
    ld a, h
    ld (var_prog_off_hi), a
    call flash_prog
    pop de
    pop bc
    pop hl
    ret

; Write a new record at var_append.  The commit byte is programmed last.
write_record:
    ; checksum = 'M' + 'L' + length + sum(payload)
    ld hl, #0xA000
    ld b, #0xF0
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

    ld a, #0xF0
    ld bc, #0x0002
    call prog_record_byte

    ld hl, #0xA000
    ld bc, #0x0003
    ld d, #0xF0
wr_payload:
    ld a, (hl)
    cp #0xFF
    jr z, wr_skip
    call prog_record_byte
wr_skip:
    inc hl
    inc bc
    dec d
    jr nz, wr_payload

    ld a, (var_sum)
    ld bc, #0x00F3
    call prog_record_byte

    xor a
    ld bc, #0x00F5
    call prog_record_byte

    ld a, #0x4D
    ld bc, #0x0000
    call prog_record_byte
    ld a, #0x4C
    ld bc, #0x0001
    call prog_record_byte

    ld a, #0x5A
    ld bc, #0x00F4
    call prog_record_byte
    ret

; ---- boot restore entry -----------------------------------------
; Called from bank 0x24 boot code.  Leaves bank 0x24 selected.
journal_boot_restore:
    di
    ld a, #LOG_BANK
    ld (0x2000), a
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
    ld de, #0xA000
    ld bc, #0x00F0
jbr_copy:
    ld a, (hl)
    inc hl
    ld (de), a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, jbr_copy
jbr_done:
    ld a, #0x24
    ld (0x2000), a
    ret

; ---- save entry --------------------------------------------------
; Called from the bank-0 save hook after the original writer returns.
journal_save:
    di
    ld a, (GAME_BANK)
    ld (var_game_bank), a
    ld a, #LOG_BANK
    ld (0x2000), a
    call scan_log

    ld a, (var_last_hi)
    cp #0xFF
    jr z, js_write
    ld a, (var_last_lo)
    ld l, a
    ld a, (var_last_hi)
    ld h, a
    call payload_equal
    or a
    jr z, js_write
    jp js_finish

js_write:
    ld a, (FLASH_FLAG)
    or a
    jp z, js_finish

    ld a, (var_append_hi)
    cp #0x20
    jr c, js_append_ok
    call flash_erase
    xor a
    ld (var_append_lo), a
    ld (var_append_hi), a
js_append_ok:
    call write_record

js_finish:
    ld a, (var_game_bank)
    ld (0x2000), a
    ei
    ret

journal_end:
