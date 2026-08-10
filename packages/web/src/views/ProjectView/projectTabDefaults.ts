// Default widget layout for a repo dashboard. The Project page is one
// customizable cockpit, not two pseudo-tabs with the same widget catalog.
// Every id below resolves to a real catalog widget — no team/memory/multi-tool
// ids, so the grid never skips a default into an empty cockpit.

import type { WidgetSlot } from '../../widgets/catalog/index.js';

export const PROJECT_DEFAULT_LAYOUT: WidgetSlot[] = [
  // Live presence — the hero for this repo while work is happening.
  { id: 'live-sessions', colSpan: 12, rowSpan: 4 },
  // Repo-scoped headline stats.
  { id: 'sessions', colSpan: 3, rowSpan: 2 },
  { id: 'cost', colSpan: 3, rowSpan: 2 },
  { id: 'ship-rate', colSpan: 3, rowSpan: 2 },
  { id: 'line-survival', colSpan: 3, rowSpan: 2 },
  // Work shape for this repo. These can honest-empty until the repo has enough
  // captured calls/files; they belong in the picker and default once scoped.
  { id: 'tool-mix', colSpan: 6, rowSpan: 4 },
  { id: 'files', colSpan: 6, rowSpan: 3 },
];
