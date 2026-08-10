import ProjectSquircle from '../../../components/ProjectSquircle/ProjectSquircle.js';
import styles from './EventLogRowLegend.module.css';
import tones from './replayEventTones.module.css';

const LEGEND_ROWS = [
  { key: 'project', label: 'Project', swatch: 'project' as const },
  { key: 'alert', label: 'Tool error', swatch: 'alert' as const },
  { key: 'peak', label: 'Cost spike', swatch: 'peak' as const },
  { key: 'commit', label: 'Commit', swatch: 'commit' as const },
  { key: 'playhead', label: 'At playhead', swatch: 'playhead' as const },
  { key: 'lifecycle', label: 'Session start or end', swatch: 'lifecycle' as const },
] as const;

function LegendSwatch({ kind }: { kind: (typeof LEGEND_ROWS)[number]['swatch'] }) {
  if (kind === 'project') {
    return <ProjectSquircle projectKey="seorak" size="xs" className={styles.projectMark} />;
  }
  return <span className={tones.swatch} data-kind={kind} aria-hidden="true" />;
}

export function EventLogRowLegendContent() {
  return (
    <>
      {LEGEND_ROWS.map(({ key, label, swatch }) => (
        <span key={key} className={styles.legendRow}>
          <LegendSwatch kind={swatch} />
          <span className={styles.legendLabel}>{label}</span>
        </span>
      ))}
    </>
  );
}

export const EVENT_LOG_ROW_LEGEND_ARIA =
  'Project squircle, amber tool error, lavender cost spike, green commit, brighter lavender at playhead, dashed session start or end';
