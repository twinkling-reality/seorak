import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { readinessSectionText } from './shared.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { ShareFaceFrame } from './atoms/ShareFaceFrame.js';
import { STRIP_TAIL_FILL, vizSeqColor } from './atoms/shareStripRamp.js';
import type { AnnotatedStripSegment } from './atoms/AnnotatedStrip.js';
import { codebaseRepoHint } from './atoms/codebaseRepoHint.js';

/**
 * Codebase widgets — the file/directory/commit axis, fed by the collector's
 * salted fileId signal (CAPTURE-PRINCIPLE: ids + counts ship, paths never do).
 *
 * Share-face family (StripFaceHead + AnnotatedStrip + legend):
 *   - top files: edit-share strip (where heat concentrates)
 *   - file-rework: session-share strip (what keeps coming back across sessions)
 *   - top directories: directory-share strip
 *
 * file-rework uses the same face as files; the unit differs (sessions vs edits).
 * Edits are hover-only secondary — the face answers recurrence, not edit volume.
 */

const STRIP_TOP_N = 5;
const TAIL_KEY = '__tail__';

function fileLabel(label: string | null, id: string): string {
  return label ?? `${id.slice(0, 10)}…`;
}

const LABELS_HINT =
  'Salted ids until File labels is enabled in Settings → Data & capture.';

function anyUnlabeled(rows: ReadonlyArray<{ label: string | null }>): boolean {
  return rows.some((r) => r.label === null);
}

function foldStrip<T>(
  sorted: ReadonlyArray<T>,
  metric: (row: T) => number,
  toSegment: (row: T, index: number) => AnnotatedStripSegment,
): AnnotatedStripSegment[] {
  const visible = sorted.slice(0, STRIP_TOP_N);
  const tail = sorted.slice(STRIP_TOP_N);
  const tailTotal = tail.reduce((s, row) => s + metric(row), 0);
  return [
    ...visible.map((row, i) => toSegment(row, i)),
    ...(tail.length > 0
      ? [
          {
            key: TAIL_KEY,
            value: tailTotal,
            color: STRIP_TAIL_FILL,
            label: `+${tail.length} more`,
          },
        ]
      : []),
  ];
}

function FilesWidget({ overview, capture }: WidgetBodyProps) {
  const files = overview.codebase.files;
  if (files.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText('files', overview, capture, 'Fills in as edits land')}
      </SectionEmpty>
    );
  }

  const sorted = [...files].sort((a, b) => b.edits - a.edits);
  const top = sorted[0];
  const topName = fileLabel(top.label, top.fileId);

  const segments = foldStrip(sorted, (f) => f.edits, (f, i) => ({
    key: f.fileId,
    value: f.edits,
    color: vizSeqColor(i),
    label: fileLabel(f.label, f.fileId),
  }));

  return (
    <ShareFaceFrame
      value={top.edits.toLocaleString()}
      caption={`edits on ${topName}`}
      headTitle={anyUnlabeled(files) ? LABELS_HINT : undefined}
      strip={{
        segments,
        ariaLabel: 'Share of edits by file',
        titleFor: (s) => {
          if (s.key === TAIL_KEY) {
            const tail = sorted.slice(STRIP_TOP_N);
            return `${tail.length} more ${tail.length === 1 ? 'file' : 'files'}`;
          }
          const f = sorted.find((x) => x.fileId === s.key);
          if (!f) return s.label;
          const linesMeasured = f.linesAdded !== 0 || f.linesRemoved !== 0;
          const lines = linesMeasured
            ? `, +${f.linesAdded.toLocaleString()}/−${f.linesRemoved.toLocaleString()} lines`
            : '';
          const where = codebaseRepoHint(f.projects);
          return `${s.label}: ${f.edits} ${f.edits === 1 ? 'edit' : 'edits'}${lines}${where}`;
        },
        legendValueFor: (s) =>
          s.key === TAIL_KEY
            ? null
            : `${s.value.toLocaleString()} ${s.value === 1 ? 'edit' : 'edits'}`,
      }}
    />
  );
}

function DirectoriesWidget({ overview, capture }: WidgetBodyProps) {
  const dirs = overview.codebase.directories;
  if (dirs.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText('directories', overview, capture, 'Fills in as edits land')}
      </SectionEmpty>
    );
  }

  const sorted = [...dirs].sort((a, b) => b.edits - a.edits);
  const top = sorted[0];
  const topName = fileLabel(top.label, top.dirId);

  const segments = foldStrip(sorted, (d) => d.edits, (d, i) => ({
    key: d.dirId,
    value: d.edits,
    color: vizSeqColor(i),
    label: fileLabel(d.label, d.dirId),
  }));

  return (
    <ShareFaceFrame
      value={`${Math.round(top.share * 100)}%`}
      caption={`of edits in ${topName}`}
      headTitle={anyUnlabeled(dirs) ? LABELS_HINT : undefined}
      strip={{
        segments,
        ariaLabel: 'Share of edits by directory',
        titleFor: (s) => {
          if (s.key === TAIL_KEY) {
            const tail = sorted.slice(STRIP_TOP_N);
            return `${tail.length} more ${tail.length === 1 ? 'directory' : 'directories'}`;
          }
          const d = sorted.find((x) => x.dirId === s.key);
          if (!d) return s.label;
          const where = codebaseRepoHint(d.projects);
          return `${s.label}: ${Math.round(d.share * 100)}% of edits (${d.edits} ${
            d.edits === 1 ? 'edit' : 'edits'
          })${where}`;
        },
        legendValueFor: (s) => {
          if (s.key === TAIL_KEY) return null;
          const d = sorted.find((x) => x.dirId === s.key);
          return d ? `${Math.round(d.share * 100)}%` : null;
        },
      }}
    />
  );
}

function FileReworkWidget({ overview, capture }: WidgetBodyProps) {
  const rework = overview.codebase.rework;
  if (rework.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText('file-rework', overview, capture, 'Nothing recurring')}
      </SectionEmpty>
    );
  }

  const sorted = [...rework].sort((a, b) => b.sessions - a.sessions);
  const top = sorted[0];
  const topName = fileLabel(top.label, top.fileId);

  const segments = foldStrip(sorted, (f) => f.sessions, (f, i) => ({
    key: f.fileId,
    value: f.sessions,
    color: vizSeqColor(i),
    label: fileLabel(f.label, f.fileId),
  }));

  return (
    <ShareFaceFrame
      value={top.sessions.toLocaleString()}
      caption={`sessions on ${topName}`}
      headTitle={anyUnlabeled(rework) ? LABELS_HINT : undefined}
      strip={{
        segments,
        ariaLabel: 'Share of recurring sessions by file',
        titleFor: (s) => {
          if (s.key === TAIL_KEY) {
            const tail = sorted.slice(STRIP_TOP_N);
            return `${tail.length} more ${tail.length === 1 ? 'file' : 'files'}`;
          }
          const f = sorted.find((x) => x.fileId === s.key);
          if (!f) return s.label;
          const where = codebaseRepoHint(f.projects);
          return `${s.label}: ${f.sessions} ${
            f.sessions === 1 ? 'session' : 'sessions'
          }, ${f.edits.toLocaleString()} ${f.edits === 1 ? 'edit' : 'edits'} total${where}`;
        },
        legendValueFor: (s) =>
          s.key === TAIL_KEY
            ? null
            : `${s.value.toLocaleString()} ${s.value === 1 ? 'session' : 'sessions'}`,
      }}
    />
  );
}

export const codebaseWidgets: WidgetRegistry = {
  directories: DirectoriesWidget,
  files: FilesWidget,
  'file-rework': FileReworkWidget,
};
