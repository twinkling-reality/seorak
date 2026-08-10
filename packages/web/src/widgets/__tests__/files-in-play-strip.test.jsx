// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { liveWidgets } from '../bodies/LiveWidgets.js';
import { createEmptyOverview } from '../../lib/apiSchemas.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FilesInPlay = liveWidgets['files-in-play'];

function render(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<FilesInPlay {...props} />));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

function file(i, edits, { label = `file-${i}.ts`, project = 'seorak', category = null } = {}) {
  return {
    fileId: String(i).repeat(64).slice(0, 64),
    label,
    category,
    edits,
    lastEditedAt: new Date().toISOString(),
    projects: [{ repoId: `repo-${project}`, project, edits, sessions: 1 }],
  };
}

function overviewWith(filesInPlay) {
  const overview = createEmptyOverview(7);
  return { ...overview, codebase: { ...overview.codebase, filesInPlay } };
}

const baseProps = { liveSessions: [], openProject: () => {} };

/**
 * The attention-strip face (files in play): the scale story is the
 * design's load-bearing claim — segments compress and the tail folds instead
 * of the tile growing — so it is pinned here where demo data (3 files)
 * cannot exercise it.
 */
describe('files-in-play attention strip', () => {
  it('null signal renders the honest empty state, no strip', () => {
    const { container } = render({ ...baseProps, overview: overviewWith(null) });
    expect(container.textContent).toContain('No files in play right now');
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('few files: one segment per file, no tail, legend carries name + count', () => {
    const inPlay = { distinctFiles: 3, files: [file(1, 5), file(2, 2), file(3, 1)] };
    const { container } = render({ ...baseProps, overview: overviewWith(inPlay) });
    const segments = container.querySelectorAll('[role="group"] > *');
    expect(segments.length).toBe(3);
    expect(segments[0].getAttribute('title')).toContain('file-1.ts: 5 edits');
    // The legend names every file and quantifies it WITH its unit — identity
    // + context at rest, off the marks, nothing left to infer.
    expect(container.textContent).toContain('file-1.ts');
    expect(container.textContent).toContain('5 edits');
    expect(container.textContent).toContain('1 edit');
    expect(container.textContent).not.toContain('more');
  });

  it('many files fold into one tail; label counts beyond-cap files, width only shipped edits', () => {
    // 10 shipped, 14 distinct: top 4 render, tail = 6 shipped + 4 beyond the
    // server cap = "+10 more". Tail WIDTH must sum only the 6 shipped tail
    // files' edits (no fabricated share for edits never received).
    const files = Array.from({ length: 10 }, (_, i) => file(i, 20 - i));
    const inPlay = { distinctFiles: 14, files };
    const { container } = render({ ...baseProps, overview: overviewWith(inPlay) });

    const segments = [...container.querySelectorAll('[role="group"] > *')];
    expect(segments.length).toBe(5);
    const tail = segments[4];
    expect(tail.getAttribute('title')).toBe('10 more files');
    // flexGrow carries the segment's value: shipped tail edits 16+15+14+13+12+11.
    expect(tail.style.flexGrow).toBe('81');
    // The legend's tail entry is its label alone — no value invents itself.
    expect(container.textContent).toContain('+10 more');
    // The lead value is the uncapped distinct count, not the shipped length.
    expect(container.textContent).toContain('14');
  });

  it('unlabeled files fall back to the salted-id prefix, never a fake name', () => {
    const inPlay = { distinctFiles: 1, files: [file(7, 4, { label: null })] };
    const { container } = render({ ...baseProps, overview: overviewWith(inPlay) });
    const segment = container.querySelector('[role="group"] > *');
    expect(segment.getAttribute('title')).toContain('7777777777…');
  });

  it('colors by category when every visible file carries one, naming the kind in text', () => {
    const inPlay = {
      distinctFiles: 2,
      files: [file(1, 5, { category: 'source' }), file(2, 2, { category: 'test' })],
    };
    const { container } = render({ ...baseProps, overview: overviewWith(inPlay) });
    const segments = [...container.querySelectorAll('[role="group"] > *')];
    expect(segments[0].style.background).toContain('--viz-cat-source');
    expect(segments[1].style.background).toContain('--viz-cat-test');
    // Never color-alone: the kind is named in the hover text.
    expect(segments[0].getAttribute('title')).toContain('source');
  });

  it('one uncategorized file downgrades the WHOLE strip to project accent (no mixed guess)', () => {
    const inPlay = {
      distinctFiles: 2,
      files: [file(1, 5, { category: 'source' }), file(2, 2, { category: null })],
    };
    const { container } = render({ ...baseProps, overview: overviewWith(inPlay) });
    const segments = [...container.querySelectorAll('[role="group"] > *')];
    for (const s of segments) {
      // jsdom serializes the hsl() project accent to rgb(); the point is
      // that NO segment wears a category token.
      expect(s.style.background).toMatch(/^rgb\(/);
      expect(s.style.background).not.toContain('--viz-cat');
    }
  });
});
