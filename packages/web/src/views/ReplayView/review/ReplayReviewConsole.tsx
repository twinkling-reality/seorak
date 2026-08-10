// The playhead inspector: what is true at the scrubber, docked beside the
// stage so scrubbing never loses the reading.
//
// It reads in two tiers. Four cumulative stats used to share the top of this
// pane at equal weight, and by the end of the scope all four had converged on
// the totals Summary already states — so the pane's loudest numbers were the
// ones the playhead contributed least to. A rate and a concurrency do not
// converge: they are only knowable AT an instant, so they lead, and the running
// totals sit below in a compact ledger that holds more in less room.
//
// This used to be a two-column grid that the cockpit re-styled into a rail with
// overrides. Overriding grid placement to fake a column was fragile — one
// specificity slip and the filter control landed on top of the stats. A narrow
// dock is a different composition, so it is written as one.

import clsx from 'clsx';

import SegmentedControl from '../../../components/SegmentedControl/SegmentedControl.js';
import Tooltip from '../../../components/Tooltip/Tooltip.js';
import ProjectSquircle, { projectSquircleKey } from '../../../components/ProjectSquircle/ProjectSquircle.js';
import { InlineDelta } from '../../../widgets/bodies/shared.js';
import { formatCost, formatRate, formatTokens } from '../../../widgets/utils.js';
import type {
  ReplayReviewItem,
  ReplayReviewModel,
  ReplayReviewTone,
  ReplayNowModel,
} from '../replayReviewModel.js';
import type { NarrativeMode } from '../replayNarrative.js';
import { NARRATIVE_MODE_OPTIONS } from '../replayNarrative.js';
import {
  EVENT_LOG_ROW_LEGEND_ARIA,
  EventLogRowLegendContent,
} from './EventLogRowLegend.js';
import {
  buildUnifiedMomentList,
  formatEventLogLine,
  REPLAY_EVENT_LOG_ARIA_LABEL,
  REPLAY_EVENT_LOG_EYEBROW,
  REPLAY_EVENT_LOG_FILTER_ARIA_LABEL,
  reviewQueueEmptyMessage,
} from './replayReviewConsoleCopy.js';
import styles from './ReplayReviewConsole.module.css';
import tones from './replayEventTones.module.css';

function toneClass(tone: ReplayReviewTone): string | undefined {
  if (tone === 'alert') return tones.toneAlert;
  if (tone === 'peak') return tones.tonePeak;
  if (tone === 'commit') return tones.toneCommit;
  return undefined;
}

/**
 * What is true AT the playhead — the two readings that exist only because
 * there is a playhead. Everything else in this pane is a running total, which
 * converges on the scope totals Summary already states; a rate and a
 * concurrency do not.
 */
function PlayheadNow({ now }: { now: ReplayNowModel }) {
  if (now.runningSessionCount === 0) {
    return (
      <p className={styles.gap}>
        {now.sessionCount > 0
          ? 'No session was running at this point.'
          : 'No sessions in this replay scope.'}
      </p>
    );
  }

  const burn = now.burnRateUsdPerMin;
  return (
    <div className={styles.hero}>
      <div className={styles.heroStat}>
        <span
          className={clsx(styles.heroValue, burn == null && styles.heroValueAbsent)}
          title={
            burn == null
              ? 'No measured spend covers this point — the running sessions are unpriced or between activity buckets.'
              : undefined
          }
        >
          {burn == null ? '—' : formatRate(burn)}
        </span>
        <span className={styles.heroLabel}>Burn now</span>
      </div>
      {now.sessionCount > 1 ? (
        <div className={styles.heroStat}>
          <span className={styles.heroValue}>
            {now.runningSessionCount.toLocaleString()}
            <span className={styles.heroOf}>{` of ${now.sessionCount.toLocaleString()}`}</span>
          </span>
          <span className={styles.heroLabel}>Running</span>
        </div>
      ) : null}
    </div>
  );
}

/** One running total. Compact by design — six of these cost less room than four stat cards. */
function LedgerRow({
  label,
  value,
  bucketDelta = 0,
  deltaFormat = 'count',
  note,
  tone,
}: {
  label: string;
  value: string;
  bucketDelta?: number;
  deltaFormat?: 'count' | 'usd';
  note?: string;
  tone?: 'alert';
}) {
  return (
    <div className={styles.ledgerRow}>
      <dt className={styles.ledgerLabel}>{label}</dt>
      <dd className={styles.ledgerValue}>
        <span className={clsx(styles.ledgerNumber, tone === 'alert' && styles.ledgerAlert)}>
          {value}
        </span>
        {note ? <span className={styles.ledgerNote}>{note}</span> : null}
        {bucketDelta > 0 ? (
          <InlineDelta
            value={bucketDelta}
            format={deltaFormat}
            comparison="This time bucket at the playhead"
          />
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Running totals through the playhead. A row appears when the SCOPE captured
 * something behind it — "0 errors" is a real absence once tool calls are being
 * logged, and a claim we have no right to make when they are not.
 */
function PlayheadLedger({ now }: { now: ReplayNowModel }) {
  return (
    <dl
      className={styles.ledger}
      aria-label={`Totals from the start of the scope through ${now.clock}`}
    >
      <LedgerRow
        label="Cost"
        value={formatCost(now.costUsd)}
        bucketDelta={now.bucketCostUsd}
        deltaFormat="usd"
        {...(now.costShare != null
          ? { note: `${Math.round(now.costShare * 100)}% of scope` }
          : {})}
      />
      <LedgerRow
        label="Tool calls"
        value={now.toolCallCount.toLocaleString()}
        bucketDelta={now.bucketToolCallCount}
      />
      <LedgerRow
        label="Tokens"
        value={formatTokens(now.tokensTotal)}
        bucketDelta={now.bucketTokensTotal}
      />
      {now.captured.toolCalls ? (
        <LedgerRow
          label="Errors"
          value={now.errorCount.toLocaleString()}
          {...(now.errorCount > 0 ? { tone: 'alert' as const } : {})}
        />
      ) : null}
      {now.captured.checks ? (
        <LedgerRow
          label="Checks failed"
          // No check has run yet, so there is no ratio to report — a "0 of 0"
          // would read as a clean run rather than as nothing measured.
          value={
            now.checkCount === 0
              ? '—'
              : `${now.checkFailedCount.toLocaleString()} of ${now.checkCount.toLocaleString()}`
          }
          {...(now.checkFailedCount > 0 ? { tone: 'alert' as const } : {})}
        />
      ) : null}
      {now.captured.prompts ? (
        <LedgerRow label="Messages sent" value={now.promptCount.toLocaleString()} />
      ) : null}
    </dl>
  );
}

function ItemButton({
  item,
  nearPlayhead,
  lifecycle,
  onJump,
}: {
  item: ReplayReviewItem;
  nearPlayhead: boolean;
  lifecycle: boolean;
  onJump: (elapsedMs: number) => void;
}) {
  const line = formatEventLogLine(item);

  return (
    <button
      type="button"
      className={clsx(
        styles.itemButton,
        lifecycle && styles.itemLifecycle,
        !lifecycle && toneClass(item.tone),
        nearPlayhead && tones.itemNearPlayhead,
      )}
      onClick={() => onJump(item.elapsedMs)}
      aria-label={`Jump to ${line}${nearPlayhead ? ' (closest to playhead)' : ''} at ${item.timeLabel}`}
    >
      <span className={styles.itemTime}>{item.timeLabel}</span>
      <ProjectSquircle
        projectKey={projectSquircleKey(item.repoId, item.project)}
        size="sm"
        className={styles.itemProjectMark}
      />
      <span className={styles.itemSentence}>{line}</span>
    </button>
  );
}

export default function ReplayReviewConsole({
  model,
  mode,
  onModeChange,
  onJumpToMs,
}: {
  model: ReplayReviewModel;
  mode: NarrativeMode;
  onModeChange: (mode: NarrativeMode) => void;
  onJumpToMs: (elapsedMs: number) => void;
}) {
  const { now, queueItems, lifecycleItems } = model;
  const closestPlayheadId = now.items[0]?.id;
  const playheadNearIds = new Set(closestPlayheadId ? [closestPlayheadId] : []);
  const momentRows = buildUnifiedMomentList({
    mode,
    nowItems: now.items,
    queueItems,
    lifecycleItems,
    playheadNearIds,
  });

  return (
    <section className={styles.console} aria-label="Replay review console">
      <h2 className={styles.clock}>
        {now.stamp ? <span className={styles.stamp}>{now.stamp}</span> : null}
        <span className={styles.elapsed}>{`${now.clock} in`}</span>
      </h2>

      <PlayheadNow now={now} />

      <div className={styles.through}>
        <span className={styles.throughLabel}>Through here</span>
        <PlayheadLedger now={now} />
      </div>

      <div className={styles.filterRow}>
        <span className={styles.eventLogTitle}>
          <span className={styles.eventLogEyebrow}>{REPLAY_EVENT_LOG_EYEBROW}</span>
          <Tooltip
            label={EVENT_LOG_ROW_LEGEND_ARIA}
            content={<EventLogRowLegendContent />}
            placement="bottom"
          >
            <button type="button" className={styles.eventLogLegendTrigger} aria-label="Row colors">
              ?
            </button>
          </Tooltip>
        </span>
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          ariaLabel={REPLAY_EVENT_LOG_FILTER_ARIA_LABEL}
          options={NARRATIVE_MODE_OPTIONS.map(({ mode: option, shortLabel }) => ({
            value: option,
            label: shortLabel,
          }))}
          renderOption={(option, button) => {
            const hint = NARRATIVE_MODE_OPTIONS.find((entry) => entry.mode === option.value)?.hint ?? '';
            return (
              <Tooltip key={option.value} label={hint} placement="bottom" wrap>
                {button}
              </Tooltip>
            );
          }}
        />
      </div>

      <div className={styles.list} aria-label={REPLAY_EVENT_LOG_ARIA_LABEL}>
        {momentRows.length === 0 ? (
          <span className={styles.empty}>{reviewQueueEmptyMessage(mode)}</span>
        ) : (
          momentRows.map(({ item, nearPlayhead, lifecycle }) => (
            <ItemButton
              key={item.id}
              item={item}
              nearPlayhead={nearPlayhead}
              lifecycle={lifecycle}
              onJump={onJumpToMs}
            />
          ))
        )}
      </div>
    </section>
  );
}
