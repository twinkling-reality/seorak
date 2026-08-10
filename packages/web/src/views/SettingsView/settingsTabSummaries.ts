import type { CaptureSettings, NotificationSettings } from '@seorak/types';
import { SIGNAL_IDS } from '@seorak/types';
import type { StatTabDef } from '../../components/StatTabs/StatTabs.js';

export type SettingsSectionId = 'profile' | 'public' | 'capture' | 'alerts' | 'projects';

/** Settings section tabs — eyebrow + title pairs, not KPI summaries. */
export const SETTINGS_SECTION_TABS: ReadonlyArray<StatTabDef<SettingsSectionId>> = [
  { id: 'profile', label: 'Manage', value: 'Profile', variant: 'section' },
  { id: 'public', label: 'Publish', value: 'Public', variant: 'section' },
  { id: 'capture', label: 'Control', value: 'Capture', variant: 'section' },
  { id: 'alerts', label: 'Watch', value: 'Alerts', variant: 'section' },
  { id: 'projects', label: 'Organize', value: 'Projects', variant: 'section' },
];

/** Live capture toggles (excludes the locked future row). */
export const CAPTURE_TOGGLE_KEYS: Array<keyof CaptureSettings> = [
  'lineCounts',
  'gitMomentum',
  'fileSignals',
  'fileLabels',
];

export function countCaptureOn(settings: CaptureSettings): number {
  return CAPTURE_TOGGLE_KEYS.filter((key) => settings[key]).length;
}

export function countAlertsOn(settings: NotificationSettings): number {
  return SIGNAL_IDS.filter((id) => settings.signals[id]?.enabled).length;
}

export function formatToggleCount(on: number, total: number): string {
  return `${on} of ${total} on`;
}
