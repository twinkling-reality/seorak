/**
 * What Seorak has a RECORD of, as distinct from what happened. Its own module because
 * nothing else here answers a question about the observer rather than the work, and
 * because it is the one input the chart cannot be honest without (see buildAgentsHistory).
 */
import type { AgentRollup } from '../../../lib/apiSchemas.js';

/**
 * Where each agent's record BEGINS, as an index into the chart's day spine. Null when the
 * depth is unknown (no retained first event), because assuming "since forever"
 * would manufacture the exact reassurance this exists to withhold.
 *
 * THE BUG THIS KILLS. In the When charts a day BEFORE a tool was ever watched and a day the
 * tool simply did nothing render identically: both are an absent bar. So a 30-day view shows
 * Claude's bars across the whole window and Codex's two at the right edge, and the reader
 * concludes "I barely use Codex" from a picture that actually means "Seorak barely watched
 * Codex". Zero-filling an unobserved day is the same fabrication as zero-filling an unpriced
 * model, just drawn instead of written.
 *
 * WHAT IT REFUSES TO CLAIM. A record that starts inside the window might mean we only
 * started WATCHING then, or that you only started USING the tool then, and the event log
 * cannot tell those apart. So the rail says only what is true either way (Seorak has a
 * record from here on) and never "capture started here".
 *
 * Day STRINGS, not millisecond arithmetic: the spine is UTC `YYYY-MM-DD` and `firstSeenAt`
 * is a UTC instant, so slicing the date off it and comparing lexically is exact. Subtracting
 * epochs and flooring invites an off-by-one at every DST boundary for no gain.
 */
export function agentRecordStarts(
  agents: string[],
  byAgent: AgentRollup[],
  days: string[],
): (number | null)[] {
  return agents.map((id) => {
    const first = byAgent.find((a) => a.agent === id)?.firstSeenAt;
    if (!first) return null;
    const startDay = first.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) return null;
    // Record predates the window: it covers every day shown.
    if (days.length === 0 || startDay <= days[0]) return 0;
    const i = days.indexOf(startDay);
    // Later than every day on the spine cannot happen (firstSeenAt is in the past), but a
    // clock skew must not silently become index 0 and claim a full record.
    if (i === -1) return startDay > days[days.length - 1] ? days.length - 1 : null;
    return i;
  });
}

/**
 * Whether the rail has anything to say. It is drawn ONLY when some agent's record
 * demonstrably starts inside the window, and only when EVERY agent's depth is known: a rail
 * that omitted an unknown-depth agent would read as "this tool has no record at all", which
 * is worse than drawing nothing. An element that cannot be false is decoration, so when both
 * records span the window the rail does not render, and it disappears on its own once Codex
 * has 30 days behind it.
 */
export function recordRailWorthShowing(recordStart: (number | null)[]): boolean {
  if (recordStart.length <= 1) return false;
  if (recordStart.some((i) => i === null)) return false;
  return recordStart.some((i) => (i as number) > 0);
}
