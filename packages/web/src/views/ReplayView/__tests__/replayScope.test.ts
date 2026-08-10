import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '../../../lib/apiSchemas.js';
import type { ReplayProjectOption } from '../ReplaySelectionPanel.js';
import {
  resolveSelectedProjects,
  resolveSelectedSessionIds,
  sessionsParamForSelection,
  setSessionsInScope,
  toggleSessionInScope,
} from '../replayScope.js';

function session(sessionId: string, project: string): SessionSummary {
  return {
    sessionId,
    project,
    repoId: project,
    startedAt: '2026-06-04T12:00:00.000Z',
    lastEventAt: '2026-06-04T12:10:00.000Z',
  } as SessionSummary;
}

function project(repoId: string, sessions: SessionSummary[]): ReplayProjectOption {
  return {
    repoId,
    project: repoId,
    sessions,
  };
}

describe('replayScope', () => {
  const alpha = project('alpha', [session('a1', 'alpha')]);
  const beta = project('beta', [session('b1', 'beta')]);
  const projects = [alpha, beta];

  it('treats missing or empty project params as all projects', () => {
    expect(
      resolveSelectedProjects({
        projects,
        projectsParam: null,
      }).map((item) => item.repoId),
    ).toEqual(['alpha', 'beta']);

    expect(
      resolveSelectedProjects({
        projects,
        projectsParam: '',
      }).map((item) => item.repoId),
    ).toEqual(['alpha', 'beta']);
  });

  it('keeps session ids inside the selected project scope', () => {
    expect(
      resolveSelectedSessionIds({
        selectedProjects: [alpha],
        sessionsParam: 'a1,b1',
        scopedSessions: [alpha.sessions[0]!],
      }),
    ).toEqual(['a1']);
  });

  it('toggles one session out of scope while preserving order', () => {
    expect(toggleSessionInScope('s2', ['s1', 's2', 's3'], ['s1', 's2', 's3'])).toEqual(['s1', 's3']);
    expect(toggleSessionInScope('s2', ['s1', 's3'], ['s1', 's2', 's3'])).toEqual(['s1', 's2', 's3']);
  });

  it('takes or drops a whole shown set, leaving what the filter hid alone', () => {
    const scope = ['s1', 's2', 's3', 's4'];

    // A filter is showing s2 and s3; taking them must not disturb s1.
    expect(setSessionsInScope(['s2', 's3'], ['s1'], scope, true)).toEqual(['s1', 's2', 's3']);
    // Dropping the shown set leaves the hidden selection intact.
    expect(setSessionsInScope(['s2', 's3'], ['s1', 's2', 's3'], scope, false)).toEqual(['s1']);
    // Order follows the scope, not the order the ids arrived in.
    expect(setSessionsInScope(['s4', 's2'], [], scope, true)).toEqual(['s2', 's4']);
    // Already-selected members are not duplicated.
    expect(setSessionsInScope(['s1', 's2'], ['s1'], scope, true)).toEqual(['s1', 's2']);
    // "Only these" is clear-then-take, and it lands on exactly the shown set.
    const cleared = setSessionsInScope(scope, scope, scope, false);
    expect(cleared).toEqual([]);
    expect(setSessionsInScope(['s3'], cleared, scope, true)).toEqual(['s3']);
  });

  it('normalizes sessions param when all scoped sessions remain selected', () => {
    expect(sessionsParamForSelection(['a1'], ['a1'])).toBeNull();
    expect(sessionsParamForSelection(['a1', 'a2'], ['a1', 'a2'])).toBeNull();
    expect(sessionsParamForSelection(['a1'], ['a1', 'a2'])).toBe('a1');
    expect(sessionsParamForSelection([], ['a1', 'a2'])).toBe('');
  });

  it('caps default and explicit replay requests at forty sessions', () => {
    const manySessions = Array.from({ length: 10_000 }, (_, index) =>
      session(`s${index}`, 'large'),
    );
    const large = project('large', manySessions);
    const defaultIds = resolveSelectedSessionIds({
      selectedProjects: [large],
      sessionsParam: null,
      scopedSessions: manySessions,
    });
    const explicitIds = resolveSelectedSessionIds({
      selectedProjects: [large],
      sessionsParam: manySessions.map((row) => row.sessionId).join(','),
      scopedSessions: manySessions,
    });

    expect(defaultIds).toEqual(manySessions.slice(0, 40).map((row) => row.sessionId));
    expect(explicitIds).toEqual(defaultIds);
    expect(sessionsParamForSelection(defaultIds, manySessions.map((row) => row.sessionId))).toBe(
      defaultIds.join(','),
    );
  });

  it('does not let individual or bulk selection exceed the replay request cap', () => {
    const scope = Array.from({ length: 100 }, (_, index) => `s${index}`);
    const selected = scope.slice(0, 40);
    expect(toggleSessionInScope('s40', selected, scope)).toEqual(selected);
    expect(setSessionsInScope(scope, [], scope, true)).toEqual(selected);
  });
});
