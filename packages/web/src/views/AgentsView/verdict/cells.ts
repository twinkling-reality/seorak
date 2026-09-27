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

/**
 * An honest-empty cell whose text says WHICH absence it is.
 *
 * There is no anonymous placeholder here on purpose. One `dash()` used to feed all
 * thirteen absent cells on this page, so thirteen different facts (no priced token,
 * no committed line, a tool that ran nothing in this project, a call that reported
 * no result) rendered as the same punctuation mark and the reader had to work out
 * which from the row label. Every caller names its own reason instead.
 *
 * The reasons are terse because the cell is: AgentsView.module.css gives a data cell
 * roughly 90 to 200px of mono, which is a phrase and not a sentence. The sentence
 * belongs in the row `hint` and in the disclosures under the table, which is where
 * the caveats on this page already live.
 */
export function blank(reason: string): MatrixCell {
  return { text: reason, empty: true };
}

export function text(value: string): MatrixCell {
  return { text: value, empty: false };
}
