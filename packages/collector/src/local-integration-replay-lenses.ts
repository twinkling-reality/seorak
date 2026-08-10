import type {
  ExternalSessionRef,
  PrivateReplayLensName,
  PrivateReplayLensResult,
  ReplaySession,
} from "@seorak/types";

function metric(
  key: string,
  label: string,
  value: number | boolean | null,
  unit: "count" | "percent" | "usd" | "seconds" | "milliseconds" | "tokens" | "none",
) {
  return { key, label, value, unit } as const;
}

/** Content-free reducers matching the hosted private integration surface. */
export function buildLocalIntegrationReplayLens(
  replay: ReplaySession,
  sessionRef: ExternalSessionRef,
  lens: PrivateReplayLensName,
): PrivateReplayLensResult {
  const target = { kind: "session" as const, sessionRef };
  if (lens === "tool-mix") {
    const counts = new Map<
      string,
      { calls: number; errors: number; errorComplete: boolean; cost: number; costComplete: boolean }
    >();
    for (const moment of replay.moments) {
      if (moment.kind !== "tool.call") continue;
      const label = moment.toolName?.trim() || "Unknown tool";
      const current = counts.get(label) ?? {
        calls: 0,
        errors: 0,
        errorComplete: true,
        cost: 0,
        costComplete: true,
      };
      current.calls += 1;
      current.errors += moment.errored === true ? 1 : 0;
      current.errorComplete &&= typeof moment.errored === "boolean";
      current.cost += moment.costUsd ?? 0;
      current.costComplete &&= moment.costMeasured === true;
      counts.set(label, current);
    }
    const rows = [...counts.entries()]
      .sort((left, right) => right[1].calls - left[1].calls || left[0].localeCompare(right[0]))
      .map(([label, value]) => ({
        label,
        metrics: [
          metric("calls", "Tool calls", value.calls, "count"),
          metric("errors", "Errored calls", value.errorComplete ? value.errors : null, "count"),
          metric("costUsd", "Measured cost", value.costComplete ? value.cost : null, "usd"),
        ],
        share: replay.totals.toolCallCount > 0 ? value.calls / replay.totals.toolCallCount : 0,
      }));
    return {
      lens,
      level: "session",
      target,
      headline: rows.length > 0 ? `${replay.totals.toolCallCount} measured tool calls` : null,
      rows,
      emptyReason: rows.length === 0 ? "No tool-call evidence was captured." : null,
      loadedSessionCount: 1,
      momentCount: replay.moments.length,
      nextCursor: null,
    };
  }

  if (lens === "verification") {
    const byKind = new Map<string, { measured: number; passed: number }>();
    for (const moment of replay.moments) {
      if (moment.kind !== "tool.call" || moment.verificationPassed === undefined) continue;
      const label = moment.verificationKind?.trim() || "Verification";
      const current = byKind.get(label) ?? { measured: 0, passed: 0 };
      current.measured += 1;
      current.passed += moment.verificationPassed ? 1 : 0;
      byKind.set(label, current);
    }
    const rows = [...byKind.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, value]) => ({
        label,
        metrics: [
          metric("runs", "Measured runs", value.measured, "count"),
          metric("passed", "Passed runs", value.passed, "count"),
          metric(
            "passRate",
            "Pass rate",
            value.measured > 0 ? value.passed / value.measured : null,
            "percent",
          ),
        ],
      }));
    return {
      lens,
      level: "session",
      target,
      headline: rows.length > 0 ? "Captured verification evidence" : null,
      rows,
      emptyReason: rows.length === 0 ? "No verification result was captured." : null,
      loadedSessionCount: 1,
      momentCount: replay.moments.length,
      nextCursor: null,
    };
  }

  if (lens === "cadence") {
    const ordered = replay.moments
      .map((moment) => Date.parse(moment.at))
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    const gaps = ordered.slice(1).map((at, index) => Math.max(0, at - ordered[index]!));
    const average = gaps.length > 0
      ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length
      : null;
    const longest = gaps.length > 0 ? Math.max(...gaps) : null;
    const rows = ordered.length > 0
      ? [{
          label: "Observed cadence",
          metrics: [
            metric("moments", "Observed moments", ordered.length, "count"),
            metric("averageGap", "Average gap", average, "milliseconds"),
            metric("longestGap", "Longest gap", longest, "milliseconds"),
          ],
        }]
      : [];
    return {
      lens,
      level: "session",
      target,
      headline: rows.length > 0 ? `${ordered.length} content-free moments` : null,
      rows,
      emptyReason: rows.length === 0 ? "No cadence moments were captured." : null,
      loadedSessionCount: 1,
      momentCount: replay.moments.length,
      nextCursor: null,
    };
  }

  return {
    lens,
    level: "session",
    target,
    headline: "Session evidence summary",
    rows: [{
      label: "Measured totals",
      metrics: [
        metric("toolCalls", "Tool calls", replay.totals.toolCallCount, "count"),
        metric(
          "prompts",
          "Prompt envelopes",
          replay.totals.measured?.promptCount === true ? replay.totals.promptCount : null,
          "count",
        ),
        metric(
          "tokens",
          "Measured tokens",
          replay.totals.measured?.tokensTotal === true ? replay.totals.tokensTotal : null,
          "tokens",
        ),
        metric(
          "costUsd",
          "Measured cost",
          replay.totals.measured?.costUsd === true ? replay.totals.costUsd : null,
          "usd",
        ),
      ],
    }],
    emptyReason: null,
    loadedSessionCount: 1,
    momentCount: replay.moments.length,
    nextCursor: null,
  };
}
