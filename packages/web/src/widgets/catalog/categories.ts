import type { WidgetCategory } from './types.js';

// Picker categories. conversations / memory / team are intentionally absent —
// out of scope for the solo model. Every listed category carries live tiles fed
// by real Seorak capture (KV state + the retained D1 event log + git/fileId).
export const CATEGORIES: Array<{ id: WidgetCategory; label: string }> = [
  { id: 'live', label: 'live' },
  { id: 'usage', label: 'usage' },
  { id: 'outcomes', label: 'outcomes' },
  { id: 'activity', label: 'activity' },
  { id: 'codebase', label: 'codebase' },
  { id: 'tools', label: 'tools & models' },
];
