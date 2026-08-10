import type { WidgetDef } from './types.js';

// Codebase widgets — the file/directory axis, fed by the collector's salted
// fileId signal (CAPTURE-PRINCIPLE: ids + counts ship, paths never do). Labels
// are basenames under the default-OFF "file labels" opt-in; every tile renders
// honest-empty until in-window rows carry the signal. (The git-count KPI tiles —
// commits / files-touched / net-lines — live in the usage catalog alongside the
// other git counts; this category is the file/directory axis only.)
export const CODEBASE_WIDGETS: WidgetDef[] = [
  {
    id: 'directories',
    name: 'top directories',
    description:
      'Directories with the most edit activity this period. Counts only. Paths stay on your machine.',
    category: 'codebase',
    scope: 'both',
    viz: 'proportional-bar',
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    maxH: 3,
    fitContent: true,
    dataKeys: ['directory_heatmap'],
    drillTarget: { view: 'codebase', tab: 'directories', q: 'hot-directories' },
    requiresCapture: 'hooks',
    availability: 'available',
  },
  {
    id: 'files',
    name: 'top files',
    description:
      'Files with the most edits this period. Counts only. Paths stay on your machine.',
    category: 'codebase',
    scope: 'both',
    viz: 'proportional-bar',
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    maxH: 3,
    dataKeys: ['file_heatmap'],
    drillTarget: { view: 'codebase', tab: 'files', q: 'hot-files' },
    fitContent: true,
    requiresCapture: 'hooks',
    availability: 'available',
  },
  {
    id: 'file-rework',
    name: 'files edited repeatedly',
    description:
      'Files edited across 2+ sessions this period. Recurrence is a review cue, not a grade.',
    category: 'codebase',
    scope: 'both',
    viz: 'proportional-bar',
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    maxH: 3,
    dataKeys: ['file_rework'],
    drillTarget: { view: 'codebase', tab: 'files', q: 'rework' },
    fitContent: true,
    availability: 'available',
  },
];
