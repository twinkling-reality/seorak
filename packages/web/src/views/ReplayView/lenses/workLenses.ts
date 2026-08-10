// What the work was made of: tools, cost, files.

import { formatCost } from '../../../widgets/utils.js';
import type {
  ReplayLensInput,
  ReplayLensResult,
  ReplayLensRow,
} from './types.js';
import {
  coverageFor,
  countLabel,
  emptyResult,
  humanize,
  placedMoments,
  withShares,
} from './shared.js';

function sharePct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

/** Which tools ran, how often, and how many of those calls errored. */
export function computeToolMix(input: ReplayLensInput): ReplayLensResult {
  const moments = placedMoments(input, true).filter(
    (placed) => placed.moment.kind === 'tool.call' && placed.moment.toolName,
  );
  const coverage = coverageFor(input, moments.length, true);
  if (moments.length === 0) {
    return emptyResult(
      'tool-mix',
      'ranked-bars',
      'No tool calls were captured here. Tool-call logging fills this in.',
      coverage,
    );
  }

  const byTool = new Map<string, { calls: number; errors: number; costUsd: number; hotMs: number }>();
  for (const { moment, elapsedMs } of moments) {
    const name = moment.toolName!;
    const entry = byTool.get(name) ?? { calls: 0, errors: 0, costUsd: 0, hotMs: elapsedMs };
    entry.calls += 1;
    if (moment.errored) entry.errors += 1;
    entry.costUsd += moment.costUsd ?? 0;
    byTool.set(name, entry);
  }

  const totalCalls = moments.length;
  const totalErrors = moments.filter((placed) => placed.moment.errored).length;

  const rows: ReplayLensRow[] = [...byTool.entries()]
    .map(([name, entry]) => {
      const facts = [];
      if (entry.errors > 0) {
        facts.push({
          label: 'errored',
          value: `${entry.errors.toLocaleString()} of ${entry.calls.toLocaleString()}`,
          tone: 'negative' as const,
        });
      }
      if (entry.costUsd > 0) facts.push({ label: 'cost', value: formatCost(entry.costUsd) });
      return {
        id: `tool-${name}`,
        label: name,
        value: entry.calls,
        display: countLabel(entry.calls, 'call'),
        tone: entry.errors > 0 ? ('warning' as const) : undefined,
        facts,
      };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const top = rows[0]!;
  const headline =
    totalErrors > 0
      ? `${top.label} ran most at ${top.value.toLocaleString()}; ${totalErrors.toLocaleString()} of ${totalCalls.toLocaleString()} calls errored.`
      : `${top.label} ran most at ${top.value.toLocaleString()} of ${countLabel(totalCalls, 'tool call')} across ${countLabel(rows.length, 'tool')}.`;

  return { id: 'tool-mix', viz: 'ranked-bars', headline, rows: withShares(rows), empty: null, coverage };
}

/**
 * Where measured cost went, by tool. Each row scrubs to that tool's most
 * expensive moment, so a bar is also a way into the timeline.
 */
export function computeCostConcentration(input: ReplayLensInput): ReplayLensResult {
  const moments = placedMoments(input, true).filter(
    (placed) => (placed.moment.costUsd ?? 0) > 0,
  );
  const coverage = coverageFor(input, moments.length, true);
  if (moments.length === 0) {
    return emptyResult(
      'cost-concentration',
      'ranked-bars',
      'No per-moment cost was captured here, so cost cannot be attributed.',
      coverage,
    );
  }

  const byTool = new Map<string, { costUsd: number; peakUsd: number; peakMs: number; calls: number }>();
  for (const { moment, elapsedMs } of moments) {
    const name = moment.toolName ?? 'Other';
    const cost = moment.costUsd ?? 0;
    const entry = byTool.get(name) ?? { costUsd: 0, peakUsd: 0, peakMs: elapsedMs, calls: 0 };
    entry.costUsd += cost;
    entry.calls += 1;
    if (cost > entry.peakUsd) {
      entry.peakUsd = cost;
      entry.peakMs = elapsedMs;
    }
    byTool.set(name, entry);
  }

  const total = moments.reduce((sum, placed) => sum + (placed.moment.costUsd ?? 0), 0);

  const rows: ReplayLensRow[] = [...byTool.entries()]
    .map(([name, entry]) => ({
      id: `cost-${name}`,
      label: name,
      value: entry.costUsd,
      display: formatCost(entry.costUsd),
      elapsedMs: entry.peakMs,
      facts: [
        { label: 'calls', value: entry.calls.toLocaleString() },
        { label: 'priciest call', value: formatCost(entry.peakUsd) },
      ],
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const top = rows[0]!;
  const headline = `${top.label} took ${top.display} of ${formatCost(total)} — ${sharePct(top.value, total)}% of measured cost.`;

  return {
    id: 'cost-concentration',
    viz: 'ranked-bars',
    headline,
    rows: withShares(rows),
    empty: null,
    coverage,
  };
}

/**
 * What kind of files the work touched. Category is the primary grouping;
 * language families ride along as facts. When capture derived a language but no
 * category, the lens groups by language instead and says so — rather than
 * inventing an "uncategorized" bucket.
 */
export function computeFileTouch(input: ReplayLensInput): ReplayLensResult {
  const moments = placedMoments(input, true);
  const withCategory = moments.filter((placed) => placed.moment.fileCategory);
  const withLanguage = moments.filter((placed) => placed.moment.fileLanguage);
  const coverage = coverageFor(input, Math.max(withCategory.length, withLanguage.length), true);

  if (withCategory.length === 0 && withLanguage.length === 0) {
    return emptyResult(
      'file-touch',
      'ranked-bars',
      'No file category or language was derived for the calls captured here.',
      coverage,
    );
  }

  const groupByCategory = withCategory.length > 0;
  const source = groupByCategory ? withCategory : withLanguage;
  const keyOf = (placed: (typeof source)[number]) =>
    groupByCategory ? placed.moment.fileCategory! : placed.moment.fileLanguage!;

  const groups = new Map<string, { touches: number; languages: Map<string, number> }>();
  for (const placed of source) {
    const key = keyOf(placed);
    const entry = groups.get(key) ?? { touches: 0, languages: new Map<string, number>() };
    entry.touches += 1;
    const language = placed.moment.fileLanguage;
    if (groupByCategory && language) {
      entry.languages.set(language, (entry.languages.get(language) ?? 0) + 1);
    }
    groups.set(key, entry);
  }

  const rows: ReplayLensRow[] = [...groups.entries()]
    .map(([key, entry]) => ({
      id: `file-${key}`,
      label: humanize(key),
      value: entry.touches,
      display: countLabel(entry.touches, 'touch', 'touches'),
      facts: [...entry.languages.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([language, count]) => ({ label: language, value: count.toLocaleString() })),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const total = source.length;
  const top = rows[0]!;
  const headline = groupByCategory
    ? `${top.label} files took ${sharePct(top.value, total)}% of ${countLabel(total, 'file touch', 'file touches')} across ${countLabel(rows.length, 'category', 'categories')}.`
    : `Capture derived a language but no category here: ${top.label} led ${countLabel(total, 'file touch', 'file touches')}.`;

  return { id: 'file-touch', viz: 'ranked-bars', headline, rows: withShares(rows), empty: null, coverage };
}
