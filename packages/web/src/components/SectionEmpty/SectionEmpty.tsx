import { useContext, useEffect, type ReactNode } from 'react';
import { EmptyWidgetContext } from '../WidgetGrid/WidgetGrid.js';
import styles from './SectionEmpty.module.css';

interface Props {
  children: ReactNode;
}

export default function SectionEmpty({ children }: Props) {
  // Signal the enclosing widget cell that the body is in empty state.
  // The cell uses this to collapse to fit-content sizing while empty and
  // restore to its authored row span when data arrives and SectionEmpty
  // unmounts. Outside a widget cell the context is null and this is a
  // no-op, so detail panels can keep using SectionEmpty unchanged.
  const setEmpty = useContext(EmptyWidgetContext);
  useEffect(() => {
    if (!setEmpty) return;
    setEmpty(true);
    return () => setEmpty(false);
  }, [setEmpty]);

  return <span className={styles.sectionEmpty}>{children}</span>;
}
