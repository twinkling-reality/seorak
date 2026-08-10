import { describe, expect, it } from 'vitest';
import { liveCostLabel, liveNeedsYou } from '../utils.js';

// DA-02: the live Cost column must not print a fabricated "$0.00" for a session
// with no cost basis (a token-less host tool, or no priced call yet). "$0.00" is
// only honest when there is token throughput priced near zero.
describe('liveCostLabel (DA-02 honest-empty cost)', () => {
  it('renders "--" when cost is null (host tool cannot price its work)', () => {
    // COST-NULLABILITY.md: null = unknown (a `cost:'none'` tool). It must read
    // "--" even with token throughput, so the null check precedes the token proxy.
    expect(liveCostLabel(null, 0)).toBe('--');
    expect(liveCostLabel(null, 5000)).toBe('--');
  });

  it('renders "--" for a no-cost-basis session (zero cost AND zero tokens)', () => {
    expect(liveCostLabel(0, 0)).toBe('--');
  });

  it('renders "$0.00" only when token throughput exists priced near zero', () => {
    expect(liveCostLabel(0, 1500)).toBe('$0.00');
  });

  it('renders the real cost when measured', () => {
    expect(liveCostLabel(1.23, 5000)).toBe('$1.23');
  });

  it('shows a measured sub-token cost even if tokensTotal reads 0', () => {
    expect(liveCostLabel(0.5, 0)).toBe('$0.50');
  });

  it('a token-less tool fixture (no tokens, no cost) is honest-empty, never $0.00', () => {
    expect(liveCostLabel(0, 0)).not.toBe('$0.00');
  });
});

// DA-07: "needs you" is the wedge's most actionable live glance and must surface
// only while genuinely blocked and not yet ended; absent means not waiting.
describe('liveNeedsYou (DA-07 needs-you glance)', () => {
  it('is true for a blocked, non-ended session', () => {
    expect(liveNeedsYou({ awaitingInput: true, status: 'idle' })).toBe(true);
    expect(liveNeedsYou({ awaitingInput: true, status: 'active' })).toBe(true);
  });

  it('is false once the session has ended (the prompt is moot)', () => {
    expect(liveNeedsYou({ awaitingInput: true, status: 'ended' })).toBe(false);
  });

  it('is false when not waiting (absent or false)', () => {
    expect(liveNeedsYou({ status: 'active' })).toBe(false);
    expect(liveNeedsYou({ awaitingInput: false, status: 'active' })).toBe(false);
  });
});
