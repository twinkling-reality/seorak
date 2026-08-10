/**
 * Tools & Models widget category.
 *
 * v1 tracks a single tool (Claude Code), so multi-tool comparison entries
 * (tool-handoffs, tool-work-type-fit, one-shot-by-tool) are not part of the
 * catalog; they return when a second tool ships. tool-mix is bound to
 * tools.byTool[] from the retained event log. No per-tool split → SectionEmpty
 * (never a KV aggregate headline — this tile is the mix, not a call counter).
 * model-mix, tool-call-errors, and verification are all live, honest-empty
 * until their rows land.
 *
 * Design language: chromeless. Hierarchy from font weight, opacity, and color.
 * Em-dash for unmeasured, never a fabricated zero.
 */

import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { setQueryParams } from '../../lib/router.js';
import { formatModel } from '../../lib/modelMeta.js';
import type { ModelRollup, ToolCallRollup, VerificationRollup } from '../../lib/apiSchemas.js';
import styles from './ToolWidgets.module.css';
import { AnnotatedStrip, type AnnotatedStripSegment } from './atoms/AnnotatedStrip.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { ReadinessStatEmpty, StatWidget, readinessSectionText } from './shared.js';
import { StripFaceHead } from './atoms/StripFaceHead.js';
import { ShareFaceFrame } from './atoms/ShareFaceFrame.js';
import { STRIP_TAIL_FILL, vizSeqColor } from './atoms/shareStripRamp.js';
import { formatCost } from '../utils.js';

function openTools(tab: string, q: string) {
  return () => setQueryParams({ tools: tab, q });
}

const MIX_TOP_N = 7;

const TAIL_FILL = STRIP_TAIL_FILL;

// ── tool-mix (the honest per-tool split) ────────────
//
// tools.byTool[] from the event log. Without a split, SectionEmpty only — no
// KV totalCalls headline (that number lives elsewhere; showing it here without
// a strip read as filler).
function ToolMixWidget({ overview, capture }: WidgetBodyProps) {
  const byTool = overview.tools.byTool;
  const totalCalls = overview.tools.callStats.totalCalls;

  if (byTool.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'tool-mix',
          overview,
          capture,
          totalCalls === 0
            ? 'Tool calls show up here once you run a session'
            : 'No per-tool breakdown in this window yet.',
        )}
      </SectionEmpty>
    );
  }

  const sorted = [...byTool].sort((a: ToolCallRollup, b: ToolCallRollup) => b.calls - a.calls);
  const visible = sorted.slice(0, MIX_TOP_N);
  const tail = sorted.slice(MIX_TOP_N);
  const tailTotal = tail.reduce((s: number, t: ToolCallRollup) => s + t.calls, 0);

  const TAIL_KEY = '__tail__';
  const segments: AnnotatedStripSegment[] = [
    ...visible.map((t, i) => ({
      key: t.tool,
      value: t.calls,
      color: vizSeqColor(i),
      label: t.tool,
    })),
    ...(tail.length > 0
      ? [{ key: TAIL_KEY, value: tailTotal, color: TAIL_FILL, label: `+${tail.length} more` }]
      : []),
  ];
  // The head never swaps: one value, one unit, always the total (the head-swap
  // caption was a middot-joined fact, banned by Precedent 1). The strip is a
  // display-only Share face; the whole tile drills into the tools detail (the
  // per-segment spotlight was removed — as a wrapper-clickable tile its clicks
  // bubbled to the drill and navigated away, audit A4).
  return (
    <div className={styles.mixWrap}>
      <StripFaceHead
        value={byTool.reduce((s, t) => s + t.calls, 0).toLocaleString()}
        caption={
          byTool.reduce((s, t) => s + t.calls, 0) === 1 ? 'tool call' : 'tool calls'
        }
      />
      <AnnotatedStrip
        segments={segments}
        ariaLabel="Tool call share"
        titleFor={(s) =>
          s.key === TAIL_KEY
            ? `${tail.length} more ${tail.length === 1 ? 'tool' : 'tools'}: ${tail
                .map((t) => `${t.tool} (${t.calls})`)
                .join(', ')}`
            : `${s.label}: ${s.value.toLocaleString()} ${s.value === 1 ? 'call' : 'calls'}`
        }
        // Every number carries its unit in text (bare-numbers ban).
        legendValueFor={(s) =>
          s.key === TAIL_KEY
            ? null
            : `${s.value.toLocaleString()} ${s.value === 1 ? 'call' : 'calls'}`
        }
      />
      {/* The face stays stat-only. The "why is 'other' large" caveat — Codex's
        * open dynamic-tool vocabulary folds to the other bucket — is a structured
        * note on the tools drill (ToolsPanel), not filler under every tile. */}
    </div>
  );
}

// ── tool-call-errors ────────────────────────────────
//
// Real capture: the collector stamps `errored` per call (PostToolUse vs
// PostToolUseFailure). errorRate is null only until a call has RETURNED a result
// (honest-empty), never "not built".
function ToolCallErrorsWidget({ overview, capture }: WidgetBodyProps) {
  const errorRate = overview.tools.callStats.errorRate;
  if (errorRate == null) {
    return (
      <ReadinessStatEmpty
        widgetId="tool-call-errors"
        overview={overview}
        capture={capture}
        fallback="Error rate fills in once tool calls succeed or fail."
      />
    );
  }
  // errorRate is a 0..1 fraction — scale to a percentage for display.
  const value = `${Math.round(errorRate * 100)}%`;
  // Codex returns a result on shell calls only, so whenever its calls are in
  // the window the rate covers an unequal share of each tool's work. The rule
  // rides titleHint (DASHBOARD-CLARITY P1: the face keeps one value, the how
  // lives on hover) because a 2-row stat card has no room for a pinned prose
  // note under the numeral — the on-face CoverageNote overlapped the value.
  // The errors drill one click away states the same rule in visible text.
  const hasCodex = overview.tools.byAgent.some((a) => a.agent === 'codex');
  return (
    <StatWidget
      value={value}
      onOpenDetail={openTools('errors', 'top')}
      detailAriaLabel={`Open errors detail, ${value} error rate`}
      titleHint={
        hasCodex
          ? 'Measured on calls that report a result. Codex reports results on shell calls only.'
          : 'Measured on calls that report a result.'
      }
    />
  );
}

// ── model-mix (per-model spend) ─────────────────────
//
// tools.byModel summed from each tool.call's models[]. Empty [] until the
// window's tool calls carry model usage. When some model is UNPRICED (costUsd
// null), the strip falls back to TOKEN share for every row (so unpriced models
// still appear) and a note says so — never a fabricated $0 (the silent-zero ban).
function ModelMixWidget({ overview, capture }: WidgetBodyProps) {
  const byModel = overview.tools.byModel;

  if (byModel.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText('model-mix', overview, capture, 'Fills in as tool calls accrue')}
      </SectionEmpty>
    );
  }

  // If any model is unpriced (costUsd null), show TOKEN share for all so the
  // unpriced ones aren't dropped; otherwise show COST share.
  const anyUnpriced = byModel.some((m: ModelRollup) => m.costUsd == null);
  const metric = (m: ModelRollup) => (anyUnpriced ? m.tokensTotal : (m.costUsd ?? 0));
  const sorted = [...byModel].sort((a, b) => metric(b) - metric(a));

  // Same fold as every strip face (height & overflow protocol): top N
  // named, the rest one neutral "+N more" tail. Rare for models, defined
  // anyway — a form does not invent per-widget overflow behavior.
  const visible = sorted.slice(0, MIX_TOP_N);
  const tail = sorted.slice(MIX_TOP_N);
  const tailTotal = tail.reduce((s: number, m: ModelRollup) => s + metric(m), 0);

  const MODEL_TAIL_KEY = '__tail__';
  const segments: AnnotatedStripSegment[] = [
    ...visible.map((m, i) => ({
      key: m.model,
      value: metric(m),
      color: vizSeqColor(i),
      label: formatModel(m.model),
    })),
    ...(tail.length > 0
      ? [{ key: MODEL_TAIL_KEY, value: tailTotal, color: TAIL_FILL, label: `+${tail.length} more` }]
      : []),
  ];

  const totalCost = byModel.reduce((s: number, m: ModelRollup) => s + (m.costUsd ?? 0), 0);

  return (
    <div className={styles.mixWrap}>
      {/* The value slot holds a VALUE: total spend when every model is
        * priced, the model count when any is unpriced (the old face put the
        * string "token share" there, which is a label wearing a value's
        * clothes). The unpriced/token-share caveat lives on the Agents → Models
        * drill (this tile's drill target), not as filler under the face — the
        * strip legend already labels its values "tokens" when unpriced. */}
      {anyUnpriced ? (
        <StripFaceHead
          value={byModel.length.toLocaleString()}
          caption={byModel.length === 1 ? 'model' : 'models'}
        />
      ) : (
        <StripFaceHead value={formatCost(totalCost, 2)} caption="model spend" />
      )}
      <AnnotatedStrip
        segments={segments}
        ariaLabel="Per-model spend share"
        titleFor={(s) => {
          if (s.key === MODEL_TAIL_KEY) {
            return `${tail.length} more ${tail.length === 1 ? 'model' : 'models'}`;
          }
          const m = byModel.find((x: ModelRollup) => x.model === s.key);
          return m && m.costUsd != null
            ? `${s.label}: ${formatCost(m.costUsd, 2)}`
            : `${s.label}: unpriced, token share`;
        }}
        // One unit per render: costs when every model is priced ($ names
        // itself), token counts labeled as tokens in token-share mode
        // (bare-numbers ban).
        legendValueFor={(s) => {
          const m = byModel.find((x: ModelRollup) => x.model === s.key);
          if (!m) return null;
          return anyUnpriced
            ? `${m.tokensTotal.toLocaleString()} tokens`
            : formatCost(m.costUsd ?? 0, 2);
        }}
      />
    </div>
  );
}

// ── agent-edit-share (cross-tool edit lines) ────────
//
// tools.byAgent[].lines — fairest cross-tool compare (multi-tool.md). Honest-
// empty until a second agent records edit lines. Overview entry for /agents.
function AgentEditShareWidget({ overview }: WidgetBodyProps) {
  const byAgent = overview.tools.byAgent.filter(
    (a) => a.lines != null && a.lines.added + a.lines.removed > 0,
  );

  if (overview.tools.byAgent.length <= 1 || byAgent.length === 0) {
    return (
      <SectionEmpty>
        {overview.tools.byAgent.length <= 1
          ? 'Agent edit share fills in once a second tool records sessions.'
          : 'Edit-line split fills in once both tools record line counts.'}
      </SectionEmpty>
    );
  }

  const ranked = [...byAgent].sort(
    (a, b) =>
      b.lines!.added + b.lines!.removed - (a.lines!.added + a.lines!.removed),
  );
  const total = ranked.reduce((s, a) => s + a.lines!.added + a.lines!.removed, 0);
  const segments: AnnotatedStripSegment[] = ranked.map((a, i) => ({
    key: a.agent,
    value: a.lines!.added + a.lines!.removed,
    color: vizSeqColor(i),
    label: a.agent === 'claude-code' ? 'Claude Code' : a.agent === 'codex' ? 'Codex' : a.agent,
  }));

  return (
    <div className={styles.mixWrap}>
      <StripFaceHead
        value={total.toLocaleString()}
        caption={total === 1 ? 'edit line' : 'edit lines'}
      />
      <AnnotatedStrip
        segments={segments}
        ariaLabel="Edit-line share by agent"
        titleFor={(s) => `${s.label}: ${s.value.toLocaleString()} edit lines`}
        legendValueFor={(s) => `${s.value.toLocaleString()} lines`}
      />
    </div>
  );
}

// ── verification (test/build/typecheck/lint checks, by kind) ────
//
// tools.verification: per-kind runs that RETURNED a result (test/build/typecheck/
// lint). On Claude-Code-only a PASSING Bash run reports no exit signal, so it is
// excluded from the denominator — only FAILURES are counted (PostToolUseFailure →
// errored → passed:false). So passRate is structurally pinned at 0/null and we do
// NOT render it as a pass rate; we surface how many checks FAILED, by kind. Empty
// [] until verification runs land. (A real pass-rate is recoverable from the
// already-captured which-hook signal — see the `ToolsSnapshot.verification`
// contract note in `@seorak/types`.)
function VerificationWidget({ overview, capture }: WidgetBodyProps) {
  const verification = overview.tools.verification;
  if (verification.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'verification',
          overview,
          capture,
          'Verification checks fill in as your test / build / typecheck / lint commands run.',
        )}
      </SectionEmpty>
    );
  }

  const rows = verification.map((v: VerificationRollup) => ({
    kind: v.kind,
    failed: v.passRate == null ? null : Math.round(v.runs * (1 - v.passRate)),
  }));

  const failing = rows
    .filter((r) => (r.failed ?? 0) > 0)
    .sort((a, b) => (b.failed ?? 0) - (a.failed ?? 0));
  const totalFailed = rows.reduce((s, r) => s + (r.failed ?? 0), 0);
  const top = failing[0];

  if (totalFailed === 0) {
    return (
      <StripFaceHead
        value="none"
        caption="checks failed"
        titleHint="On Claude Code, passing runs aren't separately reported — counts failures only, not a pass rate."
      />
    );
  }

  const segments: AnnotatedStripSegment[] = failing.map((r, i) => ({
    key: r.kind,
    value: r.failed ?? 0,
    color: vizSeqColor(i),
    label: r.kind,
  }));

  const headValue = top.failed!.toLocaleString();
  const headCaption =
    top.failed === 1 ? `${top.kind} failure` : `${top.kind} failures`;

  return (
    <ShareFaceFrame
      value={headValue}
      caption={headCaption}
      headTitle="Counts checks that failed, not a pass rate. On Claude Code, passing runs aren't separately reported."
      strip={{
        segments,
        stripHeight: 12,
        ariaLabel: `Verification failures by kind, ${totalFailed} total`,
        titleFor: (s) => {
          const n = s.value;
          return `${s.label}: ${n} ${n === 1 ? 'check failed' : 'checks failed'}`;
        },
        legendValueFor: (s) => `${s.value.toLocaleString()} failed`,
      }}
    />
  );
}

export const toolWidgets: WidgetRegistry = {
  'tool-mix': ToolMixWidget,
  'tool-call-errors': ToolCallErrorsWidget,
  'model-mix': ModelMixWidget,
  'agent-edit-share': AgentEditShareWidget,
  verification: VerificationWidget,
};
