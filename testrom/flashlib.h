#ifndef FLASHLIB_H
#define FLASHLIB_H

#include <stdint.h>

/* Batteryless journal for the HC007 cart, test-ROM edition.
 *
 * The log lives at chip 0x62000..0x63FFF (bank 0x18, CPU 0x6000..0x7FFF),
 * inside the 512 KiB image's 0xFF padding.  It is deliberately separate from
 * the Robbo port's log at 0x72000 so both can coexist on the same cart.
 *
 * Record (8 bytes):
 *   0 'T'  1 'F'  2 value_lo  3 value_hi
 *   4 value_lo ^ value_hi ^ 0xA5
 *   5 0x5A  6 0x00  7 0x00
 *
 * Append-only; the last valid record wins.  Value 0 is a delete tombstone.
 * The constants are programmed before the magic pair, so a torn record can
 * never validate.
 */

#define FLASH_LOG_BANK 0x18u
#define FLASH_LOG_BASE 0x6000u
#define FLASH_LOG_SIZE 0x2000u

/* 0 = MBC1, 1 = MBC3, 2 = MBC5 (read from header 0x147). */
uint8_t flash_init(void);

/* Last valid value in the log, or 0 when there is none. */
uint16_t flash_load(void);

/* Append `value`; returns 1 on success. */
uint8_t flash_store(uint16_t value);

/* Append a delete tombstone; returns 1 on success. */
uint8_t flash_clear(void);

#endif /* FLASHLIB_H */
