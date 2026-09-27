// DA-14: how a GET /replay/:id failure maps to the replay surface's state.
//
// The picker sources sessions from KV (GET /sessions), which can run ahead of
// the D1 replay log: a brand-new session, or one that predates the log, has no
// rows there yet, so the read returns 404. That is honest-empty "no keyframes
// for this session yet", NOT a load failure, so the harsh error panel would
// overstate the problem. Real failures (5xx, network, an unparseable payload)
// still surface as an error. An AbortError is the caller cancelling an in-flight
// fetch and is ignored.

// A 413 is neither of those. It is the plane REFUSING to answer, because this
// session holds more event rows than one complete replay may materialise, and
// the one thing it will not do is return a partial timeline wearing a complete
// one's shape. Both planes answer it: the worker for a session over
// REPLAY_EVENT_ROW_BUDGET, and the collector's routable binding for one over
// SESSION_REPLAY_MAX_ROWS. Classified apart from 'error' so the view can say
// what actually happened rather than printing "failed: 413", which reads as a
// bug in the product rather than a bound it is honouring.
export type ReplayErrorOutcome = 'no-keyframes' | 'too-large' | 'error' | 'ignore';

export function classifyReplayError(err: unknown): ReplayErrorOutcome {
  const e = err as { name?: string; status?: number };
  if (e?.name === 'AbortError') return 'ignore';
  if (e?.status === 404) return 'no-keyframes';
  if (e?.status === 413) return 'too-large';
  return 'error';
}

/** The refusal's own words, when the plane sent them. Falls back to wording that
 *  says the same thing rather than to a status code. */
export function replayRefusalMessage(err: unknown): string {
  const detail = (err as { refusal?: { detail?: unknown } })?.refusal?.detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  return 'This session has too many events for one honest replay. No partial timeline was returned.';
}
