// Tool metadata for WEB display. The canon — which ids exist, what they are
// called, and each vendor's brand color — lives in @seorak/types (identity.ts),
// because the phone brands the same agents and a registry the phone cannot
// import is a registry that drifts.
//
// The brand-color rule (inherited from types): brand color rides the MARK only.
// The label stays ink, and no fill takes a vendor hue.
//
// NO VENDORED TOOL MARK SHIPS HERE, AND `icon` IS ALWAYS NULL.
//
// This file used to map thirteen tool ids to `/assets/*.svg` vendor marks.
// ADR 005 section 6 flagged those marks for the same qualified legal review as
// the typeface, and its `packages/web` section set one condition for keeping
// them: stage B7 re-syncs all thirteen from a PINNED simple-icons version and
// records the version and date, or `toolMeta.ts` falls back to a text glyph and
// no vendored marks go public.
//
// B7 measured it against upstream on 2026-08-04 and the re-sync is not
// achievable. Only five of the thirteen were simple-icons content at all, and
// simple-icons carries no `visualstudiocode`, `aider`, `amazonq`, `continue`,
// `zed`, or `codex` at v15.0.0 or at master, so eight of them could not be
// pinned to any version that exists. The per-file measurement is in
// ../../THIRD_PARTY_NOTICES.md.
//
// So the fallback branch is the one that applies, and taking it also removes the
// open legal question rather than deferring it: with nothing vendored there is
// nothing for the review to rule on. Every tool now renders the colored letter
// fallback `ToolIcon` already implements, which is honest-empty rather than
// degraded: an absent mark is absent, not fabricated.
//
// Restoring an icon is a deliberate change, not an oversight to correct. It
// needs an entry in `docs/reference/vendored-assets.json` with an upstream
// source, a version, a sync date, and a digest, and it needs the legal question
// answered. `npm run vendored-assets:check` is what refuses the shortcut.
import {
  TOOL_IDENTITY,
  isKnownTool,
  normalizeToolId,
  resolveToolIdentity,
  toolRegistryProblems,
} from '@seorak/types';

export interface ToolMetaEntry {
  label: string;
  icon: string | null;
  color: string;
}

export interface ResolvedToolMeta extends ToolMetaEntry {
  id: string;
}

/** No tool carries a vendored mark, so every tool resolves to the letter
 *  fallback. `icon` stays in the shape because `ToolIcon` reads it and because
 *  a backend-resolved icon URL is still a separate, later branch there. */
const TOOL_ICON = null;

// Dev-time validation: the registry check is a pure function in types, so it can
// be asserted in a test there AND surfaced to whoever is editing this file.
if (import.meta.env?.DEV) {
  for (const problem of toolRegistryProblems()) {
    console.warn(`[toolMeta] ${problem}`);
  }
}

export function getToolMeta(toolId: string | null | undefined): ResolvedToolMeta {
  const { id, label, brandColor } = resolveToolIdentity(toolId);
  return { id, label, icon: TOOL_ICON, color: brandColor };
}

export { isKnownTool, normalizeToolId };

/** The web's composed view of the shared canon. */
export const TOOL_META: Record<string, ToolMetaEntry> = Object.fromEntries(
  Object.entries(TOOL_IDENTITY).map(([id, entry]) => [
    id,
    { label: entry.label, icon: TOOL_ICON, color: entry.brandColor },
  ]),
);
