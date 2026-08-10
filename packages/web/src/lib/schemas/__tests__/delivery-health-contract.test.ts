import { describe, expect, it } from 'vitest';

import { pushDeliveryHealthSchema } from '../common.js';

const unobserved = {
  registeredDevices: 0,
  state: 'unobserved',
  completedAttempts: null,
  lastCompletedAt: null,
  lastAcceptedAt: null,
  terminalFailures: null,
  lastTerminalAt: null,
} as const;

function healthWith(production: unknown) {
  return {
    observedAt: '2026-07-29T12:00:00.000Z',
    windowDays: 30,
    environments: {
      development: unobserved,
      production,
    },
  };
}

describe('push delivery health schema', () => {
  it('keeps unobserved history distinct from an observed zero', () => {
    const parsed = pushDeliveryHealthSchema.parse(
      healthWith({
        registeredDevices: 1,
        state: 'observed',
        completedAttempts: 4,
        lastCompletedAt: '2026-07-29T11:00:00.000Z',
        lastAcceptedAt: '2026-07-29T11:00:00.000Z',
        terminalFailures: 0,
        lastTerminalAt: null,
      }),
    );

    expect(parsed.environments.development).toEqual(unobserved);
    expect(parsed.environments.production).toMatchObject({
      state: 'observed',
      completedAttempts: 4,
      terminalFailures: 0,
      lastTerminalAt: null,
    });
  });

  it('accepts terminal history only when count and timestamp agree', () => {
    const observed = {
      registeredDevices: 1,
      state: 'observed',
      completedAttempts: 4,
      lastCompletedAt: '2026-07-29T11:00:00.000Z',
      lastAcceptedAt: null,
      terminalFailures: 2,
      lastTerminalAt: '2026-07-29T10:30:00.000Z',
    };
    expect(pushDeliveryHealthSchema.safeParse(healthWith(observed)).success).toBe(
      true,
    );
    expect(
      pushDeliveryHealthSchema.safeParse(
        healthWith({ ...observed, lastTerminalAt: null }),
      ).success,
    ).toBe(false);
    expect(
      pushDeliveryHealthSchema.safeParse(
        healthWith({ ...observed, terminalFailures: 0 }),
      ).success,
    ).toBe(false);
  });

  it('rejects fabricated measurements in an unobserved environment', () => {
    expect(
      pushDeliveryHealthSchema.safeParse(
        healthWith({
          ...unobserved,
          completedAttempts: 0,
          terminalFailures: 0,
        }),
      ).success,
    ).toBe(false);
  });
});
