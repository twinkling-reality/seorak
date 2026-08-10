// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReactNode } from 'react';
import type { ModelRollup } from '@seorak/types';

import { modelSpendQuestion } from '../modelSpend.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Render a node and return its text — what the reader actually sees. */
function text(node: ReactNode): string {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<div>{node}</div>));
  const out = container.textContent ?? '';
  act(() => root.unmount());
  container.remove();
  return out;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const model = (over: Partial<ModelRollup> & { model: string }): ModelRollup => ({
  calls: 1,
  tokensTotal: 1000,
  costUsd: 1,
  ...over,
});

describe('modelSpendQuestion', () => {
  it('names the leader in prose with the vendor, and the bars without it', () => {
    const q = modelSpendQuestion(
      [
        model({ model: 'claude-opus-4-8', costUsd: 6, tokensTotal: 9000 }),
        model({ model: 'claude-sonnet-4-6', costUsd: 4, tokensTotal: 5000 }),
      ],
      'models',
    );
    expect(q).not.toBeNull();

    // Ranking voice: entity subject, "your" attached to the work (DETAIL-VOICE:38).
    expect(text(q!.answer)).toBe('Claude Opus 4.8 leads your spend at 60%.');

    const bars = text(q!.children);
    expect(bars).toContain('Opus 4.8');
    expect(bars).toContain('Sonnet 4.6');
    expect(bars).not.toContain('Claude Opus');
    expect(bars).not.toContain('claude-opus-4-8');
  });

  it('keeps the possessive on the unpriced token-share branch', () => {
    const q = modelSpendQuestion(
      [
        model({ model: 'claude-opus-4-8', costUsd: null, tokensTotal: 7500 }),
        model({ model: 'gpt-5-codex', costUsd: null, tokensTotal: 2500 }),
      ],
      'models',
    );
    const answer = text(q!.answer);
    expect(answer).toContain('leads your token use at 75%');
    expect(answer).toContain('some models are unpriced');
  });

  it('passes an unrecognized model id straight through to prose', () => {
    const q = modelSpendQuestion([model({ model: 'gpt-5-codex', costUsd: 3 })], 'models');
    expect(text(q!.answer)).toContain('gpt-5-codex leads your spend');
  });

  it('is honest-empty when there is nothing to rank', () => {
    expect(modelSpendQuestion([], 'models')).toBeNull();
    expect(
      modelSpendQuestion([model({ model: 'claude-opus-4-8', costUsd: 0 })], 'models'),
    ).toBeNull();
  });
});
