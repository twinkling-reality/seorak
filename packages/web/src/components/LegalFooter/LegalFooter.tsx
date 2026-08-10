import type { ReactNode } from 'react';
import { useBrand } from '../../brand/brand.js';
import styles from './LegalFooter.module.css';

type LegalFooterProps = {
  className?: string;
  ownerClassName?: string;
  linksClassName?: string;
  showOwner?: boolean;
};

/**
 * The owner line and legal links this build actually has, read from the brand
 * slot rather than hardcoded.
 *
 * The hardcoded version named Twinkling Reality and linked `/privacy`, `/terms`, and
 * `/subprocessors` from every surface including the dashboard, and those pages
 * exist on Seorak's marketing site and nowhere else. A dashboard served from the
 * collector's loopback plane rendered three links that answer 404. An unbranded
 * build has no owner and no legal pages, so it renders nothing rather than an
 * empty bar.
 */
export function LegalFooter({
  className = '',
  ownerClassName = '',
  linksClassName = '',
  showOwner = true,
}: LegalFooterProps): ReactNode {
  const { owner, legal } = useBrand();
  const withOwner = showOwner && owner !== null;
  if (!withOwner && legal.length === 0) return null;
  return (
    <div className={`${styles.legalFooter} ${className}`.trim()}>
      {withOwner && (
        <span className={`${styles.owner} ${ownerClassName}`.trim()}>{owner}</span>
      )}
      {legal.length > 0 && (
        <nav className={`${styles.links} ${linksClassName}`.trim()} aria-label="Legal">
          {legal.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
