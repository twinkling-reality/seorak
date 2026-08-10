// Build-environment probes, isolated so gating logic (e.g. demo mode) can be
// unit-tested by mocking THIS module. `import.meta.env.DEV` is a build-time
// constant Vite inlines per-module, so it cannot be flipped at runtime in a test;
// keeping the reads behind these tiny functions gives tests a mock seam.

/** True in a dev build (`vite`/`wrangler dev`); false in a production build. */
export function isDevBuild(): boolean {
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
}

/** True when the explicit `VITE_ENABLE_DEMO=true` opt-in is set at build time —
 *  the staging escape hatch that permits demo in a non-dev build. */
export function isDemoFlagEnabled(): boolean {
  return (
    (import.meta as unknown as { env?: { VITE_ENABLE_DEMO?: string } }).env?.VITE_ENABLE_DEMO ===
    'true'
  );
}
