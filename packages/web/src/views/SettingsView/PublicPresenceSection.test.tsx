// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { OwnerPublicationManifest } from '@seorak/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PublicPresenceApi,
  PublicPresenceDocument,
  PublicPublicationState,
  PublicPublicationStatus,
} from '../../lib/publicationApi.js';
import PublicPresenceSection from './PublicPresenceSection.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function status(
  state: PublicPublicationState = 'saved',
  overrides: Partial<PublicPublicationStatus> = {},
): PublicPublicationStatus {
  const operation = state === 'saved' ? null : state === 'revoked' ? 'revoke' : 'apply';
  return {
    apiVersion: 'v1',
    savedRevision: 3,
    generatedVersion: state === 'saved' ? 0 : 2,
    appliedVersion: state === 'applied' || state === 'revoked' ? 2 : 1,
    blockingGeneration: ['queued', 'delivering', 'retrying', 'failed'].includes(state)
      ? 2
      : null,
    state,
    operation,
    attemptCount: state === 'failed' || state === 'retrying' ? 2 : 0,
    nextAttemptAt: state === 'retrying' ? '2026-08-02T12:05:00.000Z' : null,
    lastErrorCode: state === 'failed' ? 'directory-unavailable' : null,
    appliedAt: state === 'applied' || state === 'revoked'
      ? '2026-08-02T12:00:00.000Z'
      : null,
    ...overrides,
  };
}

function manifest(): OwnerPublicationManifest {
  return {
    apiVersion: 'v1',
    commandId: 'cmd_0123456789abcdef0123456789abcdef',
    expectedRevision: 2,
    profileSlug: 'ada-lovelace',
    profile: { displayName: 'Ada Lovelace' },
    grants: {
      web: { enabled: true, fields: ['displayName'] },
      search: { enabled: false, fields: [] },
      api: { enabled: false, fields: [] },
      mcp: { enabled: false, fields: [] },
    },
    activity: null,
    tokenUsage: null,
    projects: [],
  };
}

const SOURCE_PROJECT_ID = 'a'.repeat(64);

function document(
  publicationStatus = status(),
  savedManifest: OwnerPublicationManifest | null = manifest(),
): PublicPresenceDocument {
  return {
    manifest: savedManifest,
    status: publicationStatus,
    availableProjects: [
      { sourceProjectId: SOURCE_PROJECT_ID, label: 'Analytical Engine' },
    ],
  };
}

function apiFor(initial: PublicPresenceDocument): PublicPresenceApi {
  return {
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn(async (saved) => document(status('saved', {
      savedRevision: initial.status.savedRevision + 1,
      generatedVersion: initial.status.generatedVersion,
      appliedVersion: initial.status.appliedVersion,
    }), saved)),
    publish: vi.fn().mockResolvedValue(document(status('queued'))),
    revoke: vi.fn().mockResolvedValue(document(status('revoked'))),
    retry: vi.fn().mockResolvedValue(document(status('retrying'))),
  };
}

async function render(api: PublicPresenceApi) {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(<PublicPresenceSection api={api} pollIntervalMs={60_000} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    unmount: () => act(() => root.unmount()),
  };
}

function named<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  host: HTMLElement,
  name: string,
): T {
  const element = host.querySelector<T>(`[name="${name}"]`);
  if (!element) throw new Error(`Missing field ${name}`);
  return element;
}

async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label)
  );
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
}

afterEach(() => {
  window.document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('PublicPresenceSection', () => {
  it('keeps authored profile, surfaces, contact, activity, and private project choices separate', async () => {
    const api = apiFor(document(status('saved', {
      savedRevision: 0,
      generatedVersion: 0,
      appliedVersion: 0,
    }), null));
    const view = await render(api);

    expect(view.host.textContent).toContain('Authored profile');
    expect(view.host.textContent).toContain('Public surfaces');
    expect(view.host.textContent).toContain('Contact');
    expect(view.host.textContent).toContain('Activity calendar');
    expect(view.host.textContent).toContain('Token usage');
    expect(view.host.textContent).toContain('Projects and evidence');
    expect(view.host.textContent).toContain('Private by default');
    expect(view.host.innerHTML).not.toContain(SOURCE_PROJECT_ID);
    expect(view.host.querySelector('[name*="credential"], [name*="secret"]'))
      .toBeNull();

    await change(named(view.host, 'profileSlug'), 'grace-hopper');
    await change(named(view.host, 'displayName'), 'Grace Hopper');
    await change(named(view.host, 'contactUrl'), 'https://example.test/contact');
    await click(named(view.host, 'surface-web'));
    await click(named(view.host, 'contact-web'));
    await click(named(view.host, 'activity-enabled'));
    await click(named(view.host, 'project-analytical-engine'));
    await click(button(view.host, 'Save privately'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.save).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(api.save).mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      apiVersion: 'v1',
      expectedRevision: 0,
      profileSlug: 'grace-hopper',
      profile: {
        displayName: 'Grace Hopper',
        contactUrl: 'https://example.test/contact',
      },
    });
    expect(saved?.grants.web).toEqual({
      enabled: true,
      fields: ['displayName', 'contactUrl'],
    });
    expect(saved?.grants.search).toEqual({ enabled: false, fields: [] });
    expect(saved?.activity?.grants.search).toEqual({ enabled: false, fields: [] });
    expect(saved?.activity?.grants.web).toEqual({
      enabled: true,
      fields: ['calendar', 'streak'],
    });
    expect(saved?.tokenUsage).toBeNull();
    expect(saved?.projects).toHaveLength(1);
    expect(saved?.projects[0]).toMatchObject({
      sourceProjectId: SOURCE_PROJECT_ID,
      projectSlug: 'analytical-engine',
      project: { name: 'Analytical Engine' },
      evidence: {
        fields: ['sessionCount'],
        rangeDays: 30,
        unavailable: 'publish-unavailable',
      },
      tokenUsage: null,
    });
    expect(saved?.projects[0]?.grants.web).toMatchObject({ enabled: true });
    expect(JSON.stringify(saved)).not.toMatch(
      /"(?:value|sampleSize|coverage|freshness|sessionIds|generatedVersion|appliedVersion)"/,
    );

    view.unmount();
  });

  it('includes profile tokenUsage in the saved manifest and copies an usage.svg snippet after apply', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const initial = document(status('applied', {
      savedRevision: 3,
      generatedVersion: 2,
      appliedVersion: 2,
    }));
    const api = apiFor(initial);
    const view = await render(api);

    await click(named(view.host, 'token-usage-enabled'));
    await change(named(view.host, 'token-usage-range'), '90');
    await click(button(view.host, 'Save privately'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const saved = vi.mocked(api.save).mock.calls[0]?.[0];
    expect(saved?.tokenUsage).toMatchObject({
      rangeDays: 90,
      unavailable: 'publish-unavailable',
      grants: {
        web: { enabled: true, fields: ['series', 'totals'] },
        search: { enabled: false, fields: [] },
      },
    });
    expect(view.host.textContent).toContain('usage.svg');
    expect(view.host.querySelector('img[alt="Seorak token usage"]')).not.toBeNull();

    await click(button(view.host, 'Copy README snippet'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalled();
    expect(String(writeText.mock.calls[0]?.[0])).toContain('usage.svg');
    expect(String(writeText.mock.calls[0]?.[0])).toMatch(/^!\[Seorak token usage\]\(/);

    await click(button(view.host, 'Copy HTML'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(String(writeText.mock.calls[1]?.[0])).toContain('<img src=');
    expect(String(writeText.mock.calls[1]?.[0])).toContain('alt="Seorak token usage"');

    view.unmount();
  });

  it('saves a dirty private draft before publishing its exact saved revision', async () => {
    const initial = document(status('saved', { savedRevision: 3 }));
    const api = apiFor(initial);
    vi.mocked(api.save).mockImplementation(async (saved) => document(
      status('saved', { savedRevision: 4 }),
      saved,
    ));
    vi.mocked(api.publish).mockResolvedValue(document(
      status('queued', { savedRevision: 4, generatedVersion: 3 }),
      { ...manifest(), expectedRevision: 3 },
    ));
    const view = await render(api);

    await change(named(view.host, 'headline'), 'Compiler pioneer');
    await click(button(view.host, 'Publish frozen version'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.save).mock.calls[0]?.[0].expectedRevision).toBe(3);
    expect(api.publish).toHaveBeenCalledWith(4);
    expect(view.host.querySelector('[data-publication-state="queued"]')).not.toBeNull();
    expect(view.host.textContent).toContain('Queued for publication');
    expect(view.host.textContent).toContain(
      'Saved revision 4, generated version 3, applied version 1',
    );

    view.unmount();
  });

  it.each([
    ['saved', 'Saved privately. Nothing changed publicly yet.'],
    ['queued', 'Queued for publication. Your saved version is not public yet.'],
    ['delivering', 'Delivering this frozen version to the public directory.'],
    ['retrying', 'Publication is retrying. The last applied public version remains unchanged.'],
    ['applied', 'Publicly applied as version 2.'],
    ['failed', 'Publication failed. Your last applied public version remains unchanged.'],
    ['revoked', 'Revoked. No current public presence is available.'],
  ] as const)('visibly distinguishes the %s lifecycle state', async (stateName, message) => {
    const view = await render(apiFor(document(status(stateName))));

    expect(view.host.querySelector(`[data-publication-state="${stateName}"]`)).not.toBeNull();
    expect(view.host.textContent).toContain(message);
    expect(view.host.textContent).toMatch(
      /Saved revision \d+, generated version \d+, applied version \d+/,
    );

    view.unmount();
  });

  it('states that a blocked revocation may still be publicly visible', async () => {
    const view = await render(apiFor(document(status('failed', {
      generatedVersion: 5,
      blockingGeneration: 5,
      operation: 'revoke',
    }))));

    expect(view.host.textContent).toContain(
      'Revocation failed. Your public presence may still be visible; retry the blocking delivery.',
    );
    expect(view.host.textContent).toContain('Blocking delivery version 5');

    view.unmount();
  });

  it('retries the true blocker and revokes without accepting a publisher credential', async () => {
    const api = apiFor(document(status('failed', {
      generatedVersion: 7,
      blockingGeneration: 4,
    })));
    vi.mocked(api.retry).mockResolvedValue(document(status('retrying', {
      generatedVersion: 7,
      blockingGeneration: 4,
    })));
    vi.mocked(api.revoke).mockResolvedValue(document(status('revoked', {
      generatedVersion: 8,
      appliedVersion: 8,
    })));
    const view = await render(api);

    await click(button(view.host, 'Retry publication'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.retry).toHaveBeenCalledWith(4);
    expect(view.host.querySelector('[data-publication-state="retrying"]')).not.toBeNull();
    expect(view.host.textContent).toContain('Blocking delivery version 4');

    await click(button(view.host, 'Revoke public presence'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.revoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.revoke).mock.calls[0]?.[0]).toMatchObject({
      expectedGeneration: 7,
    });
    expect(vi.mocked(api.revoke).mock.calls[0]?.[0].commandId).toMatch(/^cmd_[0-9a-f]{32}$/);
    expect(view.host.querySelector('[data-publication-state="revoked"]')).not.toBeNull();

    view.unmount();
  });
});
