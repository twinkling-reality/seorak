import {
  DEFAULT_CAPTURE_SETTINGS,
  type CaptureSettings,
  type OverviewSnapshot,
} from '@seorak/types';
import { WIDGET_CATALOG, getWidget, type WidgetDef, type WidgetSlot } from '../widgets/catalog/index.js';
import {
  FULL_DEFAULT_LAYOUT,
  STARTER_DEFAULT_LAYOUT,
} from '../widgets/catalog/default-layout.js';
import {
  SETTINGS_ACTION,
  WIDGET_PROBES,
  buildReadiness,
  hasGitMomentum,
  hasSessionActivity,
  type ReadinessContext,
} from './widgetReadinessProbes.js';
import {
  isCollectionReady,
  needsCollectionAttention,
  type CollectionGroup,
  type CollectionRow,
  type ReadinessState,
  type WidgetReadiness,
} from './widgetReadinessTypes.js';

export type {
  CollectionGroup,
  CollectionRow,
  ReadinessAction,
  ReadinessState,
  WidgetReadiness,
} from './widgetReadinessTypes.js';
export { isCollectionReady } from './widgetReadinessTypes.js';

const GIT_WIDGET_IDS = new Set(
  WIDGET_CATALOG.filter((w) => w.requiresCapture === 'commitTracking').map((w) => w.id),
);

const FILE_WIDGET_IDS = new Set(
  WIDGET_CATALOG.filter(
    (w) =>
      w.requiresCapture === 'hooks' ||
      w.id === 'files-in-play' ||
      w.id === 'file-rework',
  ).map((w) => w.id),
);

/** Widgets whose empty state depends on edit-tool line derivation (usage.lines). */
const LINE_COUNT_WIDGET_IDS = new Set<string>([]);

const CAPTURE_MESSAGES: Record<keyof CaptureSettings, string> = {
  gitMomentum: 'Git capture is off in Settings, so this stat cannot be measured.',
  fileSignals: 'File capture is off in Settings, so this stat cannot be measured.',
  lineCounts: 'Line counts are off in Settings, so edit-line volume cannot be measured.',
  fileLabels: 'File labels are off — stats still work with salted ids.',
  toolchain: 'Toolchain capture is off in Settings.',
  repoLabels: 'Repo labels are off — stats still work with salted ids.',
};

const GROUP_WIDGETS: Record<CollectionGroup, readonly string[]> = {
  sessions: [
    'live-sessions',
    'sessions',
    'cost',
    'cache-reuse',
    'cost-per-edit',
    'edits',
    'trend',
    'projects',
    'heatmap',
  ],
  git: [
    'momentum',
    'commits',
    'net-lines',
    'lines-added',
    'lines-removed',
    'files-touched',
  ],
  outcomes: [
    'ship-rate',
    'line-survival',
    'session-end-reasons',
    'outcome-trend',
    'one-shot-rate',
    'stuckness',
    'hourly-effectiveness',
  ],
  files: ['directories', 'files', 'file-rework', 'files-in-play'],
  tools: ['tool-mix', 'model-mix', 'agent-edit-share', 'tool-call-errors', 'verification'],
};

const GROUP_LABELS: Record<CollectionGroup, string> = {
  sessions: 'Sessions & Usage',
  git: 'Git activity',
  outcomes: 'Outcomes',
  files: 'Files & Directories',
  tools: 'Tools & Models',
};

const STATE_PRIORITY: ReadinessState[] = [
  'not-available',
  'capture-off',
  'maturing',
  'accruing',
  'quiet-window',
  'valid-zero',
  'ready',
];

function captureFor(raw: CaptureSettings | null | undefined): CaptureSettings {
  return raw ?? DEFAULT_CAPTURE_SETTINGS;
}

/** Resolve which capture toggles gate a widget, using catalog requiresCapture. */
export function requiredCaptureKeys(
  widgetId: string,
  def: WidgetDef | undefined,
): (keyof CaptureSettings)[] {
  const keys: (keyof CaptureSettings)[] = [];
  if (GIT_WIDGET_IDS.has(widgetId) || def?.requiresCapture === 'commitTracking') {
    keys.push('gitMomentum');
  }
  if (FILE_WIDGET_IDS.has(widgetId)) {
    keys.push('fileSignals');
  }
  if (LINE_COUNT_WIDGET_IDS.has(widgetId)) {
    keys.push('lineCounts');
  }
  return keys;
}

function checkStructural(
  def: WidgetDef | undefined,
  widgetId: string,
  capture: CaptureSettings,
  ctx: ReadinessContext,
): WidgetReadiness | null {
  if (def?.availability === 'not-available') {
    return buildReadiness(
      'not-available',
      'Seorak does not collect the data this stat needs.',
      ctx,
      { isEmpty: true },
    );
  }
  for (const key of requiredCaptureKeys(widgetId, def)) {
    if (!capture[key]) {
      return buildReadiness('capture-off', CAPTURE_MESSAGES[key], ctx, {
        action: SETTINGS_ACTION,
        isEmpty: true,
        captureOffKey: key,
      });
    }
  }
  return null;
}

function evaluateWidget(
  widgetId: string,
  overview: OverviewSnapshot,
  capture: CaptureSettings,
  def: WidgetDef | undefined,
): WidgetReadiness {
  const ctx: ReadinessContext = {
    widgetId,
    overview,
    capture,
    def,
    active: hasSessionActivity(overview),
  };
  const blocked = checkStructural(def, widgetId, capture, ctx);
  if (blocked) return blocked;

  const probe = WIDGET_PROBES[widgetId];
  if (probe) return probe(ctx);

  return buildReadiness('accruing', 'Fills in as data accrues.', ctx, { isEmpty: true });
}

export function getWidgetReadiness(
  widgetId: string,
  overview: OverviewSnapshot,
  capture?: CaptureSettings | null,
): WidgetReadiness {
  const cap = captureFor(capture);
  const def = getWidget(widgetId);
  return evaluateWidget(widgetId, overview, cap, def);
}

export function readinessEmptyMessage(
  widgetId: string,
  overview: OverviewSnapshot,
  capture?: CaptureSettings | null,
): string | null {
  const r = getWidgetReadiness(widgetId, overview, capture);
  return r.isEmpty ? r.message : null;
}

export function isCaptureOffForWidget(
  widgetId: string,
  capture?: CaptureSettings | null,
): boolean {
  const cap = captureFor(capture);
  const def = getWidget(widgetId);
  return requiredCaptureKeys(widgetId, def).some((key) => !cap[key]);
}

function groupAttentionMessage(readiness: WidgetReadiness[]): string {
  const state = aggregateState(readiness);
  const pending = readiness.filter((r) => needsCollectionAttention(r.state)).length;

  if (state === 'capture-off') {
    const sample = readiness.find((r) => r.state === 'capture-off');
    return sample?.message ?? 'Turn capture back on in Settings.';
  }
  if (state === 'not-available') return 'Some stats are not available in v1.';
  if (state === 'maturing') {
    return 'Some stats mature a few days after commits land.';
  }
  if (pending === readiness.length) {
    return 'Appears as sessions and tool calls accrue.';
  }
  return `${pending} ${pending === 1 ? 'stat is' : 'stats are'} waiting for enough real activity.`;
}

function aggregateState(readiness: WidgetReadiness[]): ReadinessState {
  for (const state of STATE_PRIORITY) {
    if (readiness.some((r) => r.state === state)) return state;
  }
  return 'ready';
}

export function getCollectionSummary(
  overview: OverviewSnapshot,
  capture?: CaptureSettings | null,
): CollectionRow[] {
  const cap = captureFor(capture);
  return (Object.keys(GROUP_WIDGETS) as CollectionGroup[]).map((group) => {
    const ids = GROUP_WIDGETS[group];
    const evaluated = ids.map((id) => {
      const def = getWidget(id);
      return {
        id,
        label: def?.name ?? id,
        readiness: evaluateWidget(id, overview, cap, def),
      };
    });
    const readiness = evaluated.map((item) => item.readiness);
    const readyCount = readiness.filter((r) => isCollectionReady(r.state)).length;
    const attentionCount = readiness.filter((r) => needsCollectionAttention(r.state)).length;
    return {
      group,
      label: GROUP_LABELS[group],
      state: aggregateState(readiness),
      message: groupAttentionMessage(readiness),
      readyCount,
      totalCount: ids.length,
      attentionCount,
      pendingStats: evaluated
        .filter((item) => needsCollectionAttention(item.readiness.state))
        .map((item) => ({
          id: item.id,
          label: item.label,
          state: item.readiness.state,
          message: item.readiness.message,
        })),
    };
  });
}

/** Groups that still need user attention — omit satisfied categories from the panel. */
export function getCollectionAttention(rows: CollectionRow[]): CollectionRow[] {
  return rows.filter((r) => r.attentionCount > 0);
}

export function collectionPanelVisible(rows: CollectionRow[]): boolean {
  return getCollectionAttention(rows).length > 0;
}

export function isReadyForFullLayout(
  overview: OverviewSnapshot,
  capture?: CaptureSettings | null,
): boolean {
  const cap = captureFor(capture);
  if (!cap.gitMomentum) return false;
  const hasGit = hasGitMomentum(overview);
  const hasOutcomes =
    overview.outcomes.shipRate !== null || overview.outcomes.lineSurvival.rate !== null;
  return hasGit || hasOutcomes;
}

export function isPickerAddBlocked(
  widgetId: string,
  capture?: CaptureSettings | null,
): boolean {
  const def = getWidget(widgetId);
  if (def?.availability === 'not-available') return true;
  return isCaptureOffForWidget(widgetId, capture);
}

/** Context-aware default: starter for week-one users, full when git/outcome stats landed. */
export function resolveDefaultLayout(
  overview?: OverviewSnapshot | null,
  capture?: CaptureSettings | null,
): WidgetSlot[] {
  const source = overview && isReadyForFullLayout(overview, capture)
    ? FULL_DEFAULT_LAYOUT
    : STARTER_DEFAULT_LAYOUT;
  return source.map((s) => ({ ...s }));
}
