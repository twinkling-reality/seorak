import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './RouteTransition.module.css';

export type RouteTransitionPreset =
  | 'marketing-scene'
  | 'marketing-page'
  | 'dashboard-view'
  | 'dashboard-detail'
  | 'none';

export type RouteNavType = 'initial' | 'push' | 'replace' | 'pop';

const PRESET_CLASS: Record<RouteTransitionPreset, string> = {
  'marketing-scene': styles.marketingScene,
  'marketing-page': styles.marketingPage,
  'dashboard-view': styles.dashboardView,
  'dashboard-detail': styles.dashboardDetail,
  none: styles.none,
};

interface Props {
  routeKey: string;
  preset?: RouteTransitionPreset;
  navType?: RouteNavType;
  className?: string;
  children: ReactNode;
}

export function RouteTransition({
  routeKey,
  preset = 'dashboard-view',
  navType = 'push',
  className,
  children,
}: Props): ReactNode {
  return (
    <div
      key={routeKey}
      className={clsx(
        styles.routeTransition,
        PRESET_CLASS[preset],
        navType === 'pop' && styles.pop,
        className,
      )}
      data-route-transition={preset}
      data-nav-type={navType}
    >
      {children}
    </div>
  );
}

