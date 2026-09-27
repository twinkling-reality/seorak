/**
 * SystemPreview — DEV-ONLY gallery for the system screens.
 *
 * Reached at /__sys (index) and /__sys/<name>. Gated behind import.meta.env.DEV
 * in App.tsx, so Vite dead-code-eliminates it from production builds. Lets you
 * eyeball the takeover screens (loader, 404, fault) on demand, since most of them
 * are otherwise transient Suspense / error fallbacks.
 */

import { type CSSProperties, type ReactNode } from 'react';
import { SystemLoader } from './SystemLoader.js';
import { SystemMiniLoader } from './SystemLoader.js';
import { SystemNotFound } from './SystemNotFound.js';
import { SystemFault } from './SystemFault.js';
import { SystemError } from './SystemError.js';

const VARIANTS: { slug: string; label: string }[] = [
  { slug: 'loader', label: 'Loader: indeterminate (no number)' },
  { slug: 'loader-progress', label: 'Loader: determinate (62%, checklist)' },
  { slug: 'mini', label: 'Mini loader (inline / centered fallback)' },
  { slug: 'notfound', label: 'Not found: PAGE LOST (404)' },
  { slug: 'fault', label: 'Error boundary: SYSTEM FAULT' },
  { slug: 'inline', label: 'Inline error: CONNECTION LOST' },
];

const wrap: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--page-bg)',
  color: 'var(--ink)',
  fontFamily: 'var(--mono)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const list: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 360,
};

const linkStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 24,
  padding: '12px 16px',
  border: '1px solid var(--hairline)',
  borderRadius: 'var(--radius-sm, 8px)',
  color: 'var(--ink)',
  textDecoration: 'none',
  fontSize: 12,
  letterSpacing: '0.04em',
};

const chip: CSSProperties = {
  position: 'fixed',
  top: 20,
  left: 24,
  zIndex: 10000,
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.1em',
  color: 'var(--muted)',
  textDecoration: 'none',
  borderBottom: '1px solid var(--hairline)',
  padding: '4px 0',
};

function BackChip(): ReactNode {
  return (
    <a href="/__sys" style={chip}>
      {'<-- previews'}
    </a>
  );
}

export function SystemPreview({ path }: { path: string }): ReactNode {
  const slug = path.replace(/^\/__sys\/?/, '');

  if (slug === '' ) {
    return (
      <div style={wrap}>
        <div style={list}>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--soft)', marginBottom: 6 }}>
            SYSTEM SCREENS, DEV PREVIEW
          </span>
          {VARIANTS.map((v) => (
            <a key={v.slug} href={`/__sys/${v.slug}`} style={linkStyle}>
              <span>{v.label}</span>
              <span style={{ color: 'var(--soft)' }}>{'-->'}</span>
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (slug === 'loader') return <><BackChip /><SystemLoader /></>;
  if (slug === 'loader-progress') return <><BackChip /><SystemLoader progress={0.62} /></>;
  if (slug === 'mini')
    return (
      <>
        <BackChip />
        <div style={wrap}>
          <SystemMiniLoader center label="loading" />
        </div>
      </>
    );
  if (slug === 'notfound') return <><BackChip /><SystemNotFound /></>;
  if (slug === 'fault') {
    const sample = new Error('Preview: synthetic fault for the SYSTEM FAULT screen.');
    return <><BackChip /><SystemFault error={sample} onRetry={() => window.location.assign('/__sys')} /></>;
  }
  if (slug === 'inline')
    return (
      <>
        <BackChip />
        <div style={{ ...wrap, padding: '0 48px', justifyContent: 'flex-start', alignItems: 'center' }}>
          <SystemError
            title="CONNECTION LOST"
            message="Preview: failed to fetch overview (500)."
            diagnostics={[
              ['ENDPOINT', '/overview'],
              ['STATUS', '500'],
            ]}
            onRetry={() => window.location.assign('/__sys')}
          />
        </div>
      </>
    );

  // Unknown slug: back to the index.
  return (
    <div style={wrap}>
      <a href="/__sys" style={linkStyle}>
        Unknown preview. Back to index {'-->'}
      </a>
    </div>
  );
}

export default SystemPreview;
