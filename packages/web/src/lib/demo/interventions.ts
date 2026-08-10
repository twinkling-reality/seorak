// Demo fired-interventions, DEMO ONLY. The wedge engine fires on the worker and
// is surfaced via GET /interventions; demo mode has no worker, so this derives a
// believable fired list from the demo overview's own live sessions:
//   stuck  → stuck_loop
//   idle   → went_cold (when silence clears the default threshold)
//   pricey → cost_spike
// Catalog copy (signalLabel, interruptionLevel, body) comes from SIGNAL_CATALOG /
// buildSignalBody so demo never hand-writes push sentences that could drift.
// The LIVE path NEVER uses this — it reads the real /interventions response.
import {
  DEFAULT_THRESHOLDS,
  SIGNAL_CATALOG,
  buildSignalBody,
} from '@seorak/types';
import type { Intervention, OverviewSnapshot } from '../apiSchemas.js';

function silentMinutes(lastEventAt: string, nowMs: number): number {
  const last = Date.parse(lastEventAt);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, Math.floor((nowMs - last) / 60_000));
}

export function buildDemoInterventions(overview: OverviewSnapshot): Intervention[] {
  const live = overview.live;
  if (live.length === 0) return [];

  const nowMs = Date.now();
  const out: Intervention[] = [];
  const usedSessionIds = new Set<string>();

  const stuck = live.find((s) => s.status === 'stuck');
  if (stuck) {
    const meta = SIGNAL_CATALOG.stuck_loop;
    const tool = stuck.currentTool ?? 'Bash';
    out.push({
      kind: 'stuck_loop',
      sessionId: stuck.sessionId,
      project: stuck.project,
      repoId: stuck.repoId,
      triggeredAt: stuck.lastEventAt,
      signalLabel: meta.label,
      body: buildSignalBody({
        signalId: 'stuck_loop',
        tool,
        count: Math.max(3, DEFAULT_THRESHOLDS.stuckLoopRepeatedToolCalls),
        failing: true,
      }),
      deepLink: `seorak://session/${stuck.sessionId}`,
      interruptionLevel: meta.interruptionLevel,
    });
    usedSessionIds.add(stuck.sessionId);
  }

  const idle = live.find(
    (s) =>
      s.status === 'idle' &&
      !usedSessionIds.has(s.sessionId) &&
      silentMinutes(s.lastEventAt, nowMs) >= DEFAULT_THRESHOLDS.wentColdMinutes,
  );
  if (idle) {
    const meta = SIGNAL_CATALOG.went_cold;
    const quiet = Math.max(
      DEFAULT_THRESHOLDS.wentColdMinutes,
      silentMinutes(idle.lastEventAt, nowMs),
    );
    out.push({
      kind: 'went_cold',
      sessionId: idle.sessionId,
      project: idle.project,
      repoId: idle.repoId,
      triggeredAt: idle.lastEventAt,
      signalLabel: meta.label,
      body: buildSignalBody({ signalId: 'went_cold', silentMinutes: quiet }),
      deepLink: `seorak://session/${idle.sessionId}`,
      interruptionLevel: meta.interruptionLevel,
    });
    usedSessionIds.add(idle.sessionId);
  }

  const priciest = [...live]
    .filter((s) => !usedSessionIds.has(s.sessionId))
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))[0];
  if (priciest && priciest.costUsd != null && priciest.costUsd >= DEFAULT_THRESHOLDS.costSpikeUsd) {
    const meta = SIGNAL_CATALOG.cost_spike;
    out.push({
      kind: 'cost_spike',
      sessionId: priciest.sessionId,
      project: priciest.project,
      repoId: priciest.repoId,
      triggeredAt: priciest.lastEventAt,
      signalLabel: meta.label,
      body: buildSignalBody({
        signalId: 'cost_spike',
        costUsd: priciest.costUsd,
        capUsd: DEFAULT_THRESHOLDS.costSpikeUsd,
      }),
      deepLink: `seorak://session/${priciest.sessionId}`,
      interruptionLevel: meta.interruptionLevel,
    });
  }

  return out;
}
