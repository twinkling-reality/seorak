import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTURE_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS } from '@seorak/types';
import {
  countAlertsOn,
  countCaptureOn,
  formatToggleCount,
  SETTINGS_SECTION_TABS,
} from './settingsTabSummaries.js';

describe('settingsTabSummaries', () => {
  it('counts enabled capture toggles', () => {
    expect(countCaptureOn(DEFAULT_CAPTURE_SETTINGS)).toBe(3);
    expect(
      countCaptureOn({
        ...DEFAULT_CAPTURE_SETTINGS,
        lineCounts: false,
        gitMomentum: false,
        fileSignals: false,
        fileLabels: false,
      }),
    ).toBe(0);
  });

  it('counts enabled alert watches', () => {
    expect(countAlertsOn(DEFAULT_NOTIFICATION_SETTINGS)).toBe(5);
  });

  it('formats toggle counts for the tab strip', () => {
    expect(formatToggleCount(3, 4)).toBe('3 of 4 on');
  });

  it('defines section eyebrow and title pairs for settings tabs', () => {
    expect(SETTINGS_SECTION_TABS).toEqual([
      { id: 'profile', label: 'Manage', value: 'Profile', variant: 'section' },
      { id: 'public', label: 'Publish', value: 'Public', variant: 'section' },
      { id: 'capture', label: 'Control', value: 'Capture', variant: 'section' },
      { id: 'alerts', label: 'Watch', value: 'Alerts', variant: 'section' },
      { id: 'projects', label: 'Organize', value: 'Projects', variant: 'section' },
    ]);
  });
});
