import { describe, expect, it } from 'vitest';

import { catalogHotkeyAction, type CatalogKeyEvent } from '../catalogHotkeys.js';

const key = (over: Partial<CatalogKeyEvent>): CatalogKeyEvent => ({
  key: 'a',
  shiftKey: false,
  inTextInput: false,
  ...over,
});

describe('catalogHotkeyAction', () => {
  it('closes the picker on Escape', () => {
    expect(catalogHotkeyAction(key({ key: 'Escape' }))).toEqual({ type: 'close' });
  });

  it('toggles search, show, and viz filters', () => {
    expect(catalogHotkeyAction(key({ key: '/' }))).toEqual({ type: 'toggle-search' });
    expect(catalogHotkeyAction(key({ key: 'Tab' }))).toEqual({ type: 'cycle-show' });
    expect(catalogHotkeyAction(key({ key: 't' }))).toEqual({ type: 'cycle-viz' });
    expect(catalogHotkeyAction(key({ key: 'T', shiftKey: true }))).toEqual({ type: 'cycle-viz' });
  });

  it('walks categories with the arrow keys', () => {
    expect(catalogHotkeyAction(key({ key: 'ArrowLeft' }))).toEqual({
      type: 'cycle-category',
      dir: -1,
    });
    expect(catalogHotkeyAction(key({ key: 'ArrowRight' }))).toEqual({
      type: 'cycle-category',
      dir: 1,
    });
  });

  describe('destructive keys are gated behind shift', () => {
    it('fires clear-all only for Shift+C', () => {
      expect(catalogHotkeyAction(key({ key: 'C', shiftKey: true }))).toEqual({ type: 'clear-all' });
      expect(catalogHotkeyAction(key({ key: 'C', shiftKey: false }))).toBeNull();
      expect(catalogHotkeyAction(key({ key: 'c' }))).toBeNull();
      expect(catalogHotkeyAction(key({ key: 'c', shiftKey: true }))).toBeNull();
    });

    it('does not claim clear-all when the dashboard is already empty', () => {
      expect(
        catalogHotkeyAction(key({ key: 'C', shiftKey: true }), {
          canClearAll: false,
          canAddWidgets: true,
        }),
      ).toBeNull();
    });

    it('fires reset-to-default only for Shift+V', () => {
      expect(catalogHotkeyAction(key({ key: 'V', shiftKey: true }))).toEqual({
        type: 'reset-to-default',
      });
      expect(catalogHotkeyAction(key({ key: 'V', shiftKey: false }))).toBeNull();
      expect(catalogHotkeyAction(key({ key: 'v' }))).toBeNull();
      expect(catalogHotkeyAction(key({ key: 'v', shiftKey: true }))).toBeNull();
    });
  });

  describe('bulk add', () => {
    it('fires add-widgets only for Shift+A', () => {
      expect(catalogHotkeyAction(key({ key: 'A', shiftKey: true }))).toEqual({
        type: 'add-widgets',
      });
      expect(catalogHotkeyAction(key({ key: 'A', shiftKey: false }))).toBeNull();
      expect(catalogHotkeyAction(key({ key: 'a' }))).toBeNull();
      expect(catalogHotkeyAction(key({ key: 'a', shiftKey: true }))).toBeNull();
    });

    it('does not claim Shift+A when no eligible inactive match remains', () => {
      expect(
        catalogHotkeyAction(key({ key: 'A', shiftKey: true }), {
          canClearAll: true,
          canAddWidgets: false,
        }),
      ).toBeNull();
    });
  });

  describe('typing in the search field', () => {
    it('closes search on Escape', () => {
      expect(catalogHotkeyAction(key({ key: 'Escape', inTextInput: true }))).toEqual({
        type: 'close-search',
      });
    });

    it('lets every other key through to the input, including the destructive ones', () => {
      for (const k of [
        'A',
        'a',
        'C',
        'V',
        'v',
        'c',
        't',
        '/',
        'Tab',
        'ArrowLeft',
        'ArrowRight',
      ]) {
        expect(catalogHotkeyAction(key({ key: k, inTextInput: true, shiftKey: true }))).toBeNull();
      }
    });
  });

  it('claims nothing it does not own, so unmapped keys still reach the browser', () => {
    expect(catalogHotkeyAction(key({ key: 'q' }))).toBeNull();
    expect(catalogHotkeyAction(key({ key: 'Enter' }))).toBeNull();
    expect(catalogHotkeyAction(key({ key: ' ' }))).toBeNull();
  });
});
