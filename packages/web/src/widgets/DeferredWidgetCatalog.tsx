import { lazy, Suspense, type ComponentProps } from 'react';

import type { WidgetCatalog } from './WidgetCatalog.js';

type WidgetCatalogProps = ComponentProps<typeof WidgetCatalog>;

const LazyWidgetCatalog = lazy(async () => {
  const module = await import('./WidgetCatalog.js');
  return { default: module.WidgetCatalog };
});

/** Load the customize surface only when it is opened. */
export function DeferredWidgetCatalog(props: WidgetCatalogProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <LazyWidgetCatalog {...props} />
    </Suspense>
  );
}
