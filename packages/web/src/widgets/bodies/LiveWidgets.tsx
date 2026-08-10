import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { readinessSectionText } from './shared.js';
import SectionOverflow from '../../components/SectionOverflow/SectionOverflow.js';
import LiveSessionsTable from '../../components/LiveSessionsTable/LiveSessionsTable.js';
import { AnnotatedStrip, type AnnotatedStripSegment } from './atoms/AnnotatedStrip.js';
import { StripFaceHead } from './atoms/StripFaceHead.js';
import { formatDuration } from '../../lib/utils.js';
import { projectAccent } from '../../lib/projectGradient.js';
import { setQueryParam } from '../../lib/router.js';
import { fileCategoryFill, fileCategoryLabel } from '../../lib/codebaseCategory.js';
import styles from './LiveWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

// Simultaneous-visibility cap for the live session board. Beyond this the
// horizontal table starts to overflow its slot, so the rest collapse behind a
// SectionOverflow link rather than scrolling silently off the bottom.
const LIVE_SESSIONS_CAP = 8;

// ── live-sessions (the HERO) ────────────────────────
function LiveSessionsWidget({ liveSessions, overview, capture }: WidgetBodyProps) {
  if (liveSessions.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'live-sessions',
          overview,
          capture,
          'No sessions running right now',
        )}
      </SectionEmpty>
    );
  }

  const visible = liveSessions.slice(0, LIVE_SESSIONS_CAP);
  const overflow = liveSessions.length - visible.length;

  return (
    <LiveSessionsTable
      sessions={visible}
      onRowClick={(s) => setQueryParam('live', s.sessionId)}
      footer={
        overflow > 0 ? (
          <SectionOverflow
            count={overflow}
            label={overflow === 1 ? 'session' : 'sessions'}
            onClick={() => setQueryParam('live', '')}
          />
        ) : undefined
      }
    />
  );
}

// ── files in play ──────────────────────────────
//
// One object: a live attention strip (the canonical Share face, same family
// as tool-mix). Segment width = share of edits by current sessions, segment
// color = the file's KIND (the collector's on-machine FileCategory enum,
// validated --viz-cat-* palette). Identity + quantity live in the strip's
// LEGEND (swatch + name + edit count) — never text on the marks, never a
// dangling callout. All-or-nothing color rule: if ANY visible file lacks a
// category (older collector rows), every segment falls back to the project
// accent — one color SYSTEM per render, never a mixed guess. Scale story:
// 1 file = one full-width segment; many files = everything past the top N
// folds into one neutral tail with a "+N more" legend entry. Hover title
// carries project/kind/recency; the whole tile drills into the live Files
// tab for the full list.
const FILES_STRIP_TOP_N = 4;
const FILES_TAIL_KEY = '__tail__';

function FilesInPlayWidget({ overview, capture }: WidgetBodyProps) {
  const inPlay = overview.codebase.filesInPlay;
  if (inPlay === null || inPlay.files.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'files-in-play',
          overview,
          capture,
          'No files in play right now',
        )}
      </SectionEmpty>
    );
  }

  // Hottest-first from the server. Files past the server cap join the tail's
  // LABEL count (real) but not its width — no fabricated share for edits we
  // never received.
  const files = inPlay.files;
  const visible = files.slice(0, FILES_STRIP_TOP_N);
  const tail = files.slice(FILES_STRIP_TOP_N);
  const tailEdits = tail.reduce((sum, f) => sum + f.edits, 0);
  const tailCount = tail.length + Math.max(0, inPlay.distinctFiles - files.length);

  const fileLabel = (f: { label: string | null; fileId: string }) =>
    f.label ?? `${f.fileId.slice(0, 10)}…`;

  // Category color only when EVERY visible file carries one; otherwise the
  // whole strip reads project accent (one color system per render).
  const categoriesComplete = visible.every((f) => f.category != null);

  const segments: AnnotatedStripSegment[] = [
    ...visible.map((f) => ({
      key: f.fileId,
      value: f.edits,
      // Solid fills only, never the chip gradient: a gradient stretched
      // across a segment renders the SAME entity as different colors per
      // segment width.
      color: categoriesComplete
        ? fileCategoryFill(f.category as string)
        : projectAccent(f.projects[0]?.project ?? ''),
      label: fileLabel(f),
    })),
    ...(tailCount > 0
      ? [
          {
            key: FILES_TAIL_KEY,
            value: tailEdits,
            // Fixed neutral (not var(--soft), a theme-flipping text token):
            // data fills stay fixed-lightness so the inline label holds.
            color: 'hsl(222, 8%, 74%)',
            label: `+${tailCount} more`,
          },
        ]
      : []),
  ];

  const titleFor = (s: AnnotatedStripSegment): string => {
    if (s.key === FILES_TAIL_KEY) {
      return `${tailCount} more ${tailCount === 1 ? 'file' : 'files'}`;
    }
    const f = files.find((x) => x.fileId === s.key);
    if (!f) return s.label;
    // Coarse recency on purpose: this signal rides the 30s overview poll,
    // so second-level precision would be theater. formatDuration floors at <1m.
    const minutesAgo = Math.floor((Date.now() - Date.parse(f.lastEditedAt)) / 60_000);
    const where =
      f.projects.length > 1
        ? `across ${f.projects.map((p) => `${p.project} (${p.edits})`).join(', ')}`
        : f.projects[0]
          ? `in ${f.projects[0].project}`
          : '';
    // The kind is named in text whenever color encodes it (never color-alone).
    const kind = categoriesComplete && f.category ? `, ${fileCategoryLabel(f.category)}` : '';
    return `${fileLabel(f)}: ${f.edits} ${f.edits === 1 ? 'edit' : 'edits'}${where ? ` ${where}` : ''}${kind}, last edit ${formatDuration(minutesAgo)} ago`;
  };

  return (
    <div className={styles.fileTargets}>
      <StripFaceHead
        value={inPlay.distinctFiles.toLocaleString()}
        caption={inPlay.distinctFiles === 1 ? 'file in play now' : 'files in play now'}
      />
      <AnnotatedStrip
        segments={segments}
        ariaLabel="Share of live edits by file"
        titleFor={titleFor}
        // The tail's label ("+N more") already is its fact. Every number
        // carries its unit in text — a bare "5" makes the reader infer
        // (bare-numbers ban, DASHBOARD-CLARITY Precedent 1).
        legendValueFor={(s) =>
          s.key === FILES_TAIL_KEY
            ? null
            : `${s.value.toLocaleString()} ${s.value === 1 ? 'edit' : 'edits'}`
        }
      />
    </div>
  );
}

export const liveWidgets: WidgetRegistry = {
  'live-sessions': LiveSessionsWidget,
  'files-in-play': FilesInPlayWidget,
};
