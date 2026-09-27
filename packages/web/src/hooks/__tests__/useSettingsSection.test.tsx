// @vitest-environment jsdom

/**
 * The abortable-load and optimistic-rollback semantics of the shared settings
 * state machine. These are the parts a wrong refactor breaks silently: a
 * superseded load that still lands leaves the reader looking at settings they
 * navigated away from, and a rollback that does not announce itself leaves the
 * parent mirroring a value the worker rejected.
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSettingsSection, type SettingsSectionConfig } from '../useSettingsSection.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let demoActive = false;
vi.mock('../../lib/demoMode.js', () => ({
  isDemoActive: () => demoActive,
}));

interface Flags {
  a: boolean;
  b: boolean;
}

const BOTH_OFF: Flags = { a: false, b: false };

type Harness = {
  root: Root;
  container: HTMLDivElement;
  api: { state: unknown; applyChange: (c: never) => Promise<void> };
  unmount: () => void;
};

function mountSection(config: SettingsSectionConfig<Flags>): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const harness = { root, container } as Harness;

  function Probe() {
    const section = useSettingsSection<Flags>(config);
    harness.api = section as never;
    return (
      <div
        data-testid="probe"
        data-kind={section.state.kind}
        data-note={section.state.kind === 'ready' ? String(section.state.note) : ''}
        data-readonly={section.state.kind === 'ready' ? String(section.state.readOnly) : ''}
        data-flags={
          section.state.kind === 'ready' ? JSON.stringify(section.state.data) : ''
        }
      />
    );
  }

  act(() => {
    root.render(<Probe />);
  });
  harness.unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  return harness;
}

async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function probe(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="probe"]');
  if (!el) throw new Error('probe not rendered');
  return el as HTMLElement;
}

function flags(container: HTMLElement): Flags {
  return JSON.parse(probe(container).dataset.flags || '{}') as Flags;
}

function baseConfig(over: Partial<SettingsSectionConfig<Flags>>): SettingsSectionConfig<Flags> {
  return {
    load: () => Promise.resolve(BOTH_OFF),
    demoData: BOTH_OFF,
    unavailableReason: 'Worker unreachable — flags need a running worker.',
    readOnlyNote: 'Read-only token.',
    logLabel: 'flags',
    ...over,
  };
}

afterEach(() => {
  demoActive = false;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useSettingsSection — abortable load', () => {
  it('drops a load that resolves after the section unmounted', async () => {
    let land: (v: Flags) => void = () => {};
    const pending = new Promise<Flags>((r) => {
      land = r;
    });
    const onChange = vi.fn();
    const h = mountSection(baseConfig({ load: () => pending, onChange }));

    h.unmount();
    await act(async () => {
      land({ a: true, b: true });
      await Promise.resolve();
    });
    await flush();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops a load that rejects after the section unmounted', async () => {
    let fail: (e: Error) => void = () => {};
    const pending = new Promise<Flags>((_r, rej) => {
      fail = rej;
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = mountSection(baseConfig({ load: () => pending }));

    h.unmount();
    await act(async () => {
      fail(new Error('aborted'));
      await Promise.resolve();
    });
    await flush();

    // A cancelled load is not a worker outage; it must not be reported as one.
    expect(spy).not.toHaveBeenCalled();
  });

  it('loads once even when the caller passes a fresh onChange every render', async () => {
    const load = vi.fn().mockResolvedValue(BOTH_OFF);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe({ tag }: { tag: number }) {
      // A new closure identity on every render, the shape a parent that does not
      // memoise its handler produces.
      useSettingsSection<Flags>(baseConfig({ load, onChange: () => void tag }));
      return <div />;
    }

    act(() => {
      root.render(<Probe tag={1} />);
    });
    await flush();
    act(() => {
      root.render(<Probe tag={2} />);
    });
    act(() => {
      root.render(<Probe tag={3} />);
    });
    await flush();

    expect(load).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  it('reports an unreachable worker as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = mountSection(
      baseConfig({ load: () => Promise.reject(new Error('offline')) }),
    );
    await flush();

    expect(probe(h.container).dataset.kind).toBe('unavailable');
    h.unmount();
  });
});

describe('useSettingsSection — optimistic rollback', () => {
  it('announces the reverted value so the parent cannot keep the optimistic one', async () => {
    const onChange = vi.fn();
    const err = Object.assign(new Error('boom'), { status: 500 });
    const h = mountSection(baseConfig({ onChange }));
    await flush();
    onChange.mockClear();

    await act(async () => {
      await h.api.applyChange({
        optimistic: { a: true, b: false },
        write: () => Promise.reject(err),
        rollback: (latest: Flags) => ({ ...latest, a: false }),
        savedNote: 'Saved.',
      } as never);
    });
    await flush();

    expect(flags(h.container)).toEqual({ a: false, b: false });
    // The optimistic value was announced, then the revert was announced too.
    expect(onChange.mock.calls.map(([f]) => (f as Flags).a)).toEqual([true, false]);
    expect(probe(h.container).dataset.note).toBe(
      'Save failed, worker unreachable. Try again.',
    );
    expect(probe(h.container).dataset.readonly).toBe('false');

    h.unmount();
  });

  it('reverts only the failed field and keeps a change made while it was in flight', async () => {
    let failA: (e: Error) => void = () => {};
    const aWrite = new Promise<Flags>((_r, rej) => {
      failA = rej;
    });
    const h = mountSection(baseConfig({}));
    await flush();

    // A is in flight and will fail.
    let aDone: Promise<void>;
    await act(async () => {
      aDone = h.api.applyChange({
        optimistic: { a: true, b: false },
        write: () => aWrite,
        rollback: (latest: Flags) => ({ ...latest, a: false }),
        savedNote: 'Saved.',
      } as never);
    });

    // B is made before A settles, and succeeds.
    await act(async () => {
      await h.api.applyChange({
        optimistic: { a: true, b: true },
        write: () => Promise.resolve({ a: true, b: true }),
        rollback: (latest: Flags) => ({ ...latest, b: false }),
        savedNote: 'Saved.',
      } as never);
    });
    await flush();
    expect(flags(h.container)).toEqual({ a: true, b: true });

    await act(async () => {
      failA(Object.assign(new Error('boom'), { status: 500 }));
      await aDone!.catch(() => {});
    });
    await flush();

    // A rolled back against the LATEST data, so B survives.
    expect(flags(h.container)).toEqual({ a: false, b: true });

    h.unmount();
  });

  it('flips read-only on a 401 and refuses further writes', async () => {
    const err = Object.assign(new Error('401'), { status: 401 });
    const write = vi.fn().mockRejectedValue(err);
    const h = mountSection(baseConfig({}));
    await flush();

    await act(async () => {
      await h.api.applyChange({
        optimistic: { a: true, b: false },
        write,
        rollback: (latest: Flags) => ({ ...latest, a: false }),
        savedNote: 'Saved.',
      } as never);
    });
    await flush();

    expect(probe(h.container).dataset.readonly).toBe('true');
    expect(probe(h.container).dataset.note).toBe('Read-only token.');
    expect(flags(h.container)).toEqual({ a: false, b: false });

    await act(async () => {
      await h.api.applyChange({
        optimistic: { a: true, b: false },
        write,
        rollback: (latest: Flags) => ({ ...latest, a: false }),
        savedNote: 'Saved.',
      } as never);
    });
    await flush();

    expect(write).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('shows the pending note while the write is in flight, then the saved note', async () => {
    let confirm: (v: Flags) => void = () => {};
    const inFlight = new Promise<Flags>((r) => {
      confirm = r;
    });
    const h = mountSection(baseConfig({}));
    await flush();

    let done: Promise<void>;
    await act(async () => {
      done = h.api.applyChange({
        optimistic: { a: true, b: false },
        write: () => inFlight,
        rollback: (latest: Flags) => latest,
        savedNote: 'Applied.',
        pendingNote: 'Applying…',
      } as never);
    });
    expect(probe(h.container).dataset.note).toBe('Applying…');

    await act(async () => {
      confirm({ a: true, b: false });
      await done!;
    });
    await flush();
    expect(probe(h.container).dataset.note).toBe('Applied.');

    h.unmount();
  });
});

describe('useSettingsSection — demo mode', () => {
  it('never touches the worker and honours the demo note', async () => {
    demoActive = true;
    const load = vi.fn();
    const write = vi.fn();
    const h = mountSection(baseConfig({ load }));
    await flush();

    expect(load).not.toHaveBeenCalled();

    await act(async () => {
      await h.api.applyChange({
        optimistic: { a: true, b: false },
        write,
        rollback: (latest: Flags) => latest,
        savedNote: 'Merged.',
        demoNote: 'Merged.',
      } as never);
    });
    await flush();

    expect(write).not.toHaveBeenCalled();
    expect(flags(h.container)).toEqual({ a: true, b: false });
    expect(probe(h.container).dataset.note).toBe('Merged.');

    h.unmount();
  });

  it('leaves the note empty in demo when the family declares no demo note', async () => {
    demoActive = true;
    const h = mountSection(baseConfig({}));
    await flush();

    await act(async () => {
      await h.api.applyChange({
        optimistic: { a: true, b: false },
        write: vi.fn(),
        rollback: (latest: Flags) => latest,
        // No demoNote: "your collector picks this up" would be a lie in demo.
        savedNote: 'Saved — your collector picks this up within a few minutes.',
      } as never);
    });
    await flush();

    expect(probe(h.container).dataset.note).toBe('null');
    h.unmount();
  });
});
