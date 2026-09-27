import { useState } from 'react';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import FloatingBanner from '../../components/Banner/FloatingBanner.jsx';
import RangePills from '../../components/RangePills/RangePills.jsx';
import { ShimmerText, SkeletonLine } from '../../components/Skeleton/Skeleton.jsx';
import { useAuthStore } from '../../lib/stores/auth.js';
import { useDeveloperModel } from '../../hooks/useDeveloperModel.js';
import { refreshModel, MODEL_DEFAULT_RANGE_DAYS, type ModelRangeDays } from '../../lib/stores/model.js';
import { useAllowedRanges, useProjectOptions } from '../../hooks/useOverview.js';
import { isDemoActive } from '../../lib/demoMode.js';
import ModelNarrativeRead from './ModelNarrativeRead.js';
import ModelScopePicker from './ModelScopePicker.js';
import styles from './ModelView.module.css';

/** The read is an editorial prose column, so its loading state is a forming
 *  paragraph (a shimmering lead over a few skeleton measures) rather than a stat
 *  grid — honest "still reading", never a fake progress bar. */
function ModelReadSkeleton() {
  return (
    <div className={styles.column} aria-hidden="true">
      <ShimmerText as="p" className={styles.skeletonLead}>
        Reading your recent work
      </ShimmerText>
      <div className={styles.skeletonLines}>
        <SkeletonLine width="94%" height={24} />
        <SkeletonLine width="100%" height={24} delay={80} />
        <SkeletonLine width="88%" height={24} delay={160} />
        <SkeletonLine width="62%" height={24} delay={240} />
      </div>
    </div>
  );
}

/**
 * ModelView — introspection pillar (docs/specs/introspection.md).
 * Identity-led period portrait: a calm editorial read of who you've been
 * lately, with each color-coded insight opening its cited detail in place.
 * Presentation is compiler-owned; this view only renders it.
 */
export default function ModelView() {
  const user = useAuthStore((s) => s.user);
  const displayName = user?.handle?.trim() || 'You';
  // The read defaults to the same window Overview leads with (7d); the picker lets
  // the user widen for a longer portrait. Bounded to the windows this deployment's
  // plan will build, so it never asks for a range the worker would clamp — the
  // clamp is enforced server-side either way, this keeps the label truthful.
  const [rangeDays, setRangeDays] = useState<ModelRangeDays>(MODEL_DEFAULT_RANGE_DAYS);
  // null = the merged portrait. A repo scope re-fetches rather than filtering
  // client-side: every rate in the read (survival, shipping, the daypart slices)
  // has a denominator only the worker can recompute for one repo, so a local
  // filter would leave the prose scoped and the numbers global.
  const [repoId, setRepoId] = useState<string | null>(null);
  const ranges = useAllowedRanges();
  const projects = useProjectOptions(rangeDays);
  const { presentation, isLoading, error, isStale } = useDeveloperModel(rangeDays, {
    displayName,
    repoId,
  });

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Introspection" title="Model" demo={isDemoActive()} />

      <div className={styles.controls}>
        <ModelScopePicker projects={projects} selected={repoId} onChange={setRepoId} />
        <RangePills
          value={rangeDays}
          onChange={(v) => setRangeDays(v as ModelRangeDays)}
          options={ranges}
        />
      </div>

      {/* A failed refresh with a prior read in hand floats a non-blocking
        * reconnecting cue instead of dropping the portrait (mirror Overview). */}
      {isStale && (
        <FloatingBanner
          variant="info"
          eyebrow="Reconnecting"
          actions={[{ label: 'Retry', onClick: refreshModel }]}
        >
          Showing the last read of your recent work. The latest refresh didn’t land.
        </FloatingBanner>
      )}

      <div className={styles.body}>
        {isLoading ? (
          <ModelReadSkeleton />
        ) : error ? (
          <StatusState
            tone="danger"
            eyebrow="Model unavailable"
            title="Could not read your recent work"
            // Not "the worker" — that is Cloudflare deployment vocabulary naming a
            // component of Seorak's own infrastructure that the reader has never
            // been shown and cannot act on, and "build your model" reads as
            // something they own and might have broken.
            hint="Seorak could not reach your data just now. Nothing has been lost, and a retry usually clears it."
            detail={error}
            meta="Introspection"
            actionLabel="Retry"
            onAction={refreshModel}
          />
        ) : (
          <ModelNarrativeRead presentation={presentation} />
        )}
      </div>

      {/* No coverage footing. The phone states its window in a footing because it
        * has no range control; web has both controls sitting above the read, so a
        * footing repeating them is the same two facts printed twice. */}
    </div>
  );
}
