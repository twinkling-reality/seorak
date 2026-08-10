// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReactNode } from 'react';
import { distributionQuestion, rateQuestion } from '../questions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<div>{node}</div>));
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const CAVEAT = 'Call share can differ from spend share.';

describe('caveat — the on-demand answer note', () => {
  it('does not render the caveat as a paragraph under the viz', () => {
    const q = distributionQuestion({
      id: 'model-calls',
      question: 'Which model does the volume?',
      answer: <>Claude Opus 4.8 leads your model calls at 58%.</>,
      caveat: CAVEAT,
      items: [{ key: 'a', label: 'Opus 4.8', fillPct: 58, fillColor: 'var(--ink)', value: '3 calls' }],
    });
    expect(mount(q.children).textContent).not.toContain('Call share');
  });

  it('carries the caveat as the trigger accessible name, so it is never hover-only', () => {
    const q = distributionQuestion({
      id: 'model-calls',
      question: 'Which model does the volume?',
      answer: <>Claude Opus 4.8 leads your model calls at 58%.</>,
      caveat: CAVEAT,
      items: [{ key: 'a', label: 'Opus 4.8', fillPct: 58, fillColor: 'var(--ink)', value: '3 calls' }],
    });
    const trigger = mount(q.answer).querySelector('button');
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute('aria-label')).toBe(CAVEAT);
  });

  it('leaves the answer sentence itself untouched', () => {
    const q = rateQuestion({
      id: 'context-reuse',
      question: 'How much context was reused?',
      answer: <>62% of your input context came from cache over the last 30 days.</>,
      caveat: 'Lower reuse can mean higher token cost.',
      rate: 0.62,
    });
    // The trigger renders an 'i' glyph, so assert the sentence is a prefix
    // rather than the whole string.
    expect(mount(q.answer).textContent).toContain(
      '62% of your input context came from cache over the last 30 days.',
    );
  });

  it('renders no trigger when a question has no caveat', () => {
    const q = rateQuestion({
      id: 'plain',
      question: 'Plain?',
      answer: <>No caveat here.</>,
      rate: 0.5,
    });
    expect(mount(q.answer).querySelector('button')).toBeNull();
  });

  it('still renders a visible VizNote for a note, which guards a misread', () => {
    const q = rateQuestion({
      id: 'noted',
      question: 'Noted?',
      answer: <>Some rate.</>,
      note: 'Over the calls that returned a result.',
      rate: 0.5,
    });
    expect(mount(q.children).textContent).toContain('Over the calls that returned a result.');
    expect(mount(q.answer).querySelector('button')).toBeNull();
  });
});
