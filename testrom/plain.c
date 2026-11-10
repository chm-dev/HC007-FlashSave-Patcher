/* HC007 plain save test ROM (patcher target).
 *
 * Same counter UI as the full test ROM, but *without* the flash journal.  The
 * patcher is supposed to inject the journal into this ROM:
 *   - boot restore at 0x100,
 *   - VBlank hook,
 *   - flash driver.
 *
 * Build: pwsh -File tools/build_plain.ps1
 * Outputs: roms/plain-mbc1.gb, -mbc3.gb, -mbc5.gb
 */
#include <gbdk/platform.h>
#include <gbdk/console.h>
#include <gbdk/font.h>
#include <stdint.h>
#include <stdio.h>

#define SRAM_BASE 0xA100u
#define SRAM_MAGIC0 'P'
#define SRAM_MAGIC1 'S'
#define SRAM_MARK   0x5Au
#define SRAM_CHK    0xA5u

/* Global so tests can read them through the .noi symbols. */
uint16_t counter;
uint16_t sram_value;
uint8_t  mapper_mode;
uint8_t  save_state;   /* 0 = unknown, 1 = OK, 2 = FAIL */

static const char *mode_name = "?";

static void ps(const char *s)
{
    while (*s) putchar(*s++);
}

static void print_hex16(uint16_t value)
{
    static const char hex[] = "0123456789ABCDEF";

    putchar(hex[(value >> 12) & 0x0Fu]);
    putchar(hex[(value >> 8) & 0x0Fu]);
    putchar(hex[(value >> 4) & 0x0Fu]);
    putchar(hex[value & 0x0Fu]);
}

static uint16_t sram_load(void)
{
    uint8_t lo, hi;

    ENABLE_RAM;
    SWITCH_RAM(0);
    if (*(volatile uint8_t *)(SRAM_BASE + 0u) != SRAM_MAGIC0 ||
        *(volatile uint8_t *)(SRAM_BASE + 1u) != SRAM_MAGIC1 ||
        *(volatile uint8_t *)(SRAM_BASE + 5u) != SRAM_MARK) {
        DISABLE_RAM;
        return 0;
    }
    lo = *(volatile uint8_t *)(SRAM_BASE + 2u);
    hi = *(volatile uint8_t *)(SRAM_BASE + 3u);
    if (*(volatile uint8_t *)(SRAM_BASE + 4u) != (uint8_t)(lo ^ hi ^ SRAM_CHK)) {
        DISABLE_RAM;
        return 0;
    }
    DISABLE_RAM;
    return (uint16_t)(((uint16_t)hi << 8) | lo);
}

static void sram_store(uint16_t value)
{
    uint8_t lo = (uint8_t)(value & 0xFFu);
    uint8_t hi = (uint8_t)(value >> 8);

    ENABLE_RAM;
    SWITCH_RAM(0);
    *(volatile uint8_t *)(SRAM_BASE + 4u) = (uint8_t)(lo ^ hi ^ SRAM_CHK);
    *(volatile uint8_t *)(SRAM_BASE + 5u) = SRAM_MARK;
    *(volatile uint8_t *)(SRAM_BASE + 2u) = lo;
    *(volatile uint8_t *)(SRAM_BASE + 3u) = hi;
    *(volatile uint8_t *)(SRAM_BASE + 6u) = 0x00u;
    *(volatile uint8_t *)(SRAM_BASE + 7u) = 0x00u;
    *(volatile uint8_t *)(SRAM_BASE + 0u) = SRAM_MAGIC0;
    *(volatile uint8_t *)(SRAM_BASE + 1u) = SRAM_MAGIC1;
    DISABLE_RAM;
}

static void sram_clear(void)
{
    uint8_t i;

    ENABLE_RAM;
    SWITCH_RAM(0);
    for (i = 0; i < 8u; i++) {
        *(volatile uint8_t *)(SRAM_BASE + i) = 0x00u;
    }
    DISABLE_RAM;
}

/* Journal blob state (patched ROMs only; garbage on an unpatched ROM). */
#define JB(a) (*(volatile uint8_t *)(a))

static void draw_debug(void)
{
    gotoxy(0, 9);  ps("ID:"); print_hex16((uint16_t)(JB(0xDE94) << 8 | JB(0xDE95)));
    ps(" FP:"); print_hex16(JB(0xDE96));
    gotoxy(0, 10); ps("AP:"); print_hex16((uint16_t)(JB(0xDE6F) << 8 | JB(0xDE6E)));
    ps(" ER:"); print_hex16(JB(0xDE93));
    gotoxy(0, 11); ps("ST:"); print_hex16(JB(0xDE64));
    ps(" WA:"); print_hex16(JB(0xDE6C));
    gotoxy(0, 12); ps("FR:"); print_hex16((uint16_t)(JB(0xDE62) << 8 | JB(0xDE61)));
    ps(" DR:"); print_hex16((uint16_t)(JB(0xDE65) << 8 | JB(0xDE66)));
}

static void draw(void)
{
    gotoxy(0, 0); ps("HC007 PLAIN SAVE  ");
    gotoxy(0, 1); ps("MODE: "); ps(mode_name);
    gotoxy(0, 2); ps("COUNTER: "); print_hex16(counter);
    gotoxy(0, 3); ps("SRAM:    "); print_hex16(sram_value);
    gotoxy(0, 4); ps("SAVE: ");
    ps(save_state == 1u ? "OK  " : (save_state == 2u ? "FAIL" : "--  "));
    gotoxy(0, 6); ps("A=SAVE B=RELOAD");
    gotoxy(0, 7); ps("START=CLEAR");
}

void main(void)
{
    uint8_t pad;
    uint8_t cart;
    uint8_t dbg = 0u;

    DISPLAY_ON;
    SHOW_BKG;

    font_init();
    font_load(font_ibm);
    cls();

    cart = *(volatile uint8_t *)0x0147u;
    mapper_mode = (cart <= 0x03u) ? 0u :
                  (cart >= 0x0Fu && cart <= 0x13u) ? 1u : 2u;
    mode_name = (mapper_mode == 0u) ? "MBC1" :
                (mapper_mode == 1u) ? "MBC3" : "MBC5";

    sram_value = sram_load();
    counter = sram_value ? sram_value : 1u;
    save_state = 0u;
    draw();

    for (;;) {
        pad = joypad();

        if (pad & J_A) {
            counter++;
            sram_store(counter);
            sram_value = sram_load();
            save_state = 1u;
            draw();
            waitpadup();
        }

        if (pad & J_B) {
            sram_value = sram_load();
            counter = sram_value ? sram_value : 1u;
            draw();
            waitpadup();
        }

        if (pad & J_START) {
            sram_clear();
            sram_value = 0u;
            counter = 1u;
            save_state = 1u;
            draw();
            waitpadup();
        }

        if ((++dbg & 0x0Fu) == 0u) draw_debug();
        wait_vbl_done();
    }
}
