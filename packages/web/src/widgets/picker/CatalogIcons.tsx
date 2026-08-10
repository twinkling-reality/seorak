// ── Category icons ────────────────────────────────

import type { ReactNode } from 'react';

export const CAT_ICONS: Record<string, ReactNode> = {
  all: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="11" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="11" width="5" height="5" rx="1" />
      <rect x="11" y="11" width="5" height="5" rx="1" />
    </svg>
  ),
  live: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="5" opacity="0.5" />
      <circle cx="9" cy="9" r="8" opacity="0.25" />
    </svg>
  ),
  usage: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="2,14 6,8 10,11 16,4" />
      <polyline points="12,4 16,4 16,8" />
    </svg>
  ),
  outcomes: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="7" />
      <path d="M6 9l2 2 4-4" />
    </svg>
  ),
  activity: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1,9 4,9 6,4 8,14 10,7 12,9 17,9" />
    </svg>
  ),
  codebase: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5,5 2,9 5,13" />
      <polyline points="13,5 16,9 13,13" />
      <line x1="10" y1="3" x2="8" y2="15" />
    </svg>
  ),
  tools: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.4 2.6a5 5 0 0 0-6.2 6.2L2 12l1 3 3 1 3.2-3.2a5 5 0 0 0 6.2-6.2L13 9l-2-1-1-2z" />
    </svg>
  ),
};

export function CatalogChevronLeft() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 3 L4.5 7 L8.5 11" />
    </svg>
  );
}

export function CatalogChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 3 L9.5 7 L5.5 11" />
    </svg>
  );
}

export function CatalogSearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="6.5" cy="6.5" r="5" />
      <path d="M10.5 10.5 L14.5 14.5" />
    </svg>
  );
}
