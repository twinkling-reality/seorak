import { useEffect, useState } from 'react';
import type { DataPlaneStatus } from '@seorak/types/data-plane';
import { DetailSection } from '../../components/DetailView/index.js';
import { probeDataPlane } from '../../lib/dataPlane.js';
import { isDemoActive } from '../../lib/demoMode.js';
import {
  completenessSummary,
  coverageSummary,
  lifecycleSummary,
  operatorSummary,
  planLabel,
  unavailableSurfacesSummary,
} from './managedPlanCopy.js';
import styles from './SettingsView.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; status: DataPlaneStatus }
  | { kind: 'unavailable' };

/**
 * Which plane this dashboard is reading, how much of the local record a remote
 * copy actually holds, and the exact dates a managed subscription ends and its
 * copy is deleted.
 *
 * A deployment that does not answer `GET /data-plane` renders as unavailable
 * rather than as "no plan": an unknown authority is not a claim that there is
 * nothing hosted.
 */
export default function ManagedPlanSection({ className }: { className?: string }) {
  const [state, setState] = useState<State>(() =>
    isDemoActive() ? { kind: 'unavailable' } : { kind: 'loading' },
  );

  useEffect(() => {
    if (isDemoActive()) return;
    let cancelled = false;
    void probeDataPlane().then((status) => {
      if (cancelled) return;
      setState(status ? { kind: 'ready', status } : { kind: 'unavailable' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <DetailSection label="Plan" className={className}>
        <span className={styles.notifyEmpty}>Checking where this dashboard is reading…</span>
      </DetailSection>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <DetailSection label="Plan" className={className}>
        <span className={styles.settingsUnavailable}>
          This deployment does not report which data plane it serves, so no plan or
          sync claim can be made here.
        </span>
      </DetailSection>
    );
  }

  const { status } = state;
  const missingSurfaces = unavailableSurfacesSummary(status);
  return (
    <DetailSection label="Plan" className={className}>
      <div className={styles.deliveryHealth} data-testid="managed-plan">
        <div>
          <span className={styles.deliveryHealthLabel}>{planLabel(status)}</span>
          <span>{operatorSummary(status)}</span>
        </div>
        <div>
          <span className={styles.deliveryHealthLabel}>What you are reading</span>
          <span>{completenessSummary(status)}</span>
        </div>
        {status.coverage ? (
          <div data-testid="managed-plan-coverage">
            <span className={styles.deliveryHealthLabel}>Managed copy</span>
            <span>{coverageSummary(status.coverage).join(' ')}</span>
          </div>
        ) : null}
        {status.lifecycle ? (
          <div data-testid="managed-plan-lifecycle">
            <span className={styles.deliveryHealthLabel}>Subscription</span>
            <span>{lifecycleSummary(status.lifecycle).join(' ')}</span>
          </div>
        ) : null}
        {missingSurfaces ? (
          <span className={styles.settingsUnavailable} data-testid="managed-plan-surfaces">
            {missingSurfaces}
          </span>
        ) : null}
        {status.rebaseline?.required ? (
          <span className={styles.notifyEmpty}>
            The managed side has asked for a fresh copy. Your computer resends from its
            own history, and nothing local is removed to do it.
          </span>
        ) : null}
      </div>
    </DetailSection>
  );
}
