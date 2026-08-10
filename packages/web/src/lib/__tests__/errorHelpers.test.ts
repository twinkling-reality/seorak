import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../errorHelpers.js';

describe('getErrorMessage', () => {
  describe('with Error instances', () => {
    it('returns message from Error instances', () => {
      expect(getErrorMessage(new Error('boom'))).toBe('boom');
    });

    it('returns fallback for Error with empty message', () => {
      expect(getErrorMessage(new Error(''))).toBe('Something went wrong');
    });

    it('uses custom fallback for Error with empty message', () => {
      expect(getErrorMessage(new Error(''), 'Fallback')).toBe('Fallback');
    });

    it('ignores custom fallback when Error has a message', () => {
      expect(getErrorMessage(new Error('real error'), 'Fallback')).toBe('real error');
    });

    it('handles TypeError', () => {
      expect(getErrorMessage(new TypeError('type issue'))).toBe('type issue');
    });

    it('handles RangeError', () => {
      expect(getErrorMessage(new RangeError('out of range'))).toBe('out of range');
    });
  });

  describe('with string values', () => {
    it('returns the string directly', () => {
      expect(getErrorMessage('network failure')).toBe('network failure');
    });

    it('returns empty string for empty string input', () => {
      expect(getErrorMessage('')).toBe('');
    });
  });

  describe('with unknown types', () => {
    it('returns fallback for null', () => {
      expect(getErrorMessage(null)).toBe('Something went wrong');
    });

    it('returns fallback for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('Something went wrong');
    });

    it('returns fallback for numbers', () => {
      expect(getErrorMessage(42)).toBe('Something went wrong');
    });

    it('returns fallback for plain objects', () => {
      expect(getErrorMessage({ message: 'not an Error instance' })).toBe('Something went wrong');
    });

    it('returns fallback for boolean values', () => {
      expect(getErrorMessage(true)).toBe('Something went wrong');
    });

    it('returns fallback for arrays', () => {
      expect(getErrorMessage([1, 2, 3])).toBe('Something went wrong');
    });

    it('returns fallback for symbols', () => {
      expect(getErrorMessage(Symbol('test'))).toBe('Something went wrong');
    });
  });

  describe('custom fallback', () => {
    it('uses custom fallback for null', () => {
      expect(getErrorMessage(null, 'Custom error')).toBe('Custom error');
    });

    it('uses custom fallback for undefined', () => {
      expect(getErrorMessage(undefined, 'Oops')).toBe('Oops');
    });

    it('uses custom fallback for numbers', () => {
      expect(getErrorMessage(42, 'Bad input')).toBe('Bad input');
    });
  });
});
