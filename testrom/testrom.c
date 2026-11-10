/* HC007 batteryless save test ROM.
 *
 * A visible 16-bit counter with two storage paths:
 *   - the cart's 8 KiB SRAM bank 0 (volatile, lost at power-off),
 *   - an append-only flash journal at bank 0x18 / chip 0x62000.
 *
 * A     increment, write SRAM, append the flash record
 * B     reload both values (shows what actually persisted)
 * START clear both (flash gets a level-0 tombstone)
 *
 * Build: pwsh -File tools/build_testrom.ps1
 * Outputs: roms/testrom-mbc1.gb, -mbc3.gb, -mbc5.gb
 */
#include <gbdk/platform.h>
#include <gbdk/console.h>
#include <gbdk/font.h>
#include <stdint.h>
#include <stdio.h>

#include "flashlib.h"

#define SRAM_BASE 0xA100u
#define SRAM_MAGIC0 'T'
#define SRAM_MAGIC1 'S'
#define SRAM_MARK   0x5Au
#define SRAM_CHK    0xA5u

/* Global so the reader tests can read them through the .noi symbols. */
uint16_t counter;
uint16_t flash_value;
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

static void draw(void)
{
    gotoxy(0, 0); ps("HC007 SAVE TEST   ");
    gotoxy(0, 1); ps("MODE: "); ps(mode_name);
    gotoxy(0, 2); ps("COUNTER: "); print_hex16(counter);
    gotoxy(0, 3); ps("FLASH:   "); print_hex16(flash_value);
    gotoxy(0, 4); ps("SRAM:    "); print_hex16(sram_value);
    gotoxy(0, 5); ps("SAVE: ");
    ps(save_state == 1u ? "OK  " : (save_state == 2u ? "FAIL" : "--  "));
    gotoxy(0, 7); ps("A=SAVE B=RELOAD");
    gotoxy(0, 8); ps("START=CLEAR");
}

void main(void)
{
    uint8_t pad;

    DISPLAY_ON;
    SHOW_BKG;

    font_init();
    font_load(font_ibm);
    cls();

    mapper_mode = flash_init();
    mode_name = (mapper_mode == 0u) ? "MBC1" :
                (mapper_mode == 1u) ? "MBC3" : "MBC5";

    flash_value = flash_load();
    sram_value = sram_load();
    counter = flash_value ? flash_value : sram_value;
    if (counter == 0u) counter = 1u;
    save_state = 0u;
    draw();

    for (;;) {
        pad = joypad();

        if (pad & J_A) {
            counter++;
            sram_store(counter);
            save_state = flash_store(counter) ? 1u : 2u;
            flash_value = flash_load();
            sram_value = sram_load();
            draw();
            waitpadup();
        }

        if (pad & J_B) {
            flash_value = flash_load();
            sram_value = sram_load();
            counter = flash_value ? flash_value :
                      (sram_value ? sram_value : 1u);
            draw();
            waitpadup();
        }

        if (pad & J_START) {
            sram_clear();
            save_state = flash_clear() ? 1u : 2u;
            flash_value = flash_load();
            sram_value = 0u;
            counter = 1u;
            draw();
            waitpadup();
        }

        wait_vbl_done();
    }
}
