// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { momentumWidgets } from '../MomentumWidgets.js';
import { createEmptyOverview } from '../../../lib/apiSchemas.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Component {...props} />));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function overviewWith(portfolio) {
  const base = createEmptyOverview(7);
  return { ...base, usage: { ...base.usage, portfolio } };
}

function repo(overrides) {
  return {
    repoId: 'r1',
    repoLabel: 'seorak',
    gitContext: 'clean',
    temperature: 'steady',
    quietDays: null,
    commits: 12,
    filesTouched: 34,
    netLines: 540,
    generatedLinesExcluded: 0,
    baseline: { commits: 5, filesTouched: 18 },
    ...overrides,
  };
}

const Momentum = momentumWidgets.momentum;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MomentumWidget', () => {
  it('renders the honest empty state when there is no portfolio history', () => {
    const { container, unmount } = render(Momentum, {
      overview: createEmptyOverview(7),
      liveSessions: [],
      openProject: () => {},
    });
    expect(container.textContent).toContain('Repo activity fills in');
    unmount();
  });

  it('renders breadth + explicit numbers — never temperature words, never "+X lines"', () => {
    const portfolio = {
      windowDays: 7,
      reposTotal: 2,
      reposMoved: 1,
      reposQuiet: 1,
      repos: [
        repo({
          repoId: 'r1',
          repoLabel: 'seorak',
          temperature: 'heating',
          filesTouched: 34,
          netLines: 540,
          linesAdded: 720,
          generatedLinesExcluded: 14632,
          baseline: { commits: 5, filesTouched: 18 },
        }),
        repo({
          repoId: 'r2',
          repoLabel: 'notes',
          temperature: 'quiet',
          quietDays: 9,
          commits: 0,
          filesTouched: 0,
          netLines: 0,
          baseline: null,
        }),
      ],
    };
    const { container, unmount } = render(Momentum, {
      overview: overviewWith(portfolio),
      liveSessions: [],
      openProject: () => {},
    });
    const text = container.textContent;
    // One head: breadth + its own git window (this widget's window is NOT the
    // dashboard range pill). No "went quiet" second lead line.
    expect(text).toContain('1 of 2');
    expect(text).toContain('repos with commits in the past 7 days');
    expect(text).not.toContain('went quiet');
    // The 7-day window is ROLLING (7x24h), so the vs header names the day
    // count; "prior week" would misread as a calendar week.
    expect(text).toContain('Vs prior 7d');
    expect(text).not.toContain('prior week');
    // Per-repo board leads with files-touched + signed NET, never raw lines-added.
    expect(text).toContain('seorak');
    expect(text).toContain('+540');
    expect(text).not.toContain('720'); // raw linesAdded must NOT surface as a score
    // ADR-1: the temperature enum is NOT rendered; the judgment is explicit
    // numbers (files delta vs the repo's own prior reading).
    expect(text).not.toContain('heating');
    expect(text).toContain('+16 files');
    // Quiet surfacing: days-dark in its own column ("quiet for" + "9d"),
    // never "neglected", never a glued "quiet 9d" state cell.
    expect(text).toContain('Quiet for');
    expect(text).toContain('9d');
    expect(text).not.toContain('neglected');
    // No baseline → honest "--" in the vs column, never a fabricated delta.
    expect(text).toContain('--');
    unmount();
  });

  it('derives head copy and the vs header from a non-default window', () => {
    const portfolio = {
      windowDays: 14,
      reposTotal: 1,
      reposMoved: 1,
      reposQuiet: 0,
      repos: [repo({})],
    };
    const { container, unmount } = render(Momentum, {
      overview: overviewWith(portfolio),
      liveSessions: [],
      openProject: () => {},
    });
    expect(container.textContent).toContain('repo with commits in the past 14 days');
    expect(container.textContent).toContain('Vs prior 14d');
    unmount();
  });

  it('caps rows and folds the tail into a real overflow count', () => {
    const repos = Array.from({ length: 8 }, (_, i) =>
      repo({ repoId: `r${i}`, repoLabel: `repo-${i}`, filesTouched: 30 - i }),
    );
    const portfolio = {
      windowDays: 7,
      reposTotal: 8,
      reposMoved: 8,
      reposQuiet: 0,
      repos,
    };
    const { container, unmount } = render(Momentum, {
      overview: overviewWith(portfolio),
      liveSessions: [],
      openProject: () => {},
    });
    const text = container.textContent;
    expect(text).toContain('repo-4'); // 5th row still on the face
    expect(text).not.toContain('repo-5'); // 6th folds
    expect(text).toContain('+3 more repos');
    unmount();
  });

  it('drills a row into that repo project view', () => {
    const openProject = vi.fn();
    const portfolio = {
      windowDays: 7,
      reposTotal: 1,
      reposMoved: 1,
      reposQuiet: 0,
      repos: [repo({ repoLabel: 'seorak' })],
    };
    const { container, unmount } = render(Momentum, {
      overview: overviewWith(portfolio),
      liveSessions: [],
      openProject,
    });
    const row = container.querySelector('button[aria-label="Open seorak project view"]');
    expect(row).not.toBeNull();
    act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // Drills on the salted repoId (the stable key), not the basename label (SCOPE.md
    // Phase 0 re-key): the aria-label still shows the human basename.
    expect(openProject).toHaveBeenCalledWith('r1');
    unmount();
  });
});
