import { describe, expect, it } from 'vitest';
import { isQuietHour, nextAllowedTime, parseDurations, parseQuietHours } from './time';

// Asia/Dubai is UTC+4 all year (no DST): 22:00 Dubai = 18:00Z, 08:00 Dubai = 04:00Z.
const dubai = (hhmm: string, day = '2026-03-10') => new Date(`${day}T${hhmm}:00+04:00`);

describe('isQuietHour (22:00-08:00 Asia/Dubai)', () => {
  it.each([
    ['21:59', false],
    ['22:00', true],
    ['23:30', true],
    ['00:00', true],
    ['03:15', true],
    ['07:59', true],
    ['08:00', false],
    ['12:00', false],
  ])('%s → %s', (t, quiet) => expect(isQuietHour(dubai(t))).toBe(quiet));

  it('handles same-day windows and the no-quiet-hours case', () => {
    expect(isQuietHour(dubai('13:30'), '13:00-14:00')).toBe(true);
    expect(isQuietHour(dubai('14:00'), '13:00-14:00')).toBe(false);
    expect(isQuietHour(dubai('03:00'), '00:00-00:00')).toBe(false);
  });

  it('respects the time zone', () => {
    const t = new Date('2026-03-10T19:00:00Z'); // 23:00 Dubai, 19:00 London
    expect(isQuietHour(t, '22:00-08:00', 'Asia/Dubai')).toBe(true);
    expect(isQuietHour(t, '22:00-08:00', 'Europe/London')).toBe(false);
  });
});

describe('nextAllowedTime', () => {
  it('returns the same instant outside quiet hours', () => {
    const t = dubai('10:00');
    expect(nextAllowedTime(t)).toBe(t);
  });
  it('moves late-evening and early-morning times to 08:00 Dubai', () => {
    expect(nextAllowedTime(dubai('23:10')).toISOString()).toBe(
      dubai('08:00', '2026-03-11').toISOString(),
    );
    expect(nextAllowedTime(dubai('03:45')).toISOString()).toBe(dubai('08:00').toISOString());
  });
});

describe('parsing', () => {
  it('parses duration lists', () => {
    expect(parseDurations('30s, 10m,1h,2d')).toEqual([30_000, 600_000, 3_600_000, 172_800_000]);
    expect(() => parseDurations('1h,soon')).toThrow(/Invalid duration "soon"/);
    expect(() => parseDurations('0m')).toThrow();
  });
  it('parses quiet hours', () => {
    expect(parseQuietHours('22:00-08:00')).toEqual([1320, 480]);
    expect(() => parseQuietHours('10pm-8am')).toThrow(/HH:MM-HH:MM/);
    expect(() => parseQuietHours('25:00-08:00')).toThrow();
  });
});
