// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = `srkx_${'a'.repeat(32)}_${'b'.repeat(64)}`;
const issue = vi.fn();
const list = vi.fn();
const projects = vi.fn();
const revoke = vi.fn();

let PrivateIntegrationsSection: typeof import('./PrivateIntegrationsSection.js').default;

beforeAll(async () => {
  vi.doMock('../../lib/integrationApi.js', async (original) => {
    const actual = await original<typeof import('../../lib/integrationApi.js')>();
    return {
      ...actual,
      integrationApi: { issue, list, projects, revoke },
    };
  });
  vi.doMock('../../lib/demoMode.js', () => ({ isDemoActive: () => false }));
  PrivateIntegrationsSection = (await import('./PrivateIntegrationsSection.js')).default;
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function render(operator: 'local-machine' | 'self-hosted' | 'seorak-managed') {
  list.mockResolvedValue({ apiVersion: 'v1', credentials: [] });
  projects.mockResolvedValue({ apiVersion: 'v1', projects: [] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PrivateIntegrationsSection operator={operator} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe('PrivateIntegrationsSection credential targets', () => {
  it('offers local static MCP with safe Codex and Claude environment setup', async () => {
    const { container, root } = await render('local-machine');
    const target = container.querySelector('select')!;
    expect([...target.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Private HTTP API',
      'Private MCP static bearer',
    ]);
    await act(async () => {
      target.value = 'mcp';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    issue.mockResolvedValue({
      apiVersion: 'v1',
      credentialRef: `icr_${'a'.repeat(32)}`,
      secret: TOKEN,
      audience: 'http://127.0.0.1:3000/mcp/private',
      scopes: ['period:read'],
      issuedAt: '2026-08-09T00:00:00.000Z',
      expiresAt: '2026-09-08T00:00:00.000Z',
      rateLimit: { requestsPerMinute: 60, burst: 60 },
    });
    const button = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === 'Create credential')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(issue).toHaveBeenCalledWith(expect.objectContaining({
      audience: 'http://127.0.0.1:3000/mcp/private',
    }));
    expect(container.textContent).toContain('static bearer credential, not OAuth');
    expect(container.textContent).toContain('--bearer-token-env-var SEORAK_MCP_TOKEN');
    expect(container.textContent).toContain('Bearer ${SEORAK_MCP_TOKEN}');
    const setup = [...container.querySelectorAll('pre, code')]
      .map((node) => node.textContent ?? '')
      .filter((text) => text.includes('codex mcp add') || text.includes('mcpServers'))
      .join('\n');
    expect(setup).not.toContain(TOKEN);

    await act(async () => root.unmount());
  });

  it('never offers a static MCP credential on a Seorak-managed plane', async () => {
    const { container, root } = await render('seorak-managed');
    expect(container.textContent).not.toContain('Private MCP static bearer');
    expect(container.textContent).not.toContain('Credential target');
    await act(async () => root.unmount());
  });
});
