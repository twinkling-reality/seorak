import { useEffect, useState } from 'react';
import type {
  PushDeliveryEnvironmentHealth,
  PushDeliveryHealth,
} from '@seorak/types';
import { DetailSection } from '../../components/DetailView/index.js';
import { fetchPushDeliveryHealth } from '../../lib/api.js';
import { isDemoActive } from '../../lib/demoMode.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import {
  pushDeliveryHealthSchema,
  validateResponse,
} from '../../lib/schemas/index.js';
import styles from './SettingsView.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; health: PushDeliveryHealth }
  | { kind: 'unavailable' };

function countPhrase(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function deliveryEnvironmentSummary(
  health: PushDeliveryEnvironmentHealth,
): string {
  const devices = countPhrase(health.registeredDevices, 'registered device');
  if (health.state === 'unobserved') {
    return `${devices}. No completed push attempt was observed in the last 30 days.`;
  }

  const attempts = countPhrase(health.completedAttempts, 'completed attempt');
  const accepted = health.lastAcceptedAt
    ? `Last APNs acceptance ${formatRelativeTime(health.lastAcceptedAt) ?? 'at an unknown time'}.`
    : 'No APNs acceptance was observed in the window.';
  const terminal =
    health.terminalFailures === 0
      ? 'No terminal failures were recorded in the observed attempts.'
      : `${countPhrase(health.terminalFailures, 'terminal failure')}; most recent ${
          formatRelativeTime(health.lastTerminalAt) ?? 'at an unknown time'
        }.`;
  return `${devices}. ${attempts}. ${accepted} ${terminal}`;
}

export default function DeliveryHealthSection() {
  const [state, setState] = useState<State>(() =>
    isDemoActive() ? { kind: 'unavailable' } : { kind: 'loading' },
  );

  useEffect(() => {
    if (isDemoActive()) return;
    const controller = new AbortController();
    void fetchPushDeliveryHealth({ signal: controller.signal })
      .then((body) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'ready',
          health: validateResponse(
            pushDeliveryHealthSchema,
            body,
            'push delivery health',
          ),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'unavailable' });
      });
    return () => controller.abort();
  }, []);

  return (
    <DetailSection label="Push delivery">
      {state.kind === 'loading' ? (
        <span className={styles.notifyEmpty}>Loading delivery history…</span>
      ) : state.kind === 'unavailable' ? (
        <span className={styles.settingsUnavailable}>
          Delivery history is unavailable. No delivery-health claim can be made.
        </span>
      ) : (
        <div className={styles.deliveryHealth} data-testid="push-delivery-health">
          <div>
            <span className={styles.deliveryHealthLabel}>Production</span>
            <span>{deliveryEnvironmentSummary(state.health.environments.production)}</span>
          </div>
          <div>
            <span className={styles.deliveryHealthLabel}>Development</span>
            <span>{deliveryEnvironmentSummary(state.health.environments.development)}</span>
          </div>
          <span className={styles.notifyEmpty}>
            Durable worker history, trailing {state.health.windowDays} days. APNs
            acceptance does not prove device display.
          </span>
        </div>
      )}
    </DetailSection>
  );
}
