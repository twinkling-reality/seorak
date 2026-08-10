/** Shared readiness types — imported by probes and the public module. */

export type ReadinessState =
  | 'ready'
  | 'valid-zero'
  | 'accruing'
  | 'capture-off'
  | 'maturing'
  | 'quiet-window'
  | 'not-available';

export interface ReadinessAction {
  label: string;
  href: string;
}

export interface WidgetReadiness {
  state: ReadinessState;
  message: string;
  action?: ReadinessAction;
  pickerBadge: string | null;
  isEmpty: boolean;
}

export type CollectionGroup = 'sessions' | 'git' | 'outcomes' | 'files' | 'tools';

export interface CollectionPendingStat {
  id: string;
  label: string;
  state: ReadinessState;
  message: string;
}

export interface CollectionRow {
  group: CollectionGroup;
  label: string;
  state: ReadinessState;
  message: string;
  readyCount: number;
  totalCount: number;
  attentionCount: number;
  pendingStats: CollectionPendingStat[];
}

/** Only `ready` counts toward collection "X of Y stats ready". */
export function isCollectionReady(state: ReadinessState): boolean {
  return state === 'ready';
}

/** Quiet-window is measured but empty — no user action needed; omit from the attention panel. */
export function needsCollectionAttention(state: ReadinessState): boolean {
  return state !== 'ready' && state !== 'quiet-window';
}
