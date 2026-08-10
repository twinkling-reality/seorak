// AgentsRepoFilter — the repo multi-select on the Agents header. Empty selection
// means "All projects" (the global head-to-head); a strict subset re-scopes every
// panel to those repos (agentsScope.aggregateAgentSeries). Mirrors the Replay
// selection dropdown's pattern so the two surfaces feel the same.

import { useCallback, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import ProjectDropdown, {
  ProjectDropdownItem,
  ProjectDropdownItemCount,
  ProjectDropdownItemLabel,
  ProjectDropdownItemName,
  ProjectDropdownSwatch,
  ProjectDropdownToggle,
  ProjectDropdownTriggerLabel,
} from '../../components/ProjectDropdown/ProjectDropdown.js';
import { projectGradient } from '../../lib/projectGradient.js';

export interface AgentsRepoOption {
  repoId: string;
  project: string;
  sessions: number;
}

interface Props {
  repos: AgentsRepoOption[];
  /** Selected repoIds. Empty == "All projects" (the global view). */
  selected: string[];
  /** Next selection. Empty array == all (the component normalizes all/none → []). */
  onChange: (next: string[]) => void;
}

export default function AgentsRepoFilter({ repos, selected, onChange }: Props) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedSet = new Set(selected);
  const allSelected = selected.length === 0 || selected.length === repos.length;
  const firstSelected = repos.find((r) => selectedSet.has(r.repoId)) ?? repos[0] ?? null;

  const label = allSelected
    ? 'All projects'
    : selected.length === 1
      ? (firstSelected?.project ?? 'Selected projects')
      : `${selected.length} projects`;

  const toggle = useCallback(
    (repoId: string) => {
      const next = new Set(selected);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      // Keep the caller order stable (repos order) and normalize all/none → [] (= all).
      const ordered = repos.map((r) => r.repoId).filter((id) => next.has(id));
      onChange(ordered.length === repos.length ? [] : ordered);
    },
    [selected, repos, onChange],
  );

  const focusItem = useCallback((index: number) => {
    const count = itemRefs.current.length;
    if (count === 0) return;
    itemRefs.current[((index % count) + count) % count]?.focus();
  }, []);

  const onItemKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusItem(index + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusItem(index - 1);
      }
    },
    [focusItem],
  );

  if (repos.length === 0) return null;

  return (
    <ProjectDropdown
      ariaLabel={`Filter agents by project: ${label}`}
      trigger={
        <>
          <ProjectDropdownSwatch
            style={{
              background: projectGradient(allSelected ? 'all-projects' : (firstSelected?.repoId ?? 'all-projects')),
            }}
          />
          <ProjectDropdownTriggerLabel>{label}</ProjectDropdownTriggerLabel>
        </>
      }
    >
      {repos.map((repo, index) => {
        const active = !allSelected && selectedSet.has(repo.repoId);
        return (
          <ProjectDropdownItem
            key={repo.repoId}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            onClick={() => toggle(repo.repoId)}
            onKeyDown={(event) => onItemKeyDown(event, index)}
            role="menuitemcheckbox"
            aria-checked={active}
          >
            <ProjectDropdownSwatch style={{ background: projectGradient(repo.repoId) }} />
            <ProjectDropdownItemLabel>
              <ProjectDropdownItemName>{repo.project}</ProjectDropdownItemName>
              <ProjectDropdownItemCount>{repo.sessions.toLocaleString()}</ProjectDropdownItemCount>
            </ProjectDropdownItemLabel>
            <ProjectDropdownToggle on={active} />
          </ProjectDropdownItem>
        );
      })}
    </ProjectDropdown>
  );
}
