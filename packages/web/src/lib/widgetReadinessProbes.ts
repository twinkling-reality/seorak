import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';
import type { WidgetDef } from '../widgets/catalog/types.js';
import type { ReadinessAction, ReadinessState, WidgetReadiness } from './widgetReadinessTypes.js';

export interface ReadinessContext {
  widgetId: string;
  overview: OverviewSnapshot;
  capture: CaptureSettings;
  def: WidgetDef | undefined;
  active: boolean;
}

export const SETTINGS_ACTION: ReadinessAction = {
  label: 'Data & capture',
  href: '/dashboard/settings',
};

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function hasSessionActivity(o: OverviewSnapshot): boolean {
  return (
    o.live.length > 0 ||
    o.usage.totals.sessions > 0 ||
    o.outcomes.endedCount > 0 ||
    o.outcomes.activeCount > 0
  );
}

export function hasGitMomentum(o: OverviewSnapshot): boolean {
  return (
    o.usage.portfolio.repos.length > 0 ||
    o.usage.momentum.length > 0 ||
    o.codebase.commitStats !== null
  );
}

export function sumMomentum(
  momentum: OverviewSnapshot['usage']['momentum'],
  field: 'filesTouched' | 'linesAdded' | 'linesDeleted',
): number {
  return momentum.reduce((acc, m) => acc + (m[field] ?? 0), 0);
}

export function editCallTotal(o: OverviewSnapshot): number {
  return o.tools.byTool
    .filter((t) => EDIT_TOOLS.has(t.tool))
    .reduce((acc, t) => acc + t.calls, 0);
}

function pendingLineSurvival(o: OverviewSnapshot): boolean {
  return o.outcomes.bySession.some((row) => row.status === 'pending');
}

export function pickerBadgeFor(
  state: ReadinessState,
  widgetId: string,
  capture: CaptureSettings,
  captureOffKey: keyof CaptureSettings | null,
): string | null {
  if (state === 'ready' || state === 'quiet-window') return null;
  if (state === 'valid-zero') return 'Empty';
  if (state === 'not-available') return 'Not available';
  if (state === 'capture-off') {
    if (captureOffKey === 'gitMomentum') return 'Needs git capture';
    if (captureOffKey === 'fileSignals') return 'Needs file capture';
    if (captureOffKey === 'lineCounts') return 'Needs line counts';
    return 'Capture off';
  }
  if (state === 'maturing') return 'Maturing';
  return 'Accruing';
}

export function buildReadiness(
  state: ReadinessState,
  message: string,
  ctx: ReadinessContext,
  opts?: { action?: ReadinessAction; isEmpty?: boolean; captureOffKey?: keyof CaptureSettings | null },
): WidgetReadiness {
  const isEmpty =
    opts?.isEmpty ?? (state !== 'ready' && state !== 'valid-zero');
  return {
    state,
    message,
    action: opts?.action,
    pickerBadge: pickerBadgeFor(state, ctx.widgetId, ctx.capture, opts?.captureOffKey ?? null),
    isEmpty,
  };
}

/** Per-widget data probes. Adding a widget = one entry here (+ catalog metadata). */
export const WIDGET_PROBES: Record<string, (ctx: ReadinessContext) => WidgetReadiness> = {
  'live-sessions': (ctx) =>
    ctx.overview.live.length === 0
      ? buildReadiness('valid-zero', 'No sessions running right now.', ctx, { isEmpty: true })
      : buildReadiness('ready', 'Live sessions on the board.', ctx, { isEmpty: false }),

  'files-in-play': (ctx) => {
    const fip = ctx.overview.codebase.filesInPlay;
    if (fip === null || fip.distinctFiles === 0) {
      return buildReadiness(
        ctx.active ? 'accruing' : 'valid-zero',
        ctx.active
          ? 'Fills in when a running session edits a tracked file.'
          : 'No files in play right now.',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Files in play from live sessions.', ctx, { isEmpty: false });
  },

  momentum: (ctx) =>
    ctx.overview.usage.portfolio.repos.length === 0
      ? buildReadiness('accruing', 'Repo activity fills in once Seorak sees a git commit.', ctx, {
          isEmpty: true,
        })
      : buildReadiness('ready', 'Cross-repo git activity.', ctx, { isEmpty: false }),

  sessions: (ctx) =>
    ctx.overview.usage.totals.sessions === 0
      ? buildReadiness(
          ctx.active ? 'quiet-window' : 'accruing',
          ctx.active
            ? 'No sessions in this window.'
            : 'Session count fills in once you run a session.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Sessions counted for this window.', ctx, { isEmpty: false }),

  edits: (ctx) => {
    const edits = editCallTotal(ctx.overview);
    if (ctx.overview.tools.byTool.length === 0 || edits === 0) {
      return buildReadiness(
        'accruing',
        'Fills in as edit-family tool calls accrue in this window.',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Edit-family tool calls in window.', ctx, { isEmpty: false });
  },

  'lines-added': (ctx) => probeGitMomentumCount(ctx, 'linesAdded'),
  'lines-removed': (ctx) => probeGitMomentumCount(ctx, 'linesDeleted'),
  'files-touched': (ctx) => probeGitMomentumCount(ctx, 'filesTouched'),

  commits: (ctx) => probeCommitStats(ctx),
  'net-lines': (ctx) => probeCommitStats(ctx),

  cost: (ctx) => {
    const cost = ctx.overview.usage.cost;
    if (cost.totalUsd === null || cost.sessionsWithCost === 0) {
      return buildReadiness(
        'accruing',
        'Cost fills in once a session reports token spend.',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Window cost measured.', ctx, { isEmpty: false });
  },

  'cache-reuse': (ctx) =>
    ctx.overview.usage.cacheReuseRatio === null
      ? buildReadiness(
          'accruing',
          'Context reuse fills in once measurable tokens accrue.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Cache reuse ratio in window.', ctx, { isEmpty: false }),

  'cost-per-edit': (ctx) =>
    ctx.overview.usage.costPerEdit === null
      ? buildReadiness(
          'accruing',
          'Fills in once Seorak has both cost and edit-call data in this window.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Cost per edit in window.', ctx, { isEmpty: false }),

  trend: (ctx) => {
    const points = ctx.overview.usage.dailyTrends.filter((d) => d.sessions > 0);
    if (points.length < 2) {
      return buildReadiness(
        'accruing',
        'Daily session trend fills in across more than one day with sessions.',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Daily session trend.', ctx, { isEmpty: false });
  },

  projects: (ctx) =>
    ctx.overview.usage.projects.length === 0
      ? buildReadiness(
          'accruing',
          'Project rows fill in once sessions accrue across repos.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Per-repo project rollups.', ctx, { isEmpty: false }),

  'ship-rate': (ctx) =>
    ctx.overview.outcomes.shipRate === null
      ? buildReadiness(
          'accruing',
          'Ship detection fills in once a finished session lands a commit.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Ship rate in window.', ctx, { isEmpty: false }),

  'line-survival': (ctx) => {
    const ls = ctx.overview.outcomes.lineSurvival;
    if (ls.rate === null) {
      const maturing = pendingLineSurvival(ctx.overview) || ls.sessionsRated > 0;
      return buildReadiness(
        maturing || ctx.overview.outcomes.endedCount > 0 ? 'maturing' : 'accruing',
        maturing
          ? 'Line survival is checked a few days after commits land. Fills in as sessions mature.'
          : 'Line survival fills in once the daemon re-checks matured sessions\' lines (needs 3+ commits).',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Line survival rate.', ctx, { isEmpty: false });
  },

  'session-end-reasons': (ctx) => {
    const total = ctx.overview.outcomes.endReasons.reduce((s, r) => s + r.count, 0);
    if (total === 0) {
      return buildReadiness(
        'accruing',
        'Counts how sessions stopped once you have ended a few.',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Session end reasons in window.', ctx, { isEmpty: false });
  },

  'outcome-trend': (ctx) => {
    const byDay = ctx.overview.outcomes.endReasonsByDay;
    const total = byDay.reduce((s, d) => s + d.reasons.reduce((rs, r) => rs + r.count, 0), 0);
    if (byDay.length === 0 || total === 0) {
      return buildReadiness('accruing', 'Fills in as sessions wrap up, day by day.', ctx, {
        isEmpty: true,
      });
    }
    return buildReadiness('ready', 'Session ends over time.', ctx, { isEmpty: false });
  },

  'one-shot-rate': (ctx) =>
    ctx.overview.outcomes.oneShotRate === null
      ? buildReadiness('accruing', 'Fills in as ended sessions accrue.', ctx, { isEmpty: true })
      : buildReadiness('ready', 'One-shot rate in window.', ctx, { isEmpty: false }),

  stuckness: (ctx) =>
    ctx.overview.outcomes.stuckness.rate === null
      ? buildReadiness(
          ctx.overview.outcomes.activeCount > 0 ? 'accruing' : 'valid-zero',
          ctx.overview.outcomes.activeCount > 0
            ? 'Fills in when a live session goes quiet long enough to flag.'
            : 'No live sessions to watch for stuckness.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Stuck rate among live sessions.', ctx, { isEmpty: false }),

  heatmap: (ctx) =>
    ctx.overview.activity.hourlyDistribution.length === 0
      ? buildReadiness(
          'accruing',
          'Activity heatmap fills in once sessions accrue across hours.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Hourly session distribution.', ctx, { isEmpty: false }),

  'hourly-effectiveness': (ctx) =>
    ctx.overview.activity.endReasonsByHour.length === 0
      ? buildReadiness('accruing', 'Fills in as sessions end across clock hours.', ctx, {
          isEmpty: true,
        })
      : buildReadiness('ready', 'Session ends by hour.', ctx, { isEmpty: false }),

  directories: (ctx) => probeCodebaseList(ctx, 'Directory heat fills in as edits land.'),
  files: (ctx) => probeCodebaseList(ctx, 'Fills in as edits land.'),
  'file-rework': (ctx) =>
    ctx.overview.codebase.rework.length === 0
      ? buildReadiness(
          'accruing',
          'Fills in when the same files show up across multiple sessions.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'File rework recurrence.', ctx, { isEmpty: false }),

  'tool-mix': (ctx) => {
    if (ctx.overview.tools.byTool.length === 0) {
      return buildReadiness(
        'accruing',
        ctx.overview.tools.callStats.totalCalls > 0
          ? 'No per-tool breakdown in this window yet.'
          : 'Tool calls show up here once you run a session.',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Per-tool call mix.', ctx, { isEmpty: false });
  },

  'model-mix': (ctx) =>
    ctx.overview.tools.byModel.length === 0
      ? buildReadiness('accruing', 'Model mix fills in as tool calls accrue.', ctx, { isEmpty: true })
      : buildReadiness('ready', 'Per-model spend split.', ctx, { isEmpty: false }),

  'agent-edit-share': (ctx) => {
    const agents = ctx.overview.tools.byAgent;
    if (agents.length <= 1) {
      return buildReadiness(
        'accruing',
        'Agent edit share fills in once a second tool records sessions.',
        ctx,
        { isEmpty: true },
      );
    }
    const withLines = agents.some((a) => a.lines != null && a.lines.added + a.lines.removed > 0);
    if (!withLines) {
      return buildReadiness(
        'accruing',
        'Edit-line split fills in once both tools record line counts.',
        ctx,
        { isEmpty: true },
      );
    }
    return buildReadiness('ready', 'Edit-line share by agent.', ctx, { isEmpty: false });
  },

  'tool-call-errors': (ctx) => {
    if (ctx.overview.tools.callStats.errorRate !== null) {
      return buildReadiness('ready', 'Tool error rate in window.', ctx, { isEmpty: false });
    }
    const total = ctx.overview.tools.callStats.totalCalls;
    return buildReadiness(
      'accruing',
      total > 0
        ? 'Error rate needs logged tool calls that returned a result in this window.'
        : 'Error rate fills in once tool calls succeed or fail.',
      ctx,
      { isEmpty: true },
    );
  },

  verification: (ctx) =>
    ctx.overview.tools.verification.length === 0
      ? buildReadiness(
          'accruing',
          'Verification checks fill in as test/build/typecheck/lint runs accrue.',
          ctx,
          { isEmpty: true },
        )
      : buildReadiness('ready', 'Verification runs by kind.', ctx, { isEmpty: false }),
};

function probeGitMomentumCount(
  ctx: ReadinessContext,
  field: 'filesTouched' | 'linesAdded' | 'linesDeleted',
): WidgetReadiness {
  const total = sumMomentum(ctx.overview.usage.momentum, field);
  if (total <= 0) {
    return buildReadiness(
      hasGitMomentum(ctx.overview) ? 'quiet-window' : 'accruing',
      hasGitMomentum(ctx.overview)
        ? 'No git activity in this window.'
        : 'Fills in once Seorak sees a git commit in a repo.',
      ctx,
      { isEmpty: true },
    );
  }
  return buildReadiness('ready', 'Git count for trailing window.', ctx, { isEmpty: false });
}

function probeCommitStats(ctx: ReadinessContext): WidgetReadiness {
  if (ctx.overview.codebase.commitStats === null) {
    return buildReadiness(
      'accruing',
      'Fills in once Seorak sees a git commit in a repo.',
      ctx,
      { isEmpty: true },
    );
  }
  return buildReadiness('ready', 'Git commit stats.', ctx, { isEmpty: false });
}

function probeCodebaseList(ctx: ReadinessContext, accruingMessage: string): WidgetReadiness {
  const list =
    ctx.widgetId === 'directories'
      ? ctx.overview.codebase.directories
      : ctx.overview.codebase.files;
  if (list.length === 0) {
    return buildReadiness('accruing', accruingMessage, ctx, { isEmpty: true });
  }
  return buildReadiness('ready', 'File-axis edits in window.', ctx, { isEmpty: false });
}
