/* HC007 / M29W640 flash probe (Game Boy, DMG)
 *
 * Reference copy from the Robbo port.  The mapper-aware variant used by this
 * project is probe/mapperprobe.c; build it with tools/build_probe.ps1.
 *
 * Throwaway diagnostic ROM for the bootleg "Pokemon Yellow" HC007-BGA-V2
 * board (M29W640 8 MiB flash + 32 KiB SRAM, no battery).  It answers the
 * questions we need before touching the real game:
 *
 *   1. Does the 32 KiB SRAM work (all four banks)?
 *   2. Which flash unlock bytes does the board take (0xA9/0x56 for the
 *      D0/D1-swapped HC007, or plain 0xAA/0x55)?
 *   3. Can the GB CPU program and erase a sector, and what does it read back?
 *
 * Safety:
 *   - The ID test is read-only (autoselect + reset).
 *   - Writes only ever go to CPU 0x6000 in ROM bank 0x1C, i.e. chip
 *     0x72000 (or, if this board masks the bank register, chip >= 0x2000).
 *     Never chip 0x0000-0x1FFF, which is the only part of the image that
 *     holds code: the vector table, header and all routines end below
 *     0x2000, everything above is 0xFF padding.  So even a masked-bank
 *     surprise can only erase padding, never the running probe.
 *   - All flash routines are copied to WRAM and run with interrupts
 *     disabled, because the flash is unreadable while busy.  The command
 *     sequence mirrors the hardware-proven batteryless patches (reset,
 *     unlock, command, DQ7 poll, reset; a `nop` after every flash write).
 *
 * Build: pwsh -File gb/tools/build.ps1 -FlashProbe
 * Output: roms/flashprobe.gb, roms/flashprobe.noi
 */

#include <gbdk/platform.h>
#include <gbdk/console.h>
#include <gbdk/font.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Where the tests write                                               */
/* ------------------------------------------------------------------ */

/* Bank 0x1C maps to chip 0x70000; CPU 0x6000 inside the bank maps to chip
 * 0x72000.  (0x4000..0x5FFF cannot be used for data writes: on MBC5 that
 * range is the RAM bank register.) */
#define TEST_BANK 0x1Cu
#define TEST_ADDR 0x6000u

#define PROG_DATA 0x5Au

/* ------------------------------------------------------------------ */
/* Parameters shared with the WRAM routines                            */
/* ------------------------------------------------------------------ */

static uint8_t fp_bank;
static uint8_t fp_data;
static uint8_t fp_err;
static uint8_t fp_id[4];

static uint8_t code[160];
static uint8_t variant;   /* 0 = unknown, 1 = A9/56, 2 = AA/55 */

/* ------------------------------------------------------------------ */
/* Flash routines                                                      */
/*                                                                    */
/* Assembled as part of this translation unit and copied to WRAM at    */
/* run time, so all branch offsets and the absolute addresses of the   */
/* shared variables are resolved by the assembler.  Each routine is a  */
/* plain `di` ... `ret` body, so the C copy can call it as a function  */
/* pointer.  The `_start`/`_end` labels bracket the bytes to copy.     */
/* ------------------------------------------------------------------ */

extern uint8_t fp_id_a9_start[], fp_id_a9_end[];
extern uint8_t fp_id_aa_start[], fp_id_aa_end[];
extern uint8_t fp_prog_a9_start[], fp_prog_a9_end[];
extern uint8_t fp_prog_aa_start[], fp_prog_aa_end[];
extern uint8_t fp_erase_a9_start[], fp_erase_a9_end[];
extern uint8_t fp_erase_aa_start[], fp_erase_aa_end[];

/* Never called: this exists only so the assembler emits the blobs into
 * _CODE, where run_blob() can copy them from. */
void fp_flash_code(void);
void fp_flash_code(void)
{
    __asm

        /* Exported so the linker map / .noi shows the exact blob extents. */
        .globl _fp_id_a9_start, _fp_id_a9_end
        .globl _fp_id_aa_start, _fp_id_aa_end
        .globl _fp_prog_a9_start, _fp_prog_a9_end
        .globl _fp_prog_aa_start, _fp_prog_aa_end
        .globl _fp_erase_a9_start, _fp_erase_a9_end
        .globl _fp_erase_aa_start, _fp_erase_aa_end

        /* --- read flash ID, D0/D1-swapped command set (0xA9/0x56) ---- */
        _fp_id_a9_start:
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
        ld  (_fp_id), a
        ld  a, (0x0001)
        ld  (_fp_id+1), a
        ld  a, (0x0002)
        ld  (_fp_id+2), a
        ld  a, (0x0003)
        ld  (_fp_id+3), a
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fp_id_a9_end:

        /* --- read flash ID, plain AMD command set (0xAA/0x55) ------- */
        _fp_id_aa_start:
        di
        ld  a, #0xF0
        ld  (0x4000), a
        nop
        ld  a, #0xAA
        ld  (0x0AAA), a
        nop
        ld  a, #0x55
        ld  (0x0555), a
        nop
        ld  a, #0x90
        ld  (0x0AAA), a
        nop
        ld  a, (0x0000)
        ld  (_fp_id), a
        ld  a, (0x0001)
        ld  (_fp_id+1), a
        ld  a, (0x0002)
        ld  (_fp_id+2), a
        ld  a, (0x0003)
        ld  (_fp_id+3), a
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fp_id_aa_end:

        /* --- program one byte (A9/56), then poll DQ7 ---------------- */
        _fp_prog_a9_start:
        di
        ld  a, (_fp_bank)
        ld  (0x2000), a
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
        ld  a, (_fp_data)
        ld  (0x6000), a
        ld  bc, #0xFFFF
    _fp_prog_loop_a9:
        ld  a, (0x6000)
        ld  d, a
        ld  a, (_fp_data)
        xor d
        and #0x80
        jr  z, _fp_prog_done_a9
        dec bc
        ld  a, b
        or  c
        jr  nz, _fp_prog_loop_a9
        ld  a, #0x01
        ld  (_fp_err), a
    _fp_prog_done_a9:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fp_prog_a9_end:

        /* --- program one byte (AA/55), then poll DQ7 ---------------- */
        _fp_prog_aa_start:
        di
        ld  a, (_fp_bank)
        ld  (0x2000), a
        ld  a, #0xF0
        ld  (0x4000), a
        nop
        ld  a, #0xAA
        ld  (0x0AAA), a
        nop
        ld  a, #0x55
        ld  (0x0555), a
        nop
        ld  a, #0xA0
        ld  (0x0AAA), a
        nop
        ld  a, (_fp_data)
        ld  (0x6000), a
        ld  bc, #0xFFFF
    _fp_prog_loop_aa:
        ld  a, (0x6000)
        ld  d, a
        ld  a, (_fp_data)
        xor d
        and #0x80
        jr  z, _fp_prog_done_aa
        dec bc
        ld  a, b
        or  c
        jr  nz, _fp_prog_loop_aa
        ld  a, #0x01
        ld  (_fp_err), a
    _fp_prog_done_aa:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fp_prog_aa_end:

        /* --- erase the containing sector (A9/56) -------------------- */
        _fp_erase_a9_start:
        di
        ld  a, (_fp_bank)
        ld  (0x2000), a
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
    _fp_er_outer_a9:
        ld  bc, #0xFFFF
    _fp_er_inner_a9:
        ld  a, (0x6000)
        cp  #0xFF
        jr  z, _fp_er_done_a9
        dec bc
        ld  a, b
        or  c
        jr  nz, _fp_er_inner_a9
        dec hl
        ld  a, h
        or  l
        jr  nz, _fp_er_outer_a9
        ld  a, #0x01
        ld  (_fp_err), a
    _fp_er_done_a9:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fp_erase_a9_end:

        /* --- erase the containing sector (AA/55) -------------------- */
        _fp_erase_aa_start:
        di
        ld  a, (_fp_bank)
        ld  (0x2000), a
        ld  a, #0xF0
        ld  (0x4000), a
        nop
        ld  a, #0xAA
        ld  (0x0AAA), a
        nop
        ld  a, #0x55
        ld  (0x0555), a
        nop
        ld  a, #0x80
        ld  (0x0AAA), a
        nop
        ld  a, #0xAA
        ld  (0x0AAA), a
        nop
        ld  a, #0x55
        ld  (0x0555), a
        nop
        ld  a, #0x30
        ld  (0x6000), a
        ld  hl, #0x0008
    _fp_er_outer_aa:
        ld  bc, #0xFFFF
    _fp_er_inner_aa:
        ld  a, (0x6000)
        cp  #0xFF
        jr  z, _fp_er_done_aa
        dec bc
        ld  a, b
        or  c
        jr  nz, _fp_er_inner_aa
        dec hl
        ld  a, h
        or  l
        jr  nz, _fp_er_outer_aa
        ld  a, #0x01
        ld  (_fp_err), a
    _fp_er_done_aa:
        ld  a, #0xF0
        ld  (0x4000), a
        ret
        _fp_erase_aa_end:

    __endasm;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

static void ps(const char *s)
{
    while (*s) putchar(*s++);
}

static void hex8(uint8_t v)
{
    static const char hexd[] = "0123456789ABCDEF";
    putchar(hexd[v >> 4]);
    putchar(hexd[v & 0x0Fu]);
}

static uint8_t blob_len(uint8_t *start, uint8_t *end)
{
    return (uint8_t)((uint16_t)end - (uint16_t)start);
}

static void run_blob(uint8_t *start, uint8_t *end)
{
    uint8_t len = blob_len(start, end);

    memcpy(code, start, len);

    disable_interrupts();
    ((void (*)(void))code)();
    enable_interrupts();

    /* The routine selects TEST_BANK and pokes 0xF0 at 0x4000 (the MBC5 RAM
     * bank register as well as the flash reset command), so put the mapper
     * back into the state the rest of the probe expects. */
    SWITCH_ROM_MBC5(0);
    SWITCH_RAM(0);
    DISABLE_RAM;
}

/* Read one byte of the flash window (no flash command needed). */
static uint8_t read_test_cell(void)
{
    uint8_t v;

    SWITCH_ROM_MBC5(TEST_BANK);
    v = *(volatile uint8_t *)TEST_ADDR;
    SWITCH_ROM_MBC5(0);
    return v;
}

static uint8_t id_plausible(void)
{
    /* ST/Numonyx M29W640: manufacturer 0x20.  Also accept the other
     * common NOR vendors in case the board is populated differently. */
    return (uint8_t)(fp_id[0] == 0x20u || fp_id[0] == 0x01u ||
                     fp_id[0] == 0x1Fu || fp_id[0] == 0xBFu ||
                     fp_id[0] == 0xC2u);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

void main(void)
{
    uint8_t sram_ok = 1;
    uint8_t id_a_ok;
    uint8_t id_a[4];
    uint8_t i;
    uint8_t pad;

    DISPLAY_ON;
    SHOW_BKG;

    font_init();
    font_load(font_ibm);
    cls();

    ps("FLASH PROBE\n");
    ps("HC007 / M29W640\n\n");

    /* Header sanity: 0x148 = ROM size code, 0x149 = RAM size code. */
    ps("HDR 148="); hex8(*(volatile uint8_t *)0x0148u);
    ps(" 149=");    hex8(*(volatile uint8_t *)0x0149u);
    putchar('\n');

    /* --- SRAM: four 8 KiB banks, scratch cell at 0xA7F0 -------------- */
    ENABLE_RAM;
    for (i = 0; i < 4u; i++) {
        SWITCH_RAM(i);
        *(volatile uint8_t *)0xA7F0u = (uint8_t)(0x5Au + i);
    }
    for (i = 0; i < 4u; i++) {
        SWITCH_RAM(i);
        if (*(volatile uint8_t *)0xA7F0u != (uint8_t)(0x5Au + i)) sram_ok = 0;
    }
    DISABLE_RAM;
    ps("SRAM4: "); ps(sram_ok ? "OK" : "FAIL"); putchar('\n');

    /* --- Flash ID, read-only ---------------------------------------- */
    run_blob(fp_id_a9_start, fp_id_a9_end);
    id_a_ok = id_plausible();
    for (i = 0; i < 4u; i++) id_a[i] = fp_id[i];

    ps("ID A9: ");
    hex8(fp_id[0]); putchar(' '); hex8(fp_id[1]); putchar(' ');
    hex8(fp_id[2]); putchar(' '); hex8(fp_id[3]); putchar('\n');

    run_blob(fp_id_aa_start, fp_id_aa_end);
    ps("ID AA: ");
    hex8(fp_id[0]); putchar(' '); hex8(fp_id[1]); putchar(' ');
    hex8(fp_id[2]); putchar(' '); hex8(fp_id[3]); putchar('\n');

    if (id_a_ok) {
        variant = 1;
        ps("VAR: A9/56\n");
    } else if (id_plausible()) {
        variant = 2;
        ps("VAR: AA/55\n");
    } else {
        variant = 0;
        ps("VAR: NONE\n");
    }

    if (variant == 1 && id_a[0] != 0x20u) {
        /* Still usable, but note it for the transcript. */
        ps("(not 0x20)\n");
    }

    /* --- Current byte in the test sector ----------------------------- */
    ps("SECTOR: "); hex8(read_test_cell()); putchar('\n');

    ps("\nA=PROG B=ERASE\n");
    ps("SECTOR 1C @72000\n");
    if (!variant) ps("WRITE DISABLED\n");

    for (;;) {
        pad = joypad();

        if ((pad & J_A) && variant) {
            fp_err = 0;
            fp_bank = TEST_BANK;
            fp_data = PROG_DATA;
            if (variant == 1) {
                run_blob(fp_prog_a9_start, fp_prog_a9_end);
            } else {
                run_blob(fp_prog_aa_start, fp_prog_aa_end);
            }
            ps("PROG err="); hex8(fp_err);
            ps(" rd="); hex8(read_test_cell()); putchar('\n');
            waitpadup();
        }

        if ((pad & J_B) && variant) {
            fp_err = 0;
            fp_bank = TEST_BANK;
            ps("ERASING...\n");
            if (variant == 1) {
                run_blob(fp_erase_a9_start, fp_erase_a9_end);
            } else {
                run_blob(fp_erase_aa_start, fp_erase_aa_end);
            }
            ps("ERASE err="); hex8(fp_err);
            ps(" rd="); hex8(read_test_cell()); putchar('\n');
            waitpadup();
        }

        if (pad & J_START) {
            cls();
            ps("FLASH PROBE\n");
            ps("VAR: ");
            ps(variant == 1 ? "A9/56" : (variant == 2 ? "AA/55" : "NONE"));
            ps("\nSECTOR: "); hex8(read_test_cell()); putchar('\n');
            waitpadup();
        }

        wait_vbl_done();
    }
}
