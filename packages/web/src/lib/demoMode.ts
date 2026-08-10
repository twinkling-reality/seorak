// Demo-mode activation and scenario selection. Reads ?demo=<scenario-id>
// from the URL; when present, hooks skip their API fetch and use the named
// scenario's fixture instead. The selector UI (DemoSwitcher) writes this
// param back via history.replaceState so scenario swaps don't navigate.
//
// Rules:
// - Demo is GATED to builds where it is allowed (see demoAllowed): dev always,
//   production only behind an explicit VITE_ENABLE_DEMO flag (staging). A plain
//   production build ignores ?demo entirely, so a shared ?demo=<scenario> URL can
//   never surface synthetic data on the live dashboard (agent-standards red flag:
//   "demo or fallback data on the live path in production").
// - Where allowed, the URL param is the source of truth: ?demo=empty wins over
//   any local state; ?demo with no value (or "1") resolves to the default
//   scenario so a bare `?demo` toggle still works.
// - The switcher is visible wherever demo is allowed so local/staging work can
//   exercise scenarios; hidden in production.

import { DEFAULT_SCENARIO, isDemoScenarioId, type DemoScenarioId } from './demo/index.js';
import { isDevBuild, isDemoFlagEnabled } from './buildEnv.js';

const DEMO_PARAM = 'demo';

function readParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(DEMO_PARAM);
}

/**
 * Whether demo mode is permitted in THIS build. Dev builds always; a production
 * build only when the explicit `VITE_ENABLE_DEMO` opt-in is set (staging). This is
 * the gate that keeps a shared `?demo=<scenario>` URL from surfacing SYNTHETIC
 * data as if it were real on the live production dashboard — `?demo` is inert in a
 * plain production build.
 */
export function demoAllowed(): boolean {
  return isDevBuild() || isDemoFlagEnabled();
}

/** True when demo is allowed in this build AND the URL carries `?demo` (any
 *  value). Hooks use this to gate the API-fetch path; production builds where
 *  demo is not allowed always read false, so the live path stays real. */
export function isDemoActive(): boolean {
  if (typeof window === 'undefined') return false;
  if (!demoAllowed()) return false;
  return new URLSearchParams(window.location.search).has(DEMO_PARAM);
}

/** Active scenario id resolved from the URL. Returns the default when the
 *  param is absent, empty, or points to an unknown scenario. */
export function getActiveScenarioId(): DemoScenarioId {
  const raw = readParam();
  if (raw == null) return DEFAULT_SCENARIO;
  if (raw === '' || raw === '1' || raw === 'true') return DEFAULT_SCENARIO;
  return isDemoScenarioId(raw) ? raw : DEFAULT_SCENARIO;
}

/** Update the URL's `?demo=` in place. Preserves other query params; does
 *  not push a history entry so the browser back button doesn't accumulate
 *  scenario swaps. Clears to a bare URL when passed null. */
export function setActiveScenarioId(id: DemoScenarioId | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id == null) url.searchParams.delete(DEMO_PARAM);
  else url.searchParams.set(DEMO_PARAM, id);
  window.history.replaceState({}, '', url.toString());
  window.dispatchEvent(new Event('seorak:demo-scenario-changed'));
}

/** Whether to surface the DemoSwitcher floating control. Shown wherever demo is
 *  allowed (dev + explicit-flag staging) — it is the toggle affordance — and
 *  never in a plain production build. */
export function shouldShowDemoSwitcher(): boolean {
  return demoAllowed();
}
