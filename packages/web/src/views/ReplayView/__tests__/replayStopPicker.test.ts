import { describe, expect, it } from 'vitest';

import { stopModeTriggerLabel } from '../stage/ReplayStopPicker.js';

describe('stopModeTriggerLabel', () => {
  it('reads Continuous without auto-pause prefix', () => {
    expect(stopModeTriggerLabel('off')).toBe('Continuous');
  });

  it('prefixes auto-pause modes with middle dot separator', () => {
    expect(stopModeTriggerLabel('highlights')).toBe('Auto-pause, Highlights');
    expect(stopModeTriggerLabel('moments')).toBe('Auto-pause, All moments');
  });
});
