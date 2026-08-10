import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from '../relativeTime.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-04T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatRelativeTime', () => {
  describe('null/invalid inputs', () => {
    it('returns null for null input', () => {
      expect(formatRelativeTime(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(formatRelativeTime(undefined)).toBeNull();
    });

    it('returns null for invalid date string', () => {
      expect(formatRelativeTime('not-a-date')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(formatRelativeTime('')).toBeNull();
    });
  });

  describe('seconds range', () => {
    it('returns "just now" for exactly now', () => {
      expect(formatRelativeTime(new Date(Date.now()))).toBe('just now');
    });

    it('returns "just now" for less than 10 seconds ago', () => {
      expect(formatRelativeTime(new Date(Date.now() - 5_000))).toBe('just now');
    });

    it('returns "just now" for 9 seconds ago', () => {
      expect(formatRelativeTime(new Date(Date.now() - 9_000))).toBe('just now');
    });

    it('returns seconds for exactly 10 seconds ago', () => {
      expect(formatRelativeTime(new Date(Date.now() - 10_000))).toBe('10s ago');
    });

    it('returns seconds for 45 seconds ago', () => {
      expect(formatRelativeTime(new Date(Date.now() - 45_000))).toBe('45s ago');
    });

    it('returns seconds for 59 seconds ago', () => {
      expect(formatRelativeTime(new Date(Date.now() - 59_000))).toBe('59s ago');
    });
  });

  describe('minutes range', () => {
    it('returns minutes for exactly 1 minute', () => {
      expect(formatRelativeTime(new Date(Date.now() - 60_000))).toBe('1m ago');
    });

    it('returns minutes for 30 minutes', () => {
      expect(formatRelativeTime(new Date(Date.now() - 30 * 60_000))).toBe('30m ago');
    });

    it('returns minutes for 59 minutes', () => {
      expect(formatRelativeTime(new Date(Date.now() - 59 * 60_000))).toBe('59m ago');
    });
  });

  describe('hours range', () => {
    it('returns hours for exactly 1 hour', () => {
      expect(formatRelativeTime(new Date(Date.now() - 60 * 60_000))).toBe('1h ago');
    });

    it('returns hours for 12 hours', () => {
      expect(formatRelativeTime(new Date(Date.now() - 12 * 60 * 60_000))).toBe('12h ago');
    });

    it('returns hours for 23 hours', () => {
      expect(formatRelativeTime(new Date(Date.now() - 23 * 60 * 60_000))).toBe('23h ago');
    });
  });

  describe('days range', () => {
    it('returns days for exactly 1 day', () => {
      expect(formatRelativeTime(new Date(Date.now() - 24 * 60 * 60_000))).toBe('1d ago');
    });

    it('returns days for 6 days', () => {
      expect(formatRelativeTime(new Date(Date.now() - 6 * 24 * 60 * 60_000))).toBe('6d ago');
    });

    it('returns days for 30 days', () => {
      expect(formatRelativeTime(new Date(Date.now() - 30 * 24 * 60 * 60_000))).toBe('30d ago');
    });
  });

  describe('input types', () => {
    it('accepts ISO date strings', () => {
      expect(formatRelativeTime('2026-04-04T11:55:00Z')).toBe('5m ago');
    });

    it('accepts Date objects', () => {
      expect(formatRelativeTime(new Date('2026-04-04T11:30:00Z'))).toBe('30m ago');
    });
  });

  describe('edge cases', () => {
    it('treats future dates as "just now" (clamped to 0)', () => {
      expect(formatRelativeTime(new Date(Date.now() + 60_000))).toBe('just now');
    });
  });
});
