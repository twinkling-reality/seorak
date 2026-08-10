// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReactNode } from 'react';
import {
  averageClause,
  count,
  countMetric,
  fmtPct,
  naturalList,
  naturalListNodes,
  plural,
  priorWindowPhrase,
  windowPhrase,
} from '../index.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Render a bare node and return its text — the voice output the reader sees. */
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

describe('plural', () => {
  it('agrees with the count', () => {
    expect(plural(1, 'session')).toBe('session');
    expect(plural(0, 'session')).toBe('sessions');
    expect(plural(2, 'session')).toBe('sessions');
  });
  it('takes an irregular plural', () => {
    expect(plural(1, 'is', 'are')).toBe('is');
    expect(plural(3, 'is', 'are')).toBe('are');
    expect(plural(2, 'kind', 'kinds')).toBe('kinds');
  });
});

describe('count', () => {
  it('never emits "1 sessions"', () => {
    expect(count(1, 'session')).toBe('1 session');
    expect(count(3, 'session')).toBe('3 sessions');
    expect(count(0, 'session')).toBe('0 sessions');
  });
  it('groups thousands', () => {
    expect(count(1234, 'edit')).toBe('1,234 edits');
  });
});

describe('naturalList', () => {
  it('speaks a list', () => {
    expect(naturalList([])).toBe('');
    expect(naturalList(['a'])).toBe('a');
    expect(naturalList(['a', 'b'])).toBe('a and b');
    expect(naturalList(['a', 'b', 'c'])).toBe('a, b, and c');
  });
});

describe('windowPhrase', () => {
  it('spells the dynamic window, never "this window"', () => {
    expect(windowPhrase(7)).toBe('the last 7 days');
    expect(windowPhrase(30)).toBe('the last 30 days');
    expect(windowPhrase(90)).toBe('the last 90 days');
  });
  it('spells the prior comparison window', () => {
    expect(priorWindowPhrase(30)).toBe('the 30 days before');
  });
});

describe('fmtPct', () => {
  it('formats a rate', () => {
    expect(fmtPct(0.84)).toBe('84%');
    expect(fmtPct(0.8421, 1)).toBe('84.2%');
  });
});

describe('countMetric', () => {
  it('renders a marked count with an agreeing noun', () => {
    expect(text(countMetric(1, 'session'))).toBe('1 session');
    expect(text(countMetric(3, 'session'))).toBe('3 sessions');
    expect(text(countMetric(1234, 'edit'))).toBe('1,234 edits');
  });
});

describe('naturalListNodes', () => {
  it('joins nodes as a spoken list', () => {
    expect(text(naturalListNodes(['a']))).toBe('a');
    expect(text(naturalListNodes(['a', 'b']))).toBe('a and b');
    expect(text(naturalListNodes(['a', 'b', 'c']))).toBe('a, b, and c');
  });
});

describe('averageClause (n=1 guard)', () => {
  it('is suppressed at a sample of one', () => {
    expect(averageClause({ n: 1, per: '$0.84' })).toBeNull();
    expect(averageClause({ n: 0, per: '$0.84' })).toBeNull();
  });
  it('reads "about X per session" for a real sample', () => {
    expect(text(averageClause({ n: 158, per: '$1.86' }))).toBe('about $1.86 per session');
    expect(text(averageClause({ n: 12, per: '3', unit: 'run' }))).toBe('about 3 per run');
  });
});
