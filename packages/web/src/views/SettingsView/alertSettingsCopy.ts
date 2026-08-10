import type { InterventionThresholds, SignalId } from '@seorak/types';

/** Settings-facing watch prompts — questions the user answers with the row toggle.
 *  Catalog `why` stays past-tense for history and push copy; this is control-plane voice. */
export const WATCH_PROMPTS: Record<SignalId, string> = {
  cost_spike: 'Notify when a session\'s spend crosses your cap?',
  high_burn_rate: 'Notify when a session is spending unusually fast?',
  long_session: 'Notify when a session has been running too long?',
  stuck_loop: 'Notify when the agent keeps retrying the same failing step?',
  went_cold: 'Notify when a live session goes quiet?',
  session_ended: 'Notify with a short summary when a session ends?',
  daily_cost_cap: 'Notify when today\'s total spend crosses your cap?',
  first_error: 'Notify on the first tool failure in a session?',
};

export const QUIET_HOURS_PROMPT = 'Hold non-urgent pushes during a daily quiet window?';

export function projectMutePrompt(projectLabel: string): string {
  return `Mute pushes from ${projectLabel}?`;
}

/** Plain-English lead-in before each threshold input (the cap the row fires on). */
export function thresholdBoundLead(
  signalId: SignalId,
  key: keyof InterventionThresholds,
): string {
  if (signalId === 'cost_spike' && key === 'costSpikeUsd') return 'Cap at';
  if (signalId === 'high_burn_rate' && key === 'highBurnRateUsdPerMinute') return 'Above';
  if (signalId === 'long_session' && key === 'longSessionMinutes') return 'After';
  if (signalId === 'went_cold' && key === 'wentColdMinutes') return 'After';
  if (signalId === 'daily_cost_cap' && key === 'dailyCostCapUsd') return 'Daily cap at';
  if (signalId === 'stuck_loop' && key === 'stuckLoopErroredToolCalls') return 'After';
  if (signalId === 'stuck_loop' && key === 'stuckLoopRepeatedToolCalls') return 'After';
  return 'At';
}

export function thresholdBoundTail(
  signalId: SignalId,
  key: keyof InterventionThresholds,
  unit: string,
): string {
  if (signalId === 'long_session' && key === 'longSessionMinutes') return 'min';
  if (signalId === 'went_cold' && key === 'wentColdMinutes') return 'min of silence';
  if (signalId === 'stuck_loop' && key === 'stuckLoopErroredToolCalls') {
    return unit === 'calls' ? 'failed retries' : unit;
  }
  if (signalId === 'stuck_loop' && key === 'stuckLoopRepeatedToolCalls') {
    return 'repeats without an error';
  }
  return unit;
}
