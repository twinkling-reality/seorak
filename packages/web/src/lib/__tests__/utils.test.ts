import { describe, expect, it } from 'vitest';
import { formatDuration, formatDurationLong, getColorHex, COLOR_PALETTE, type ColorEntry } from '../utils.js';

describe('formatDuration', () => {
  describe('edge cases', () => {
    it('returns "<1m" for null', () => {
      expect(formatDuration(null)).toBe('<1m');
    });

    it('returns "<1m" for undefined', () => {
      expect(formatDuration(undefined)).toBe('<1m');
    });

    it('returns "<1m" for 0', () => {
      expect(formatDuration(0)).toBe('<1m');
    });

    it('returns "<1m" for negative values', () => {
      expect(formatDuration(-5)).toBe('<1m');
    });

    it('returns "<1m" for non-number types', () => {
      expect(formatDuration('hello' as any)).toBe('<1m');
    });
  });

  describe('minutes', () => {
    it('formats 1 minute', () => {
      expect(formatDuration(1)).toBe('1m');
    });

    it('formats 30 minutes', () => {
      expect(formatDuration(30)).toBe('30m');
    });

    it('formats 59 minutes', () => {
      expect(formatDuration(59)).toBe('59m');
    });

    it('rounds fractional minutes', () => {
      expect(formatDuration(1.4)).toBe('1m');
      expect(formatDuration(1.6)).toBe('2m');
    });
  });

  describe('hours and minutes', () => {
    it('formats exactly 60 minutes', () => {
      expect(formatDuration(60)).toBe('1h 0m');
    });

    it('formats 90 minutes', () => {
      expect(formatDuration(90)).toBe('1h 30m');
    });

    it('formats 150 minutes', () => {
      expect(formatDuration(150)).toBe('2h 30m');
    });

    it('formats large durations', () => {
      expect(formatDuration(600)).toBe('10h 0m');
    });
  });
});

describe('formatDurationLong', () => {
  it('reads out "less than a minute" for empty/zero/negative', () => {
    expect(formatDurationLong(null)).toBe('less than a minute');
    expect(formatDurationLong(undefined)).toBe('less than a minute');
    expect(formatDurationLong(0)).toBe('less than a minute');
    expect(formatDurationLong(-5)).toBe('less than a minute');
  });

  it('spells out minutes with correct plural', () => {
    expect(formatDurationLong(1)).toBe('1 minute');
    expect(formatDurationLong(18)).toBe('18 minutes');
    expect(formatDurationLong(59)).toBe('59 minutes');
  });

  it('drops the minutes clause on a whole hour', () => {
    expect(formatDurationLong(60)).toBe('1 hour');
    expect(formatDurationLong(120)).toBe('2 hours');
  });

  it('reads out hours and minutes together', () => {
    expect(formatDurationLong(90)).toBe('1 hour 30 minutes');
    expect(formatDurationLong(160)).toBe('2 hours 40 minutes');
    expect(formatDurationLong(61)).toBe('1 hour 1 minute');
  });
});

describe('getColorHex', () => {
  it('returns hex for all known color names', () => {
    expect(getColorHex('red')).toBe('#ff3b30');
    expect(getColorHex('cyan')).toBe('#32ced6');
    expect(getColorHex('yellow')).toBe('#ffc600');
    expect(getColorHex('green')).toBe('#28cd41');
    expect(getColorHex('magenta')).toBe('#c44dff');
    expect(getColorHex('blue')).toBe('#0a84ff');
    expect(getColorHex('orange')).toBe('#ff9f0a');
    expect(getColorHex('lime')).toBe('#30d158');
    expect(getColorHex('pink')).toBe('#ff375f');
    expect(getColorHex('sky')).toBe('#64d2ff');
    expect(getColorHex('lavender')).toBe('#7d7aff');
    expect(getColorHex('white')).toBe('#98989d');
  });

  it('returns undefined for unknown color names', () => {
    expect(getColorHex('chartreuse')).toBeUndefined();
    expect(getColorHex('')).toBeUndefined();
  });

  it('is case-sensitive (palette uses lowercase)', () => {
    expect(getColorHex('Red')).toBeUndefined();
    expect(getColorHex('RED')).toBeUndefined();
  });
});

describe('COLOR_PALETTE', () => {
  it('contains 12 entries', () => {
    expect(COLOR_PALETTE).toHaveLength(12);
  });

  it('each entry has a name and hex property', () => {
    for (const entry of COLOR_PALETTE) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.hex).toBe('string');
      expect(entry.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('has unique color names', () => {
    const names = COLOR_PALETTE.map((c: ColorEntry) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique hex values', () => {
    const hexes = COLOR_PALETTE.map((c: ColorEntry) => c.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
