import type { ReactNode } from 'react';
import styles from './SectionTitle.module.css';

interface Props {
  children: ReactNode;
}

export default function SectionTitle({ children }: Props) {
  return <h2 className={styles.sectionTitle}>{children}</h2>;
}
