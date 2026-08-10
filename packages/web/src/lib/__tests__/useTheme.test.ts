// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { themeActions } from '../useTheme.js';

const STORAGE_KEY = 'seorak:theme';

describe('useTheme store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    themeActions.disposeForTests();
    themeActions.resetForTests('light', 'light');
  });

  afterEach(() => {
    themeActions.disposeForTests();
    localStorage.clear();
  });

  it('persists preference to localStorage on setTheme', () => {
    themeActions.setTheme('dark');
    expect(themeActions.getState().preference).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('applies resolved theme to documentElement', () => {
    themeActions.setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves system preference from systemTheme', () => {
    themeActions.resetForTests('system', 'dark');
    const { preference, systemTheme } = themeActions.getState();
    expect(preference).toBe('system');
    expect(systemTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('keeps a single preference visible to all readers', () => {
    themeActions.setTheme('dark');
    expect(themeActions.getState().preference).toBe('dark');

    themeActions.setTheme('system');
    expect(themeActions.getState().preference).toBe('system');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
  });
});
