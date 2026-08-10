/**
 * The table vocabulary every Agents panel writes in. Kept in one place because the
 * Why matrix, the Where split, and the Outcomes panel all render through the SAME
 * row renderer in AgentsView: if `empty` meant something slightly different in one
 * of them, an honest-empty cell in that panel would silently pick up the ink of a
 * measured one.
 */

/** `empty` is the honest-empty flag the renderer styles on, NOT "the string is short". */
export type MatrixCell = { text: string; empty: boolean };

export interface MatrixRow {
  id: string;
  label: string;
  hint: string;
  cells: MatrixCell[];
}

export function dash(): MatrixCell {
  return { text: '—', empty: true };
}

export function text(value: string): MatrixCell {
  return { text: value, empty: false };
}
