import { describe, expect, it } from 'vitest';

import type { AgentRollup } from '../../../../lib/apiSchemas.js';
import { buildAgentsHistory } from '../history.js';
import { agentRecordStarts, recordRailWorthShowing } from '../record.js';
import { agent } from './fixtures.js';

/**
 * The record rail. Every number and every bar on this page is windowed identically for both
 * tools, which is only fair if both were WATCHED for the same span. These prove the chart
 * can tell "Seorak was not watching" apart from "the tool did nothing", which it could not
 * before: a zero-filled spine draws those two facts as the same absent bar.
 */
describe('what Seorak has a record of', () => {
  // A 5-day spine, so an index is easy to read against a date.
  const DAYS = ['2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13'];
  const ORDER = ['claude-code', 'codex'];

  const pair = (claudeFirst?: string, codexFirst?: string): AgentRollup[] => [
    agent('claude-code', { sessions: 40, toolCalls: 900, firstSeenAt: claudeFirst }),
    agent('codex', { sessions: 3, toolCalls: 60, firstSeenAt: codexFirst }),
  ];

  it('starts each rail on the day that tool entered the record', () => {
    const starts = agentRecordStarts(
      ORDER,
      pair('2026-06-05T11:48:00.048Z', '2026-07-12T02:44:46.662Z'),
      DAYS,
    );
    // Claude's record predates the window, so it covers every day shown.
    expect(starts[0]).toBe(0);
    // Codex's starts on the 12th, which is index 3 of the spine.
    expect(starts[1]).toBe(3);
    expect(recordRailWorthShowing(starts)).toBe(true);
  });

  it('reads the record off the UTC DAY, not off a millisecond subtraction', () => {
    // A record opened at 23:59 UTC belongs to THAT day, not the next one. Flooring
    // (now - firstSeen) / 86400000 puts it a day late whenever the clocks disagree, which
    // silently shortens the record by a day and understates what Seorak actually holds.
    const starts = agentRecordStarts(ORDER, pair('2026-07-09T23:59:59.999Z', '2026-07-11T00:00:00.000Z'), DAYS);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(2);
  });

  it('does not draw the rail when every record covers the window', () => {
    // An element that cannot be false is decoration. Two full-width bars say nothing, so
    // the rail vanishes, and it vanishes ON ITS OWN once Codex has 30 days behind it.
    const starts = agentRecordStarts(ORDER, pair('2026-06-05T00:00:00.000Z', '2026-06-05T00:00:00.000Z'), DAYS);
    expect(starts).toEqual([0, 0]);
    expect(recordRailWorthShowing(starts)).toBe(false);
  });

  it('does not draw the rail when any depth is unknown', () => {
    // A pre-firstSeenAt worker sends no such field. Drawing the rail anyway would leave the
    // unknown tool with NO segment, which reads as "this tool has no record at all" and is
    // a far worse lie than drawing nothing. So one unknown leg silences the whole rail.
    const starts = agentRecordStarts(ORDER, pair(undefined, '2026-07-12T00:00:00.000Z'), DAYS);
    expect(starts).toEqual([null, 3]);
    expect(recordRailWorthShowing(starts)).toBe(false);
    expect(recordRailWorthShowing(agentRecordStarts(ORDER, pair('nonsense', '2026-07-12T00:00:00.000Z'), DAYS))).toBe(
      false,
    );
  });

  it('never lets a bad date silently claim a full record', () => {
    // index 0 means "the record covers everything shown", which is the single most
    // reassuring thing the rail can say. An unparseable date must never fall into it.
    expect(agentRecordStarts(ORDER, pair('', ''), DAYS)).toEqual([null, null]);
    expect(agentRecordStarts(ORDER, pair('2026-07-XX', '2026-07-12T00:00:00.000Z'), DAYS)[0]).toBeNull();
  });

  it('rides buildAgentsHistory so the chart cannot be handed a spine it cannot read', () => {
    const series = buildAgentsHistory(
      [],
      [],
      ORDER,
      5,
      Date.parse('2026-07-13T12:00:00.000Z'),
      0,
      pair('2026-06-05T00:00:00.000Z', '2026-07-12T00:00:00.000Z'),
    );
    expect(series.days).toEqual(DAYS);
    expect(series.recordStart).toEqual([0, 3]);
    // The zero-filled spine is still there (it is what the bars read), and THAT is exactly
    // why recordStart has to ride alongside it: on its own it says Codex did nothing on the
    // 9th, when the truth is that nobody was looking.
    expect(series.sessions[0]).toEqual([0, 0]);
  });

  it('leaves the rail unknown when nobody passes byAgent at all', () => {
    const series = buildAgentsHistory([], [], ORDER, 5, Date.parse('2026-07-13T12:00:00.000Z'), 0);
    expect(series.recordStart).toEqual([null, null]);
    expect(recordRailWorthShowing(series.recordStart)).toBe(false);
  });
});
