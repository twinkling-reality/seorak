// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stage 7: demo is gated so a shared ?demo=<scenario> URL cannot surface
// synthetic data on the LIVE production dashboard. Dev always allows it; a
// production build allows it only behind the explicit VITE_ENABLE_DEMO flag.
//
// buildEnv is mocked because import.meta.env.DEV is a build-time constant Vite
// inlines per-module (un-flippable at runtime); the mock lets us simulate dev,
// plain-production, and flag-enabled-staging builds deterministically.
const mockIsDevBuild = vi.fn<() => boolean>();
const mockIsDemoFlagEnabled = vi.fn<() => boolean>();
vi.mock('../buildEnv.js', () => ({
  isDevBuild: () => mockIsDevBuild(),
  isDemoFlagEnabled: () => mockIsDemoFlagEnabled(),
}));

import { demoAllowed, isDemoActive, shouldShowDemoSwitcher } from '../demoMode.js';

/** Simulate a build: dev, plain production, or flag-enabled staging. */
function setBuild(kind: 'dev' | 'production' | 'staging-flag'): void {
  mockIsDevBuild.mockReturnValue(kind === 'dev');
  mockIsDemoFlagEnabled.mockReturnValue(kind === 'staging-flag');
}

beforeEach(() => {
  setBuild('production');
  window.history.replaceState(null, '', '/dashboard');
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/dashboard');
});

describe('demoAllowed — build gate', () => {
  it('allows demo in dev builds', () => {
    setBuild('dev');
    expect(demoAllowed()).toBe(true);
  });

  it('blocks demo in a plain production build', () => {
    setBuild('production');
    expect(demoAllowed()).toBe(false);
  });

  it('allows demo in production only behind the explicit VITE_ENABLE_DEMO flag', () => {
    setBuild('staging-flag');
    expect(demoAllowed()).toBe(true);
  });
});

describe('isDemoActive — production ignores ?demo', () => {
  it('a shared ?demo URL does NOT activate demo in production (live path stays real)', () => {
    setBuild('production');
    window.history.replaceState(null, '', '/dashboard?demo=high-cost');
    expect(isDemoActive()).toBe(false);
  });

  it('?demo activates demo in dev', () => {
    setBuild('dev');
    window.history.replaceState(null, '', '/dashboard?demo=high-cost');
    expect(isDemoActive()).toBe(true);
  });

  it('?demo activates demo in a flag-enabled staging build', () => {
    setBuild('staging-flag');
    window.history.replaceState(null, '', '/dashboard?demo=healthy');
    expect(isDemoActive()).toBe(true);
  });

  it('no ?demo means no demo even where allowed', () => {
    setBuild('dev');
    window.history.replaceState(null, '', '/dashboard');
    expect(isDemoActive()).toBe(false);
  });
});

describe('shouldShowDemoSwitcher — hidden in production', () => {
  it('hidden in a plain production build', () => {
    setBuild('production');
    expect(shouldShowDemoSwitcher()).toBe(false);
  });

  it('shown wherever demo is allowed', () => {
    setBuild('dev');
    expect(shouldShowDemoSwitcher()).toBe(true);
  });
});
