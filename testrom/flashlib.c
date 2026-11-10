/* Flash journal for the HC007 test ROM (bank 0).
 *
 * The read path can run from bank 0 because bank 0 stays mapped while the
 * mapper selects bank 0x18 at 0x4000..0x7FFF.  Program/erase must run from
 * WRAM because the flash chip is unreadable while busy.
 */
#include <gbdk/platform.h>
#include <stdint.h>
#include <string.h>

#include "flashlib.h"

#define FLASH_MAGIC0 'T'
#define FLASH_MAGIC1 'F'
#define FLASH_MARK   0x5Au
#define FLASH_CHK    0xA5u

static uint8_t  flash_mode;      /* 0 = MBC1, 1 = MBC3, 2 = MBC5 */
static uint8_t  flash_present;   /* ID plausible (0 in emulators) */
static uint8_t  fl_id0;
static uint8_t  fl_id1;
static uint16_t fl_off;
static uint8_t  fl_val;
static uint8_t  fl_err;
static uint8_t  fl_code[96];

/* ------------------------------------------------------------------ */
/* WRAM flash primitives                                               */
/* ------------------------------------------------------------------ */

extern uint8_t fl_id_start[], fl_id_end[];
extern uint8_t fl_prog_start[], fl_prog_end[];
extern uint8_t fl_erase_start[], fl_erase_end[];

void fl_flash_code(void);
void fl_flash_code(void)
{
    __asm

        .globl _fl_id_start, _fl_id_end
        .globl _fl_prog_start, _fl_prog_end
        .globl _fl_erase_start, _fl_erase_end

        /* --- read the manufacturer/device ID (read-only) ------------ */
        _fl_id_start:
        di
        ld  a, #0xF0
        ld  (0x4000), a
        nop
        ld  a, #0xA9
        ld  (0x0AAA), a
        nop
        ld  a, #0x56
        ld  (0x0555), a
        nop
        ld  a, #0x90
        ld  (0x0AAA), a
        nop
        ld  a, (0x0000)
        ld  (_fl_id0), a
        ld  a, (0x0001)
        ld  (_fl_id1), a
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fl_id_end:

        /* --- program one byte at 0x6000 + fl_off -------------------- */
        _fl_prog_start:
        di
        ld  a, #0xF0
        ld  (0x4000), a
        nop
        ld  a, #0xA9
        ld  (0x0AAA), a
        nop
        ld  a, #0x56
        ld  (0x0555), a
        nop
        ld  a, #0xA0
        ld  (0x0AAA), a
        nop
        ld  hl, #0x6000
        ld  a, (_fl_off)
        add a, l
        ld  l, a
        ld  a, (_fl_off+1)
        adc a, h
        ld  h, a
        ld  a, (_fl_val)
        ld  (hl), a
        ld  bc, #0xFFFF
    _fl_prog_loop:
        ld  a, (hl)
        ld  e, a
        ld  a, (_fl_val)
        xor e
        and #0x80
        jr  z, _fl_prog_done
        dec bc
        ld  a, b
        or  c
        jr  nz, _fl_prog_loop
        ld  a, #0x01
        ld  (_fl_err), a
    _fl_prog_done:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fl_prog_end:

        /* --- erase the containing sector ---------------------------- */
        _fl_erase_start:
        di
        ld  a, #0xF0
        ld  (0x4000), a
        nop
        ld  a, #0xA9
        ld  (0x0AAA), a
        nop
        ld  a, #0x56
        ld  (0x0555), a
        nop
        ld  a, #0x80
        ld  (0x0AAA), a
        nop
        ld  a, #0xA9
        ld  (0x0AAA), a
        nop
        ld  a, #0x56
        ld  (0x0555), a
        nop
        ld  a, #0x30
        ld  (0x6000), a
        ld  hl, #0x0008
    _fl_er_outer:
        ld  bc, #0xFFFF
    _fl_er_inner:
        ld  a, (0x6000)
        cp  #0xFF
        jr  z, _fl_er_done
        dec bc
        ld  a, b
        or  c
        jr  nz, _fl_er_inner
        dec hl
        ld  a, h
        or  l
        jr  nz, _fl_er_outer
        ld  a, #0x01
        ld  (_fl_err), a
    _fl_er_done:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fl_erase_end:

    __endasm;
}

static void fl_run(uint8_t *start, uint8_t *end)
{
    uint16_t len = (uint16_t)end - (uint16_t)start;

    memcpy(fl_code, start, len);

    disable_interrupts();
    ((void (*)(void))fl_code)();
    enable_interrupts();
}

/* ------------------------------------------------------------------ */
/* Mapper-aware bank selection (code runs from fixed bank 0)           */
/* ------------------------------------------------------------------ */

static void flash_select_bank(void)
{
    if (flash_mode == 0) {
        *(volatile uint8_t *)0x4000u = 0x00u;
        *(volatile uint8_t *)0x2000u = FLASH_LOG_BANK;
    } else if (flash_mode == 1) {
        *(volatile uint8_t *)0x2000u = FLASH_LOG_BANK;
    } else {
        *(volatile uint8_t *)0x3000u = 0x00u;
        *(volatile uint8_t *)0x2000u = FLASH_LOG_BANK;
    }
}

static void flash_restore_bank(void)
{
    if (flash_mode == 0) {
        *(volatile uint8_t *)0x4000u = 0x00u;
        *(volatile uint8_t *)0x2000u = 0x00u;
        *(volatile uint8_t *)0x6000u = 0x00u;   /* MBC1 mode 0 */
    } else if (flash_mode == 1) {
        *(volatile uint8_t *)0x2000u = 0x00u;
        *(volatile uint8_t *)0x4000u = 0x00u;   /* RAM bank 0 */
    } else {
        *(volatile uint8_t *)0x3000u = 0x00u;
        *(volatile uint8_t *)0x2000u = 0x00u;
        *(volatile uint8_t *)0x4000u = 0x00u;   /* RAM bank 0 */
    }
}

/* ------------------------------------------------------------------ */
/* Log access                                                          */
/* ------------------------------------------------------------------ */

static uint8_t flash_read(uint16_t off)
{
    return *(volatile uint8_t *)(FLASH_LOG_BASE + off);
}

static uint8_t flash_slot_blank(uint16_t off)
{
    uint8_t i;

    for (i = 0; i < 8u; i++) {
        if (flash_read(off + i) != 0xFFu) return 0;
    }
    return 1;
}

static uint8_t flash_slot_valid(uint16_t off, uint16_t *value)
{
    uint8_t lo = flash_read(off + 2u);
    uint8_t hi = flash_read(off + 3u);

    if (flash_read(off + 0u) != FLASH_MAGIC0 ||
        flash_read(off + 1u) != FLASH_MAGIC1 ||
        flash_read(off + 5u) != FLASH_MARK ||
        flash_read(off + 4u) != (uint8_t)(lo ^ hi ^ FLASH_CHK)) {
        return 0;
    }
    *value = (uint16_t)(((uint16_t)hi << 8) | lo);
    return 1;
}

static uint16_t flash_scan(uint16_t *append)
{
    uint16_t off;
    uint16_t best = 0;
    uint16_t value;

    flash_select_bank();
    for (off = 0; off < FLASH_LOG_SIZE; off += 8u) {
        if (flash_slot_blank(off)) break;
        if (flash_slot_valid(off, &value)) best = value;
    }
    flash_restore_bank();

    *append = off;
    return best;
}

static void flash_write_byte(uint16_t off, uint8_t value)
{
    fl_off = off;
    fl_val = value;
    fl_err = 0;
    fl_run(fl_prog_start, fl_prog_end);
}

static void flash_erase_sector(void)
{
    fl_err = 0;
    flash_select_bank();
    fl_run(fl_erase_start, fl_erase_end);
    flash_restore_bank();
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

uint8_t flash_init(void)
{
    uint8_t cart = *(volatile uint8_t *)0x0147u;

    if (cart <= 0x03u) {
        flash_mode = 0;                         /* ROM only / MBC1 */
    } else if (cart >= 0x0Fu && cart <= 0x13u) {
        flash_mode = 1;                         /* MBC3 */
    } else {
        flash_mode = 2;                         /* MBC5 */
    }

    fl_run(fl_id_start, fl_id_end);
    flash_present = (uint8_t)(fl_id0 == 0x20u || fl_id0 == 0x01u ||
                              fl_id0 == 0x1Fu || fl_id0 == 0xBFu ||
                              fl_id0 == 0xC2u);
    flash_restore_bank();
    return flash_mode;
}

uint16_t flash_load(void)
{
    uint16_t append;

    return flash_scan(&append);
}

uint8_t flash_store(uint16_t value)
{
    uint16_t append;
    uint16_t best;

    if (!flash_present) return 0;

    best = flash_scan(&append);

    if (append >= FLASH_LOG_SIZE) {
        flash_erase_sector();
        append = 0;
        best = 0;
    }
    if (value == best) return 1;

    flash_select_bank();
    /* Constants and payload first; the magic pair is programmed last so a
     * torn record can never validate. */
    flash_write_byte(append + 4u, (uint8_t)((value & 0xFFu) ^ (value >> 8) ^ FLASH_CHK));
    flash_write_byte(append + 5u, FLASH_MARK);
    flash_write_byte(append + 2u, (uint8_t)(value & 0xFFu));
    flash_write_byte(append + 3u, (uint8_t)(value >> 8));
    flash_write_byte(append + 6u, 0x00u);
    flash_write_byte(append + 7u, 0x00u);
    flash_write_byte(append + 0u, FLASH_MAGIC0);
    flash_write_byte(append + 1u, FLASH_MAGIC1);
    flash_restore_bank();

    return (uint8_t)(flash_load() == value);
}

uint8_t flash_clear(void)
{
    return flash_store(0);
}
