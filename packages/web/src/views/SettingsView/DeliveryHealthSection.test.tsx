// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const unobserved = {
  observedAt: '2026-07-30T12:00:00.000Z',
  windowDays: 30,
  environments: {
    development: {
      registeredDevices: 1,
      state: 'unobserved',
      completedAttempts: null,
      lastCompletedAt: null,
      lastAcceptedAt: null,
      terminalFailures: null,
      lastTerminalAt: null,
    },
    production: {
      registeredDevices: 0,
      state: 'unobserved',
      completedAttempts: null,
      lastCompletedAt: null,
      lastAcceptedAt: null,
      terminalFailures: null,
      lastTerminalAt: null,
    },
  },
};

async function renderWith(body: unknown) {
  vi.resetModules();
  vi.doMock('../../lib/api.js', () => ({
    fetchPushDeliveryHealth: vi.fn().mockResolvedValue(body),
  }));
  vi.doMock('../../lib/demoMode.js', () => ({ isDemoActive: () => false }));
  const Component = (await import('./DeliveryHealthSection.js')).default;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Component />));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DeliveryHealthSection', () => {
  it('renders unobserved history without inventing a zero-failure claim', async () => {
    const { container, root } = await renderWith(unobserved);
    expect(container.textContent).toContain(
      'No completed push attempt was observed in the last 30 days.',
    );
    expect(container.textContent).not.toContain('No terminal failures');
    await act(async () => root.unmount());
  });

  it('treats a malformed response as unavailable, not empty', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, root } = await renderWith({ environments: {} });
    expect(container.textContent).toContain(
      'Delivery history is unavailable. No delivery-health claim can be made.',
    );
    await act(async () => root.unmount());
  });
});
