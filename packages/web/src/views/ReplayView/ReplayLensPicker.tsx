// The lens picker: choosing a question, in the tray where scope is chosen.
//
// Lenses used to be a row of pills in the transport, at the opposite end of the
// screen from every other scope decision and flat at a dozen entries — a bare
// list of uppercase words that says nothing about what any of them answers.
// This renders the catalog's OWN structure instead: the three questions Replay
// answers, each with the lenses that answer it at the current level, each named
// by its one-line description. Nothing here is a hand-maintained list; adding a
// lens to `catalog.ts` adds it to this menu.

import { useCallback, useMemo, useRef } from 'react';
import clsx from 'clsx';

import ProjectDropdown, {
  ProjectDropdownRadioCheck,
  ProjectDropdownTriggerLabel,
} from '../../components/ProjectDropdown/ProjectDropdown.js';
import { useToggleHotkey } from '../../hooks/useCustomizeHotkey.js';
import { lensGroupsForLevel } from './lenses/index.js';
import type { ReplayLevel } from './lenses/types.js';
import styles from './ReplayLensPicker.module.css';

/**
 * All three questions have to be visible at once — a menu you must scroll to
 * discover "Where attention spiked" is the flat tray again with extra steps.
 * One line per lens at this width keeps every group above the fold.
 */
const MENU_MAX_HEIGHT = 460;
const MENU_WIDTH = 404;

export default function ReplayLensPicker({
  level,
  activeLensId,
  open,
  onOpenChange,
  onSelectLens,
}: {
  level: ReplayLevel;
  activeLensId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLens: (id: string | null) => void;
}) {
  const groups = useMemo(() => lensGroupsForLevel(level), [level]);
  const flat = useMemo(() => groups.flatMap((group) => group.lenses), [groups]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = flat.find((lens) => lens.id === activeLensId) ?? null;

  const focusActive = useCallback(() => {
    const index = Math.max(0, flat.findIndex((lens) => lens.id === activeLensId));
    requestAnimationFrame(() => itemRefs.current[index]?.focus());
  }, [activeLensId, flat]);

  /**
   * The trigger toggles the LENS SURFACE, not just this menu.
   *
   * Once a lens is open the sheet carries the same grouped catalog in its rail,
   * so opening the menu on top of it would paint a second identical copy of the
   * list over the first. The two surfaces divide cleanly instead: the menu
   * answers "what can I ask?" when nothing is open, the rail answers "what
   * else?" while you are reading, and neither is ever on screen with the other.
   */
  const toggleSurface = useCallback(() => {
    if (active) {
      onSelectLens(null);
      onOpenChange(false);
      return;
    }
    onOpenChange(!open);
  }, [active, onOpenChange, onSelectLens, open]);

  // `L` reaches it, the same way `C` reaches Customize. Replay is a keyboard
  // surface once you are scrubbing — going to the tray with the mouse to change
  // question costs the playhead position you were reading.
  useToggleHotkey({ key: 'l', onToggle: toggleSurface });

  if (groups.length === 0) return null;

  function focusItem(index: number) {
    const count = flat.length;
    if (count === 0) return;
    itemRefs.current[(index + count) % count]?.focus();
  }

  let itemIndex = -1;

  return (
    <ProjectDropdown
      ariaLabel={active ? `Close the ${active.name} lens` : 'Choose a lens'}
      menuAriaLabel="Replay lenses"
      menuMaxHeight={MENU_MAX_HEIGHT}
      menuWidth={MENU_WIDTH}
      open={open}
      // Reads as engaged while its sheet is up, because that is what pressing
      // it now does: close what it opened.
      active={Boolean(active)}
      onOpenChange={(next) => {
        if (next) {
          toggleSurface();
          return;
        }
        onOpenChange(false);
      }}
      onOpen={focusActive}
      trigger={
        <>
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="6" cy="6" r="4.1" />
              <path d="M9.2 9.2 L12.4 12.4" strokeLinecap="round" />
            </svg>
          </span>
          <ProjectDropdownTriggerLabel>
            {active ? active.name : 'Lens'}
          </ProjectDropdownTriggerLabel>
        </>
      }
    >
      {groups.map((group) => (
        <div key={group.question} className={styles.group}>
          <span className={styles.groupLabel} role="presentation">
            {group.label}
          </span>
          {group.lenses.map((lens) => {
            itemIndex += 1;
            const index = itemIndex;
            const selected = lens.id === activeLensId;
            return (
              <button
                key={lens.id}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={clsx(styles.item, selected && styles.itemActive)}
                onClick={() => {
                  // Picking the open lens again closes it — the trigger is the
                  // toggle for the sheet, not a one-way door into it.
                  onSelectLens(selected ? null : lens.id);
                  onOpenChange(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    focusItem(index + 1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    focusItem(index - 1);
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    focusItem(0);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    focusItem(flat.length - 1);
                  }
                }}
              >
                <span className={styles.itemName}>{lens.name}</span>
                {/* One line: the full sentence is written for a reader who
                    cannot see the screen, and lives in the sheet header and
                    the row's title. Here it only has to separate the choices. */}
                <span className={styles.itemDescription} title={lens.description}>
                  {lens.description}
                </span>
                <ProjectDropdownRadioCheck checked={selected} />
              </button>
            );
          })}
        </div>
      ))}
    </ProjectDropdown>
  );
}
