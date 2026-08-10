import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadRefreshModule() {
  vi.resetModules();
  return import('./refresh.js');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('refresh store', () => {
  it('calls a registered handler on requestRefresh', async () => {
    const { addRefreshHandler, requestRefresh } = await loadRefreshModule();
    const handler = vi.fn();

    addRefreshHandler(handler);
    requestRefresh();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('calls multiple handlers in registration order', async () => {
    const { addRefreshHandler, requestRefresh } = await loadRefreshModule();
    const order = [];
    const handlerA = vi.fn(() => order.push('a'));
    const handlerB = vi.fn(() => order.push('b'));

    addRefreshHandler(handlerA);
    addRefreshHandler(handlerB);
    requestRefresh();

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['a', 'b']);
  });

  it('unregisters a handler via the returned disposer', async () => {
    const { addRefreshHandler, requestRefresh } = await loadRefreshModule();
    const handler = vi.fn();

    const unsubscribe = addRefreshHandler(handler);
    unsubscribe();
    requestRefresh();

    expect(handler).not.toHaveBeenCalled();
  });

  it('only unregisters the specific handler, leaving others intact', async () => {
    const { addRefreshHandler, requestRefresh } = await loadRefreshModule();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    const unsubA = addRefreshHandler(handlerA);
    addRefreshHandler(handlerB);
    unsubA();
    requestRefresh();

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('suppresses refresh calls while WebSocket is connected', async () => {
    const { addRefreshHandler, requestRefresh, setWsConnected } = await loadRefreshModule();
    const handler = vi.fn();

    addRefreshHandler(handler);
    setWsConnected(true);
    requestRefresh();

    expect(handler).not.toHaveBeenCalled();
  });

  it('resumes refresh calls after WebSocket disconnects', async () => {
    const { addRefreshHandler, requestRefresh, setWsConnected } = await loadRefreshModule();
    const handler = vi.fn();

    addRefreshHandler(handler);
    setWsConnected(true);
    requestRefresh();
    expect(handler).not.toHaveBeenCalled();

    setWsConnected(false);
    requestRefresh();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does nothing when requestRefresh is called with no handlers', async () => {
    const { requestRefresh } = await loadRefreshModule();

    // Should not throw
    expect(() => requestRefresh()).not.toThrow();
  });

  it('deduplicates the same handler reference added via addRefreshHandler', async () => {
    const { addRefreshHandler, requestRefresh } = await loadRefreshModule();
    const handler = vi.fn();

    addRefreshHandler(handler);
    addRefreshHandler(handler);
    requestRefresh();

    // Set-based storage means duplicates are ignored
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
