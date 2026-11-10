/* HC007 journal blob (injected into bank 0 at 0x2000).
 *
 * Not a standalone ROM.  The patcher copies 0x2000..0x3FFF from the built
 * image into a target ROM and patches:
 *   0x100 -> jp j_boot
 *   0x40  -> jp j_vblank
 *
 * Boot: scan the flash log and restore SRAM pages before the game starts.
 * VBlank: checksum one SRAM page per frame; after the SRAM has been stable
 * for ~1 s, append changed pages to the log, 4 bytes per frame.
 *
 * Log: bank 0x18, CPU 0x6000..0x7FFF, chip 0x62000..0x63FFF.
 * Record (261 bytes):
 *   0 'J'  1 'P'  2 page  3..258 data  259 checksum  260 0x5A
 * checksum = page ^ 0xA5 + sum(data), modulo 256.
 *
 * Prototype limitations:
 *   - restores ROM bank 0 after flash writes (target games must keep bank 0
 *     selected at VBlank; the plain test ROM does);
 *   - assumes SRAM bank 0 (8 KiB verified on this cart);
 *   - a full log stops journaling (reflash to reset the sector).
 */
#include <stdint.h>

#define LOG_BANK   0x18u
#define LOG_BASE   0x6000u
#define LOG_SIZE   0x2000u
#define REC_SIZE   261u
#define PAGE_COUNT 32u
#define SRAM_BASE  0xA000u
#define STABLE_FRAMES 60u

/* Fixed WRAM area (stack is at 0xDFFE). */
__at (0xDE00) static uint8_t  j_code[96];
__at (0xDE60) static uint8_t  j_mode;
__at (0xDE61) static uint16_t j_frames;
__at (0xDE63) static uint8_t  j_scan_page;
__at (0xDE64) static uint8_t  j_stable;
__at (0xDE65) static uint8_t  j_dirty[4];
__at (0xDE69) static uint8_t  j_wr_page;
__at (0xDE6A) static uint16_t j_wr_idx;
__at (0xDE6C) static uint8_t  j_wr_active;
__at (0xDE6D) static uint8_t  j_checksum;
__at (0xDE6E) static uint16_t j_append;
__at (0xDE70) static uint8_t  j_shadow[32];
__at (0xDE90) static uint16_t j_off;
__at (0xDE92) static uint8_t  j_val;
__at (0xDE93) static uint8_t  j_err;
__at (0xDE94) static uint8_t  j_id0;
__at (0xDE95) static uint8_t  j_id1;
__at (0xDE96) static uint8_t  j_flash_present;

/* Patched by the patcher with the game's original entry target. */
const uint16_t j_boot_default = 0x0150u;

/* The patcher copies the game's original 8-byte VBlank vector here. */
const uint8_t j_vblank_stub[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };

/* ------------------------------------------------------------------ */
/* WRAM flash primitives                                              */
/* ------------------------------------------------------------------ */

extern uint8_t j_id_start[], j_id_end[];
extern uint8_t j_prog_start[], j_prog_end[];
extern uint8_t j_erase_start[], j_erase_end[];

void j_flash_code(void);
void j_flash_code(void)
{
    __asm

        .globl _j_id_start, _j_id_end
        .globl _j_prog_start, _j_prog_end
        .globl _j_erase_start, _j_erase_end

        /* --- read the flash ID (read-only) -------------------------- */
        _j_id_start:
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
        ld  (_j_id0), a
        ld  a, (0x0001)
        ld  (_j_id1), a
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _j_id_end:

        /* --- program one byte at 0x6000 + j_off -------------------- */
        _j_prog_start:
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
        ld  a, (_j_off)
        add a, l
        ld  l, a
        ld  a, (_j_off+1)
        adc a, h
        ld  h, a
        ld  a, (_j_val)
        ld  (hl), a
        ld  bc, #0xFFFF
    _j_prog_loop:
        ld  a, (hl)
        ld  e, a
        ld  a, (_j_val)
        xor e
        and #0x80
        jr  z, _j_prog_done
        dec bc
        ld  a, b
        or  c
        jr  nz, _j_prog_loop
        ld  a, #0x01
        ld  (_j_err), a
    _j_prog_done:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _j_prog_end:

        /* --- erase the containing sector ---------------------------- */
        _j_erase_start:
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
    _j_er_outer:
        ld  bc, #0xFFFF
    _j_er_inner:
        ld  a, (0x6000)
        cp  #0xFF
        jr  z, _j_er_done
        dec bc
        ld  a, b
        or  c
        jr  nz, _j_er_inner
        dec hl
        ld  a, h
        or  l
        jr  nz, _j_er_outer
        ld  a, #0x01
        ld  (_j_err), a
    _j_er_done:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _j_erase_end:

    __endasm;
}

static void j_run(uint8_t *start, uint8_t *end)
{
    uint16_t len = (uint16_t)end - (uint16_t)start;
    uint16_t n;

    for (n = 0u; n < len; n++) j_code[n] = start[n];
    ((void (*)(void))j_code)();
}

/* ------------------------------------------------------------------ */
/* Mapper / SRAM helpers                                              */
/* ------------------------------------------------------------------ */

static void j_select_log(void)
{
    if (j_mode == 0u) {
        *(volatile uint8_t *)0x4000u = 0x00u;
        *(volatile uint8_t *)0x2000u = LOG_BANK;
    } else if (j_mode == 1u) {
        *(volatile uint8_t *)0x2000u = LOG_BANK;
    } else {
        *(volatile uint8_t *)0x3000u = 0x00u;
        *(volatile uint8_t *)0x2000u = LOG_BANK;
    }
}

static void j_restore_bank(void)
{
    if (j_mode == 0u) {
        *(volatile uint8_t *)0x4000u = 0x00u;
        *(volatile uint8_t *)0x2000u = 0x00u;
        *(volatile uint8_t *)0x6000u = 0x00u;
    } else if (j_mode == 1u) {
        *(volatile uint8_t *)0x2000u = 0x00u;
        *(volatile uint8_t *)0x4000u = 0x00u;
    } else {
        *(volatile uint8_t *)0x3000u = 0x00u;
        *(volatile uint8_t *)0x2000u = 0x00u;
        *(volatile uint8_t *)0x4000u = 0x00u;
    }
}

static uint8_t j_sram_sum(uint8_t page)
{
    uint16_t n;
    uint16_t base = (uint16_t)((uint16_t)page << 8);
    uint8_t sum = (uint8_t)(page ^ 0xA5u);

    *(volatile uint8_t *)0x0000u = 0x0Au;
    *(volatile uint8_t *)0x4000u = 0x00u;
    for (n = 0u; n < 256u; n++) {
        sum = (uint8_t)(sum + *(volatile uint8_t *)(SRAM_BASE + base + n));
    }
    /* Leave RAM enabled: this can interrupt a game mid-SRAM-write. */
    return sum;
}

static uint8_t j_sram_byte(uint8_t page, uint16_t n)
{
    uint16_t base = (uint16_t)((uint16_t)page << 8);
    uint8_t value;

    *(volatile uint8_t *)0x0000u = 0x0Au;
    *(volatile uint8_t *)0x4000u = 0x00u;
    value = *(volatile uint8_t *)(SRAM_BASE + base + n);
    return value;
}

static void j_prog_byte(uint16_t off, uint8_t value)
{
    j_off = off;
    j_val = value;
    j_err = 0u;
    j_run(j_prog_start, j_prog_end);
}

/* ------------------------------------------------------------------ */
/* Boot restore                                                       */
/* ------------------------------------------------------------------ */

void j_restore(void);
void j_restore(void)
{
    uint16_t off;
    uint16_t base;
    uint16_t n;
    uint8_t page;
    uint8_t sum;
    uint8_t p;

    j_mode = 0u;
    if (*(volatile uint8_t *)0x0147u >= 0x0Fu &&
        *(volatile uint8_t *)0x0147u <= 0x13u) {
        j_mode = 1u;
    } else if (*(volatile uint8_t *)0x0147u >= 0x19u) {
        j_mode = 2u;
    }

    j_run(j_id_start, j_id_end);
    j_flash_present = (uint8_t)(j_id0 == 0x20u || j_id0 == 0x01u ||
                                j_id0 == 0x1Fu || j_id0 == 0xBFu ||
                                j_id0 == 0xC2u);

    j_select_log();

    /* Enable SRAM bank 0 and replay the log. */
    *(volatile uint8_t *)0x0000u = 0x0Au;
    *(volatile uint8_t *)0x4000u = 0x00u;

    for (off = 0u; (uint16_t)(off + REC_SIZE) <= LOG_SIZE; off += REC_SIZE) {
        if (*(volatile uint8_t *)(LOG_BASE + off) == 0xFFu) break;
        if (*(volatile uint8_t *)(LOG_BASE + off + 0u) != 'J' ||
            *(volatile uint8_t *)(LOG_BASE + off + 1u) != 'P' ||
            *(volatile uint8_t *)(LOG_BASE + off + 260u) != 0x5Au) {
            continue;
        }
        page = *(volatile uint8_t *)(LOG_BASE + off + 2u);
        if (page >= PAGE_COUNT) continue;

        sum = (uint8_t)(page ^ 0xA5u);
        for (n = 0u; n < 256u; n++) {
            sum = (uint8_t)(sum + *(volatile uint8_t *)(LOG_BASE + off + 3u + n));
        }
        if (sum != *(volatile uint8_t *)(LOG_BASE + off + 259u)) continue;

        base = (uint16_t)((uint16_t)page << 8);
        for (n = 0u; n < 256u; n++) {
            *(volatile uint8_t *)(SRAM_BASE + base + n) =
                *(volatile uint8_t *)(LOG_BASE + off + 3u + n);
        }
    }
    *(volatile uint8_t *)0x0000u = 0x00u;

    j_append = off;
    if ((uint16_t)(off + REC_SIZE) > LOG_SIZE) {
        /* Log full: erase the sector once at boot and start over. */
        j_err = 0u;
        j_select_log();
        j_run(j_erase_start, j_erase_end);
        j_append = 0u;
    }

    j_restore_bank();

    /* The current SRAM becomes the baseline; nothing is journaled until the
     * game changes it. */
    for (p = 0u; p < PAGE_COUNT; p++) {
        j_shadow[p] = j_sram_sum(p);
    }
    j_dirty[0] = 0u;
    j_dirty[1] = 0u;
    j_dirty[2] = 0u;
    j_dirty[3] = 0u;
    j_scan_page = 0u;
    j_stable = 0u;
    j_wr_active = 0u;
    j_wr_idx = 0u;
    j_frames = 0u;
}

/* ------------------------------------------------------------------ */
/* VBlank journal                                                     */
/* ------------------------------------------------------------------ */

static void j_start_write(void)
{
    uint8_t p;

    for (p = 0u; p < PAGE_COUNT; p++) {
        if (j_dirty[p >> 3] & (uint8_t)(1u << (p & 7u))) {
            if ((uint16_t)(j_append + REC_SIZE) > LOG_SIZE) {
                j_stable = 0u;
                return;
            }
            j_wr_page = p;
            j_wr_idx = 0u;
            j_checksum = j_sram_sum(p);
            j_wr_active = 1u;
            return;
        }
    }
}

static void j_write_step(void)
{
    uint8_t n;
    uint8_t value;

    j_select_log();
    for (n = 0u; n < 4u && j_wr_idx < REC_SIZE; n++) {
        if (j_wr_idx == 0u) {
            value = 'J';
        } else if (j_wr_idx == 1u) {
            value = 'P';
        } else if (j_wr_idx == 2u) {
            value = j_wr_page;
        } else if (j_wr_idx < 259u) {
            value = j_sram_byte(j_wr_page, (uint16_t)(j_wr_idx - 3u));
        } else if (j_wr_idx == 259u) {
            value = j_checksum;
        } else {
            value = 0x5Au;
        }
        j_prog_byte((uint16_t)(j_append + j_wr_idx), value);
        j_wr_idx++;
    }
    j_restore_bank();

    if (j_wr_idx >= REC_SIZE) {
        j_dirty[j_wr_page >> 3] &=
            (uint8_t)~(uint8_t)(1u << (j_wr_page & 7u));
        j_append = (uint16_t)(j_append + REC_SIZE);
        j_wr_active = 0u;
    }
}

void j_tick(void);
void j_tick(void)
{
    uint8_t sum;

    j_frames++;
    if (!j_flash_present) return;

    if (j_wr_active) {
        j_write_step();
        return;
    }

    sum = j_sram_sum(j_scan_page);
    if (sum != j_shadow[j_scan_page]) {
        j_shadow[j_scan_page] = sum;
        j_dirty[j_scan_page >> 3] |=
            (uint8_t)(1u << (j_scan_page & 7u));
        j_stable = 0u;
    } else if (j_stable < STABLE_FRAMES) {
        j_stable++;
    }

    j_scan_page++;
    if (j_scan_page >= PAGE_COUNT) j_scan_page = 0u;

    if (j_stable >= STABLE_FRAMES) {
        j_start_write();
    }
}

/* ------------------------------------------------------------------ */
/* Entry points                                                       */
/* ------------------------------------------------------------------ */

void j_boot(void);
void j_boot(void)
{
    __asm
        ld sp, #0xE000
        push af
        push bc
        push de
        push hl
        call _j_restore
        pop hl
        pop de
        pop bc
        pop af
        ld a, (_j_boot_default)
        ld l, a
        ld a, (_j_boot_default+1)
        ld h, a
        jp (hl)
    __endasm;
}

void j_vblank(void);
void j_vblank(void)
{
    __asm
        push af
        push bc
        push de
        push hl
        call _j_tick
        pop hl
        pop de
        pop bc
        pop af
        jp _j_vblank_stub
    __endasm;
}

/* The blob is not a standalone program; this satisfies the linker. */
void main(void);
void main(void)
{
}
