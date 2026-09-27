import { describe, expect, it } from 'vitest';

import { classifyReplayError, replayRefusalMessage } from '../replayError.js';

// DA-14: a 404 from /replay/:id is honest-empty "no keyframes yet" (the KV-backed
// picker runs ahead of the D1 log), not a load failure. Real errors still show,
// and an aborted in-flight fetch is ignored.
describe('classifyReplayError (DA-14)', () => {
  it('a 404 is honest-empty no-keyframes, not an error', () => {
    const err = Object.assign(new Error('GET /replay/x failed: 404'), { status: 404 });
    expect(classifyReplayError(err)).toBe('no-keyframes');
  });

  it('a 5xx is a real error', () => {
    const err = Object.assign(new Error('GET /replay/x failed: 500'), { status: 500 });
    expect(classifyReplayError(err)).toBe('error');
  });

  it('an unparseable payload (no status) is a real error', () => {
    const err = new Error('Invalid API response (replay)');
    err.name = 'SchemaValidationError';
    expect(classifyReplayError(err)).toBe('error');
  });

  it('a 413 is a refusal, not a load failure', () => {
    // The plane declined to materialise an oversized replay rather than
    // returning a partial one. Printing "failed: 413" would read as a bug in
    // the product rather than a bound it is honouring.
    const err = Object.assign(new Error('GET /replay/x failed: 413'), {
      status: 413,
      refusal: {
        error: 'replay too large',
        detail: 'This session has too many events for one honest replay. No partial timeline was returned.',
        projectedRows: 10001,
        maxRows: 10000,
      },
    });
    expect(classifyReplayError(err)).toBe('too-large');
    expect(replayRefusalMessage(err)).toMatch(/No partial timeline was returned/);
  });

  it('a 413 with no readable body still says what happened', () => {
    const err = Object.assign(new Error('GET /replay/x failed: 413'), { status: 413 });
    expect(classifyReplayError(err)).toBe('too-large');
    expect(replayRefusalMessage(err)).toMatch(/too many events/);
  });

  it('an aborted fetch is ignored', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classifyReplayError(err)).toBe('ignore');
  });
});
