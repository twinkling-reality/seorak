// Model display names. The sibling of `toolMeta.ts`: that module turns an agent
// id into a human label, this one turns a MODEL id into a human label.
//
// Two forms, mirroring `formatDuration` ("18m") vs `formatDurationLong`
// ("18 minutes") in `lib/utils.ts`:
//
//   formatModel('claude-opus-4-8')      -> 'Opus 4.8'         dense labels
//   formatModelLong('claude-opus-4-8')  -> 'Claude Opus 4.8'  answer prose
//
// A bar row, a strip segment, and a compare cell sit next to other Claude rows,
// so repeating the vendor on each is noise. A sentence a person reads names the
// model in full.
//
// HONESTY: an id we cannot confidently parse is returned VERBATIM, never
// prettified into a name that might lie. That covers `<synthetic>` (Claude Code
// stamps it on injected assistant turns), other vendors' ids once a second tool
// ships (`gpt-5-codex`), and the family-last vendor shape
// (`claude-3-5-sonnet-20241022`), none of which this parser claims to know.
//
// These are DISPLAY names only. Pricing still matches on the raw id by family
// prefix (`@seorak/types` `MODEL_PRICES`) — nothing here feeds that lookup.
//
// Known collision: an account that used both `claude-opus-4-8` and a dated
// `claude-opus-4-8-20260101` in one window gets two rows labelled "Opus 4.8",
// since the worker aggregates on the exact id. Rare enough to accept; the fix
// (if it ever bites) is to disambiguate at the render site, not to stop
// dropping the date.

/** Families we can name. An id whose family segment is absent from this table
 *  falls through to the raw id — we do not guess at a display name. */
const MODEL_FAMILIES: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

const VENDOR = 'Claude';

interface ParsedModel {
  /** "Opus 4.8" */
  short: string;
  /** "Claude Opus 4.8" */
  long: string;
}

/** Snapshot-date suffix on a pinned id: `claude-haiku-4-5-20251001`. */
const DATE_SEGMENT = /^\d{8}$/;
/** Context-window qualifier Claude Code appends: `claude-opus-4-8[1m]`. */
const WINDOW_QUALIFIER = /^\d+m$/i;

/**
 * Parse `claude-<family>-<major>[-<minor>][-<yyyymmdd>][\[<window>\]]`.
 * Returns null on any shape this parser does not positively recognize, so the
 * caller can fall back to the raw id.
 */
function parseModel(id: string): ParsedModel | null {
  const trimmed = id.trim();
  if (trimmed === '') return null;

  // Split off a trailing bracket qualifier before touching the dashes.
  let base = trimmed;
  let qualifier = '';
  const bracket = /^(.*)\[([^\]]+)\]$/.exec(trimmed);
  if (bracket) {
    base = bracket[1]!;
    const inner = bracket[2]!;
    // Only the context-window form is understood. Anything else and we bail
    // rather than render a qualifier we cannot explain.
    if (!WINDOW_QUALIFIER.test(inner)) return null;
    qualifier = ` (${inner.toUpperCase()})`;
  }

  const segments = base.toLowerCase().split('-');
  if (segments.length < 3) return null;
  if (segments[0] !== 'claude') return null;

  const family = MODEL_FAMILIES[segments[1]!];
  if (!family) return null;

  const version = segments.slice(2);
  // Drop a pinned snapshot date: the user is choosing between Opus and Sonnet,
  // not between two builds of Opus.
  if (DATE_SEGMENT.test(version[version.length - 1] ?? '')) version.pop();

  // What remains must be a plain major[.minor]. Anything else ("latest", a
  // third component, nothing at all) is a shape we do not claim to know.
  if (version.length === 0 || version.length > 2) return null;
  if (!version.every((v) => /^\d+$/.test(v))) return null;

  const short = `${family} ${version.join('.')}${qualifier}`;
  return { short, long: `${VENDOR} ${short}` };
}

/**
 * Compact display name for dense labels: bar rows, strip segments, table cells.
 * Drops the vendor, which is redundant when every neighbouring row is a Claude
 * model. Unrecognized ids pass through unchanged.
 */
export function formatModel(id: string | null | undefined): string {
  const raw = String(id ?? '');
  return parseModel(raw)?.short ?? raw;
}

/**
 * Spelled-out display name for answer prose: "Claude Opus 4.8 leads your spend
 * at 58%." Keeps the vendor, which starts mattering the moment a second tool
 * puts a non-Claude model in the same sentence. Unrecognized ids pass through
 * unchanged.
 */
export function formatModelLong(id: string | null | undefined): string {
  const raw = String(id ?? '');
  return parseModel(raw)?.long ?? raw;
}
