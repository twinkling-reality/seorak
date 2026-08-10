// Demo replay fixtures (DEMO ONLY). Builds a believable replay payload for a
// demo session so ?demo can exercise the ReplayView's populated state.
// Capability-shaped: tool vocabulary follows the agent; cost/token buckets follow
// whether the session is priced. Codex keeps Shell/ApplyPatch moments and skips
// verification keyframes (`verification: 'none'`).

import type {
  Keyframe,
  ReplayActivityBucket,
  ReplayMoment,
  ReplaySession,
  SessionSummary,
} from './../apiSchemas.js';

const CLAUDE_TOOLS = ['Read', 'Edit', 'Bash', 'Grep', 'Edit', 'Read', 'Bash', 'Edit'] as const;
const CODEX_TOOLS = ['Shell', 'ApplyPatch', 'Shell', 'ApplyPatch', 'Shell', 'ApplyPatch'] as const;

/**
 * Build a deterministic replay for a demo session: keyframes, activity buckets,
 * and moments spread across the elapsed window.
 */
export function buildDemoReplay(session: SessionSummary): ReplaySession {
  const startMs = Date.parse(session.startedAt);
  const elapsedMs = Math.max(60_000, session.elapsedSeconds * 1000);
  const at = (frac: number) => new Date(startMs + Math.round(elapsedMs * frac)).toISOString();
  const ended = session.status === 'ended';
  const endIso = ended ? session.endedAt ?? at(1) : at(1);
  const isCodex = session.agent === 'codex';
  const unpriced = session.costUsd == null;
  const tools = isCodex ? CODEX_TOOLS : CLAUDE_TOOLS;
  const firstTool = tools[0]!;

  const keyframes: Keyframe[] = [
    { kind: 'session-start', at: at(0), seq: 0, label: 'Session started', detail: session.project || undefined },
    { kind: 'first-tool-call', at: at(0.08), seq: 4, label: 'First tool call', detail: firstTool },
  ];

  if (!unpriced && !isCodex) {
    keyframes.push(
      { kind: 'first-error', at: at(0.34), seq: 41, label: 'First error', detail: 'Bash' },
      {
        kind: 'verification-failed',
        at: at(0.46),
        seq: 58,
        label: 'Verification failed',
        detail: 'test',
      },
      {
        kind: 'peak-burn',
        at: at(0.62),
        seq: 77,
        label: 'Peak burn',
        detail: `${((session.burnRateUsdPerMin ?? 0) * 1.8).toFixed(2)}/min`,
      },
    );
  } else if (!unpriced && isCodex) {
    // Codex can price but has no verification signal — peak burn only.
    keyframes.push({
      kind: 'peak-burn',
      at: at(0.62),
      seq: 77,
      label: 'Peak burn',
      detail: `${((session.burnRateUsdPerMin ?? 0) * 1.8).toFixed(2)}/min`,
    });
  }

  keyframes.push({
    kind: 'biggest-commit',
    at: at(0.81),
    seq: 102,
    label: 'Shipped 2 commits',
    detail: '11 files',
  });

  if (ended) {
    keyframes.push({
      kind: 'session-end',
      at: endIso,
      seq: 140,
      label: 'Session ended',
      detail: 'cleared',
    });
  }

  const bucketMs = Math.max(5_000, Math.ceil(elapsedMs / 24));
  const bucketCount = Math.max(1, Math.ceil(elapsedMs / bucketMs));
  const activity: ReplayActivityBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const t = i / bucketCount;
    const wave = 0.35 + 0.65 * Math.sin(t * Math.PI);
    const spike = t > 0.55 && t < 0.68 ? 1.8 : 1;
    activity.push({
      at: new Date(startMs + i * bucketMs).toISOString(),
      bucketMs,
      // Unpriced sessions have no spend basis — keep buckets at 0 cost/tokens
      // (schema requires numbers; UI treats null session cost as unpriced).
      costUsd: unpriced
        ? 0
        : Math.round(((session.costUsd ?? 0) * (wave * spike)) / bucketCount * 100) / 100,
      toolCallCount: t > 0.1 && t < 0.9 ? (i % 3 === 0 ? 2 : 1) : 0,
      tokensTotal: unpriced
        ? 0
        : Math.round((session.tokens.total / bucketCount) * wave * spike),
    });
  }

  const moments: ReplayMoment[] = [];
  let seq = 1;
  for (let i = 0; i < 28; i++) {
    const frac = 0.05 + (i / 28) * 0.9;
    const tool = tools[i % tools.length]!;
    // Claude-only error/verification moments — Codex verification stays none.
    const errored = !unpriced && !isCodex && i === 10;
    const cost = unpriced
      ? 0
      : errored
        ? (session.costUsd ?? 0) * 0.08
        : (session.costUsd ?? 0) * 0.012;
    moments.push({
      at: at(frac),
      seq: seq++,
      kind: 'tool.call',
      toolName: tool,
      costUsd: Math.round(cost * 100) / 100,
      errored: errored || undefined,
      verificationKind: !unpriced && !isCodex && i === 14 ? 'test' : undefined,
      verificationPassed: !unpriced && !isCodex && i === 14 ? false : undefined,
      fileCategory: tool === 'Edit' || tool === 'ApplyPatch' ? 'source' : undefined,
      fileLanguage: tool === 'Edit' || tool === 'ApplyPatch' ? 'typescript' : undefined,
    });
  }
  moments.push({ at: at(0.22), seq: seq++, kind: 'session.prompt' });
  moments.push({ at: at(0.35), seq: seq++, kind: 'session.prompt' });
  // Permission prompts are Claude-shaped; Codex passive has none.
  if (!isCodex) {
    moments.push({
      at: at(0.51),
      seq: seq++,
      kind: 'session.notification',
      notificationType: 'permission_prompt',
    });
  }

  return {
    sessionId: session.sessionId,
    agent: session.agent,
    startedAt: session.startedAt,
    endedAt: ended ? endIso : null,
    keyframes,
    activity,
    moments,
    totals: {
      costUsd: session.costUsd ?? 0,
      tokensTotal: session.tokens.total,
      toolCallCount: session.toolCallCount,
      promptCount: moments.filter((moment) => moment.kind === 'session.prompt').length,
      filesTouchedUncommitted: 11,
    },
  };
}
