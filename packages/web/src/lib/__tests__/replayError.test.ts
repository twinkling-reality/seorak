import { describe, expect, it } from 'vitest';

import { classifyReplayError } from '../replayError.js';

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

  it('an aborted fetch is ignored', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classifyReplayError(err)).toBe('ignore');
  });
});
