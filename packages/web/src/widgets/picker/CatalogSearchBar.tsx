import clsx from 'clsx';
import type { RefObject } from 'react';

import glass from '../../components/surface/glass.module.css';
import cmd from '../../styles/commandStrip.module.css';

import { CatalogSearchIcon } from './CatalogIcons.js';

/** Opt-in search, floating above the panel. Its own bar rather than a field in the
 *  panel: the panel is a list you scan, and a permanent input invites typing at a
 *  surface where every other key is a shortcut. */
export function CatalogSearchBar({
  inputRef,
  value,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className={clsx(cmd.searchBar, glass.sheet, glass.rim)} style={{ bottom: 64 + 420 + 8 }}>
      <CatalogSearchIcon className={cmd.searchIcon} />
      <input
        ref={inputRef}
        type="text"
        className={cmd.searchInput}
        placeholder="Search widgets..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className={cmd.searchHint}>Esc to close</span>
    </div>
  );
}
