import type { ComponentType } from 'react';
import type { CaptureSettings, SessionSummary } from '@seorak/types';
import type { OverviewSnapshot } from '../../lib/apiSchemas.js';

/**
 * Props every widget body receives. The snapshot is the single source of
 * truth; `liveSessions` is the snapshot's current session board.
 */
export interface WidgetBodyProps {
  overview: OverviewSnapshot;
  liveSessions: SessionSummary[];
  /** Effective capture toggles from Settings → Data & capture. Null while loading. */
  capture?: CaptureSettings | null;
  /** Open a per-repo project view, keyed on the salted repoId (never the basename,
   *  which can collide across repos). */
  openProject: (repoId: string) => void;
}

export type WidgetBody = ComponentType<WidgetBodyProps>;
export type WidgetRegistry = Record<string, WidgetBody>;
