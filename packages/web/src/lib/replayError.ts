// DA-14: how a GET /replay/:id failure maps to the replay surface's state.
//
// The picker sources sessions from KV (GET /sessions), which can run ahead of
// the D1 replay log: a brand-new session, or one that predates the log, has no
// rows there yet, so the read returns 404. That is honest-empty "no keyframes
// for this session yet", NOT a load failure, so the harsh error panel would
// overstate the problem. Real failures (5xx, network, an unparseable payload)
// still surface as an error. An AbortError is the caller cancelling an in-flight
// fetch and is ignored.

export type ReplayErrorOutcome = 'no-keyframes' | 'error' | 'ignore';

export function classifyReplayError(err: unknown): ReplayErrorOutcome {
  const e = err as { name?: string; status?: number };
  if (e?.name === 'AbortError') return 'ignore';
  if (e?.status === 404) return 'no-keyframes';
  return 'error';
}
