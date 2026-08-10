/**
 * project-themes.ts — the per-project COLOR contract, the FOURTH family in the
 * generic D1 `settings` table alongside `capture`, `notifications`, and
 * `liveActivity`. It is one surface-agnostic source of truth so a project's
 * signature color drives every surface: the Live
 * Activity, the Dynamic Island, and the in-app views, with no "notification color
 * vs LA color drifted" bug).
 *
 * Keyed by the SALTED repoId (collision-free), never the basename — two repos can
 * share a basename, and the codebase groups on repoId precisely to avoid that
 * (ADR-4). The label shown in the editor is the repoLabel basename, joined client-
 * side from GET /overview's usage.projects; the color map itself never carries it.
 *
 * The stored value is a fixed palette TOKEN, never a free hex (ADR-2): a curated,
 * on-brand set keeps every project legible and the contract a tiny enum, and Swift
 * can own its display-P3 values rather than round-tripping a serialized colour. The
 * lavender `--accent`/`--live` token is deliberately NOT in the palette — it stays
 * reserved for "something is happening right now," not "this is project X."
 *
 * Fault-soft, like every other settings coercer: a missing row, a corrupt blob, or
 * an entry with an unknown token all read as "no theme" (the surface falls back to
 * its default look), never a fabricated or wrong colour. Un-theming a project is a
 * patch that sets its entry to null; `coerceProjectThemes` then drops it.
 */

/** The six on-brand, non-live palette tokens (ratified 2026-06-19). Each maps to a
 *  brand colour in `PALETTE_HEX`; the order is the picker's swatch order. Lavender
 *  is intentionally absent (reserved for live/real-time data). */
export const PALETTE_TOKENS = [
  "pink",
  "green",
  "amber",
  "red",
  "indigo",
  "purple",
] as const;

export type PaletteToken = (typeof PALETTE_TOKENS)[number];

/** The one source of colour truth, mirrored from the web brand palette
 *  (`packages/web/src/app.css` non-live tokens). The web swatch, the mobile swatch,
 *  and the Swift Live-Activity render all resolve a token through this map (Swift
 *  may use its own display-P3 values for the exact same hues). */
export const PALETTE_HEX: Record<PaletteToken, string> = {
  pink: "#d49aae", // --accent-alt
  green: "#18b46f", // --success
  amber: "#ff9b3f", // --warn
  red: "#ff6b57", // --danger
  indigo: "#5d58de", // --info
  purple: "#8a63ff", // --purple
};

export function isPaletteToken(v: unknown): v is PaletteToken {
  return typeof v === "string" && (PALETTE_TOKENS as readonly string[]).includes(v);
}

/** One project's theme. v1 = just a colour; the wrapper leaves room for later
 *  per-project visual config (an icon, a glyph) without another settings family. */
export interface ProjectTheme {
  color: PaletteToken;
}

export interface ProjectThemes {
  /** repoId → theme. Empty by default; a repo absent here uses the surface default
   *  look (honest-empty, never a fabricated colour). */
  byRepo: Record<string, ProjectTheme>;
}

export const DEFAULT_PROJECT_THEMES: ProjectThemes = { byRepo: {} };

/**
 * Coerce an unknown (stored row, request body, fetched JSON) into a full
 * ProjectThemes. Fault-soft and allowlist-based, mirroring `coerceCaptureSettings`
 * / `coerceNotificationSettings`: any entry without a VALID palette token is DROPPED
 * (so a corrupt row, a null "un-theme" patch, or a stale token can never fabricate
 * or mis-apply a colour), and the map stays sparse so it only ever carries real
 * choices.
 */
export function coerceProjectThemes(raw: unknown): ProjectThemes {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawByRepo =
    obj.byRepo && typeof obj.byRepo === "object" && !Array.isArray(obj.byRepo)
      ? (obj.byRepo as Record<string, unknown>)
      : {};
  const byRepo: Record<string, ProjectTheme> = {};
  for (const [repoId, value] of Object.entries(rawByRepo)) {
    if (repoId.length === 0) continue; // the "All projects" aggregate has repoId "" — never themable
    const color = value && typeof value === "object" ? (value as Record<string, unknown>).color : undefined;
    if (isPaletteToken(color)) byRepo[repoId] = { color };
  }
  return { byRepo };
}

/**
 * The single resolver every surface consults: the palette token chosen for a
 * (salted) repoId, or null when the project is un-themed (the surface then uses its
 * own default look). Never throws, never fabricates.
 */
export function projectColorToken(themes: ProjectThemes, repoId: string): PaletteToken | null {
  return themes.byRepo[repoId]?.color ?? null;
}
