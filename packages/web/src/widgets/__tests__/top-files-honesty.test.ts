import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { codebaseWidgets } from '../bodies/CodebaseWidgets.js';
import { createEmptyOverview } from '../../lib/schemas/index.js';

// DA-05: a file can carry edits (fileSignals) without any line-bearing row
// (lineCounts is an independent capture toggle). A measured zero is impossible
// for an edit, so 0/0 means "never measured" and MUST NOT render as "+0/−0" (a
// fabricated zero a user reads as "14 edits that net zero lines").
function renderFiles(files: { fileId: string; label: string | null; edits: number; linesAdded: number; linesRemoved: number; sessions: number }[]): string {
  const overview = createEmptyOverview();
  overview.codebase.files = files;
  const Files = codebaseWidgets['files'];
  return renderToStaticMarkup(
    createElement(Files, { overview, liveSessions: [], openProject: () => {} }),
  );
}

describe('top-files line meta honesty (DA-05)', () => {
  it('renders the edit count but NO +0/−0 when lines were never measured', () => {
    const html = renderFiles([
      { fileId: 'f1', label: 'overview.ts', edits: 14, linesAdded: 0, linesRemoved: 0, sessions: 4 },
    ]);
    expect(html).not.toContain('+0/');
    expect(html).toContain('14');
  });

  it('still renders the +added/−removed meta when lines WERE measured', () => {
    const html = renderFiles([
      { fileId: 'f2', label: 'projections.ts', edits: 9, linesAdded: 80, linesRemoved: 12, sessions: 2 },
    ]);
    expect(html).toContain('+80/');
  });
});
