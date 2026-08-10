// ModelScopePicker — the project scope on the Model header. SINGLE select, because
// the worker builds one portrait for one scope: `GET /developer-model?repoId=` takes
// a repo or nothing, and a portrait of two-of-five repos is not a thing the read can
// honestly compile (its rates would be a client-side blend of two windows, which is
// exactly the fabrication the aggregate contract exists to prevent). Agents can
// multi-select because it re-aggregates fair per-repo cells; this cannot.

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
import type { ProjectOption } from '../../hooks/useOverview.js';
import { projectGradient } from '../../lib/projectGradient.js';

const ALL_KEY = 'all-projects';

interface Props {
  projects: readonly ProjectOption[];
  /** null == the merged portrait across every repo. */
  selected: string | null;
  onChange: (repoId: string | null) => void;
}

export default function ModelScopePicker({ projects, selected, onChange }: Props) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = projects.find((p) => p.repoId === selected) ?? null;
  const label = active?.project ?? 'All repos';

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

  // One repo is not a choice — the picker would offer the reader their only
  // project and the merged view of that same project.
  if (projects.length < 2) return null;

  // "All repos" is an option in the list, not a clear button, so returning to the
  // merged portrait is the same gesture as choosing any other scope.
  const rows: Array<{ key: string; repoId: string | null; name: string; count: string }> = [
    { key: ALL_KEY, repoId: null, name: 'All repos', count: `${projects.length}` },
    ...projects.map((p) => ({
      key: p.repoId,
      repoId: p.repoId as string | null,
      name: p.project,
      count: p.sessions.toLocaleString(),
    })),
  ];

  return (
    <ProjectDropdown
      ariaLabel={`Scope this read to a project: ${label}`}
      trigger={
        <>
          <ProjectDropdownSwatch
            style={{ background: projectGradient(active?.repoId ?? ALL_KEY) }}
          />
          <ProjectDropdownTriggerLabel>{label}</ProjectDropdownTriggerLabel>
        </>
      }
    >
      {rows.map((row, index) => {
        const on = row.repoId === selected;
        return (
          <ProjectDropdownItem
            key={row.key}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            onClick={() => onChange(row.repoId)}
            onKeyDown={(event) => onItemKeyDown(event, index)}
            role="menuitemradio"
            aria-checked={on}
          >
            <ProjectDropdownSwatch style={{ background: projectGradient(row.repoId ?? ALL_KEY) }} />
            <ProjectDropdownItemLabel>
              <ProjectDropdownItemName>{row.name}</ProjectDropdownItemName>
              <ProjectDropdownItemCount>{row.count}</ProjectDropdownItemCount>
            </ProjectDropdownItemLabel>
            <ProjectDropdownToggle on={on} />
          </ProjectDropdownItem>
        );
      })}
    </ProjectDropdown>
  );
}
