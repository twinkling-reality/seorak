import { describe, expect, it } from 'vitest';
import { hostedGateFor } from './hostedGate.js';

describe('hosted entitlement gate recognition', () => {
  it('names the capability a 402 reported', () => {
    const gate = hostedGateFor({ status: 402, capability: 'remoteVisibility' });
    expect(gate?.capability).toBe('remoteVisibility');
    expect(gate?.title).toMatch(/Pro capability/);
    // The sentence must not imply anything local was lost: Free is complete.
    expect(gate?.hint).toMatch(/still captured and complete/);
  });

  it('falls back to a true sentence for a capability it does not recognise', () => {
    const gate = hostedGateFor({ status: 402, capability: 'somethingNewer' });
    expect(gate).toMatchObject({
      capability: 'somethingNewer',
      title: 'This is a Pro capability',
    });
  });

  it('is not a gate when the cell did not name one', () => {
    // Reported as the failure it looks like rather than as a confident sentence
    // about a capability we guessed.
    expect(hostedGateFor({ status: 402 })).toBeNull();
    expect(hostedGateFor({ status: 402, capability: '' })).toBeNull();
    expect(hostedGateFor({ status: 402, capability: 7 })).toBeNull();
  });

  it('is not a gate for any other failure', () => {
    for (const error of [
      { status: 401 },
      { status: 403, capability: 'remoteVisibility' },
      { status: 500 },
      new Error('Failed to fetch'),
      null,
      'boom',
    ]) {
      expect(hostedGateFor(error)).toBeNull();
    }
  });
});
