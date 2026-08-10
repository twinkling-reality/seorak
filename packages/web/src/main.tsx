import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import DashboardApp from './DashboardApp.js';
import { BrandProvider } from './brand/brand.js';
import { seorakBrand } from './brand/seorakBrand.js';
import RenderErrorBoundary from './components/RenderErrorBoundary/RenderErrorBoundary.js';
import { SystemFault, SystemPreview } from './components/system/index.js';
import './app.css';

/**
 * THE DASHBOARD ENTRY, and the whole of it.
 *
 * There is no path test here and no lazy boundary, which is the point of the
 * split. The file this replaced, `App.tsx`, existed only to choose between the
 * marketing tree and the dashboard, and it could not be given an interface that
 * hid the choice: the predicate had to answer before anything could be resolved.
 * Two documents answer it by construction instead, so this one mounts the
 * dashboard and knows nothing about Seorak's website.
 *
 * `DashboardApp` is a STATIC import for the same reason. When one document served
 * both halves it had to be lazy, so a visitor to `/` did not download the
 * dashboard; here it is the only thing this document can render, and a lazy
 * boundary would only buy a loader flash in front of a chunk that is always
 * needed. Its Safari IPv6 retry moved to `src/marketing/main.tsx`, which still
 * has a dynamic import to protect.
 */

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// DEV-ONLY: a gallery of the system screens at /__sys. Vite statically replaces
// import.meta.env.DEV with false in prod, so this branch and SystemPreview are
// dead-code-eliminated from production builds.
const path = window.location.pathname;
const preview =
  import.meta.env.DEV && (path === '/__sys' || path.startsWith('/__sys/')) ? path : null;

// The brand slot is provided ONCE, here at the entry. `brand.tsx` defaults to a
// neutral mark with no owner line and no legal links, so a fork that removes
// this prop has a working dashboard that claims nothing.
createRoot(root).render(
  <BrandProvider brand={seorakBrand}>
    <RenderErrorBoundary
      label="App shell"
      resetKey="app-root"
      fallback={({ reset, error }) => <SystemFault error={error} onRetry={reset} />}
    >
      {preview === null ? <DashboardApp /> : <SystemPreview path={preview} />}
    </RenderErrorBoundary>
  </BrandProvider>,
);
