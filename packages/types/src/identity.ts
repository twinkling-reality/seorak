/**
 * identity.ts — how a PROJECT and a TOOL are recognized, on every surface.
 *
 * Identity is not decoration and it is not a stat. It is a label: the mark that
 * says *which* project or *which* agent a claim is about, in the same category
 * as the project's name. That is why an identity mark is exempt from the "an
 * element that cannot be false is decoration" test (MOBILE-EMPHASIS ADR-4) —
 * a name cannot be false either, and neither is making a claim.
 *
 * It lives here because identity must RHYME ACROSS SURFACES: the same repo is
 * the same color in the web sidebar, the phone's eyebrow, and the Projects tab,
 * or the mark means nothing. Before this file, the web hash and the phone hash
 * were the same arithmetic typed twice (the phone's file called itself "a PORT
 * of packages/web/src/lib/projectGradient.ts"), which is a drift waiting to
 * happen — one hue tweak on either side and a project quietly becomes two
 * colors.
 *
 * This module owns the ALGORITHM and the CANON. It does not own the RENDER:
 * web builds CSS gradient strings, the phone builds LinearGradient stops, and
 * icon asset paths stay in web where the assets are. Publish-safe by the types
 * boundary — a color hash and a public tool registry carry no secret.
 *
 * NOT to be confused with the curated per-project PALETTE (project-themes.ts).
 * That is the color the USER chose for a project and is honest-empty when unset.
 * This is the derived mark that is always available and never user-set. A
 * surface must never let one imply the other.
 */

// ---------------------------------------------------------------------------
// Project identity — the derived gradient mark, keyed by SALTED repoId
// ---------------------------------------------------------------------------

/** djb2. Stable across engines and cheap; the mark must be identical on a phone
 *  and in a browser, so this can never become a platform hash. */
function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * The hue geometry of one project's identity mark. Surfaces render these numbers
 * their own way (radial layers in CSS, stacked linear gradients on the phone) but
 * they must all start HERE, or the same repo drifts to a different color per
 * surface.
 */
export interface ProjectHues {
  /** The identity hue. A solid fill (a chart bar) uses this one alone. */
  baseHue: number;
  /** The second stop of the base gradient — a near neighbor, never a clash. */
  hue2: number;
  /** The contrasting bloom, roughly opposite the base. */
  accent: number;
  /** Bloom centers, as percentages. Only a layered render needs these. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Derive a project's identity hues from its salted repo id. Never a path: the
 * capture principle says a repo reaches us as a salted id, and the mark is keyed
 * off exactly that, so the color leaks nothing about the filesystem.
 *
 * An empty id hashes like any other string rather than throwing — an unlabeled
 * project still gets a stable mark instead of a hole.
 */
export function projectHues(repoId: string): ProjectHues {
  const h = hashCode(repoId || "");
  const baseHue = h % 360;
  return {
    baseHue,
    hue2: (baseHue + 25 + ((h >> 8) % 25)) % 360,
    accent: (baseHue + 160 + ((h >> 4) % 40)) % 360,
    x1: 20 + ((h >> 2) % 35),
    y1: 10 + ((h >> 6) % 35),
    x2: 55 + ((h >> 10) % 30),
    y2: 55 + ((h >> 14) % 30),
  };
}

// ---------------------------------------------------------------------------
// Tool identity — the canonical id, display label, and brand color per agent
// ---------------------------------------------------------------------------

/** A tool's canon: what we call it, and the hue that means "this vendor".
 *  Icons are NOT here — an asset path is a per-surface render detail. */
export interface ToolIdentityEntry {
  label: string;
  /** The vendor's own brand hue.
   *
   *  THE RULE, which every surface inherits: brand color rides the MARK, never
   *  a fill and never a label. Prose legibility must not depend on a vendor hue,
   *  and a large saturated vendor fill competes with the only two colors that are
   *  load-bearing on a Seorak surface (lavender = live, amber = waiting on you).
   *  A tile that repaints itself when the leading agent flips at 51/49 is also a
   *  color that carries a fact, which DESIGN_LANGUAGE forbids outright. */
  brandColor: string;
}

/** The registry. Canonical keys only — real-world spellings arrive through
 *  ALIASES and PARTIAL_MATCHES below. */
export const TOOL_IDENTITY: Record<string, ToolIdentityEntry> = {
  claude: { label: "Claude Code", brandColor: "#d9773c" },
  cursor: { label: "Cursor", brandColor: "#111111" },
  windsurf: { label: "Windsurf", brandColor: "#0f8b7b" },
  vscode: { label: "VS Code", brandColor: "#0078d4" },
  codex: { label: "Codex", brandColor: "#10a37f" },
  aider: { label: "Aider", brandColor: "#297a4a" },
  amazonq: { label: "Amazon Q", brandColor: "#5b36d6" },
  jetbrains: { label: "JetBrains", brandColor: "#f97316" },
  continue: { label: "Continue", brandColor: "#047857" },
  cline: { label: "Cline", brandColor: "#c2410c" },
  warp: { label: "Warp", brandColor: "#01a4ff" },
  zed: { label: "Zed", brandColor: "#09090b" },
  copilot: { label: "GitHub Copilot", brandColor: "#6e40c9" },
  devin: { label: "Devin", brandColor: "#4f46e5" },
  superset: { label: "Superset", brandColor: "#0ea5e9" },
  replit: { label: "Replit", brandColor: "#f26207" },
  goose: { label: "Goose", brandColor: "#1d4ed8" },
  amp: { label: "Amp", brandColor: "#a855f7" },
  kiro: { label: "Kiro", brandColor: "#ff9900" },
  augment: { label: "Augment Code", brandColor: "#8b5cf6" },
  cody: { label: "Cody", brandColor: "#a112ff" },
  tabnine: { label: "Tabnine", brandColor: "#e44332" },
  opencode: { label: "OpenCode", brandColor: "#22c55e" },
  roocode: { label: "Roo Code", brandColor: "#3b82f6" },
  pieces: { label: "Pieces", brandColor: "#111111" },
  boltnew: { label: "Bolt.new", brandColor: "#1389fd" },
  lovable: { label: "Lovable", brandColor: "#ec4899" },
  v0: { label: "v0", brandColor: "#000000" },
  trae: { label: "Trae", brandColor: "#3b82f6" },
  void: { label: "Void", brandColor: "#6366f1" },
  pearai: { label: "PearAI", brandColor: "#84cc16" },
  sweep: { label: "Sweep AI", brandColor: "#8b5cf6" },
  blackbox: { label: "BLACKBOX AI", brandColor: "#111111" },
  coderabbit: { label: "CodeRabbit", brandColor: "#f97316" },
  greptile: { label: "Greptile", brandColor: "#047857" },
  qodo: { label: "Qodo", brandColor: "#3b82f6" },
  ellipsis: { label: "Ellipsis", brandColor: "#7c3aed" },
  mintlify: { label: "Mintlify", brandColor: "#0d9373" },
  wisprflow: { label: "Wispr Flow", brandColor: "#6366f1" },
  superwhisper: { label: "Superwhisper", brandColor: "#f43f5e" },
  sourcery: { label: "Sourcery", brandColor: "#f59e0b" },
  phind: { label: "Phind", brandColor: "#6366f1" },
};

/** Strip spacing and separators so "claude-code", "Claude Code", and
 *  "claude_code" all reach the same key. */
export function normalizeToolId(toolId: string | null | undefined): string {
  return String(toolId || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_.-]/g, "");
}

/** Real-world id spellings mapped onto canonical keys. */
export const TOOL_ALIASES: Record<string, string> = {
  claudecode: "claude",
  amazonqdeveloper: "amazonq",
  visualstudiocode: "vscode",
  githubcopilot: "copilot",
  codexcli: "codex",
  goosebyblock: "goose",
  ampbysourcegraph: "amp",
  codybysourcegraph: "cody",
  augmentcode: "augment",
  traeide: "trae",
  sweepai: "sweep",
  blackboxai: "blackbox",
  piecesfordevelopers: "pieces",
  v0byvercel: "v0",
  windsurfeditor: "windsurf",
};

/** Ordered substring fallbacks for ids that wrap a canonical key in extra words
 *  ("jetbrainsaiassistant"). Longest first: order is the tie-break, so this must
 *  stay a list and never become an object. Prefer an ALIAS when one will do. */
export const TOOL_PARTIAL_MATCHES: ReadonlyArray<{ substring: string; key: string }> = [
  { substring: "jetbrains", key: "jetbrains" },
  { substring: "amazonq", key: "amazonq" },
  { substring: "windsurf", key: "windsurf" },
  { substring: "continue", key: "continue" },
  { substring: "copilot", key: "copilot" },
  { substring: "cursor", key: "cursor" },
  { substring: "claude", key: "claude" },
  { substring: "codex", key: "codex" },
  { substring: "cline", key: "cline" },
  { substring: "aider", key: "aider" },
  { substring: "devin", key: "devin" },
  { substring: "goose", key: "goose" },
];

/** A deterministic hue for a tool we have never seen, so an unknown agent still
 *  gets a stable mark rather than a shared grey. Distinct from the project hash
 *  on purpose: these are different namespaces and must not collide by accident. */
export function deriveToolColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

export interface ResolvedToolIdentity extends ToolIdentityEntry {
  id: string;
  /** False when this is a formatted fallback rather than a registry entry — a
   *  surface that must not brand a guess can check this instead of pattern
   *  matching the label. */
  known: boolean;
}

/** Resolve any spelling of a tool id to its canon. Total: an unknown id comes
 *  back title-cased with a derived hue, never null and never "Unknown". */
export function resolveToolIdentity(toolId: string | null | undefined): ResolvedToolIdentity {
  const normalized = normalizeToolId(toolId);

  const aliasKey = TOOL_ALIASES[normalized];
  if (aliasKey && TOOL_IDENTITY[aliasKey]) {
    return { id: aliasKey, ...TOOL_IDENTITY[aliasKey], known: true };
  }

  if (TOOL_IDENTITY[normalized]) {
    return { id: normalized, ...TOOL_IDENTITY[normalized], known: true };
  }

  for (const { substring, key } of TOOL_PARTIAL_MATCHES) {
    if (normalized.includes(substring)) {
      return { id: key, ...TOOL_IDENTITY[key]!, known: true };
    }
  }

  const pretty = String(toolId || "tool")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    id: normalized || "tool",
    label: pretty,
    brandColor: deriveToolColor(normalized || "tool"),
    known: false,
  };
}

/** True when `toolId` resolves to a tool we actually know (not a fallback). */
export function isKnownTool(toolId: string | null | undefined): boolean {
  return resolveToolIdentity(toolId).known;
}

/** Registry self-check: alias and partial-match targets that name no entry.
 *  Pure, so it can be asserted in a test AND logged by a surface in dev. */
export function toolRegistryProblems(): string[] {
  const problems: string[] = [];
  for (const [alias, target] of Object.entries(TOOL_ALIASES)) {
    if (alias === target) {
      problems.push(`alias "${alias}" redundantly names its canonical tool`);
    }
    if (!TOOL_IDENTITY[target]) problems.push(`alias "${alias}" points at unknown tool "${target}"`);
  }
  for (const { substring, key } of TOOL_PARTIAL_MATCHES) {
    if (!TOOL_IDENTITY[key]) {
      problems.push(`partial match "${substring}" points at unknown tool "${key}"`);
    }
  }
  return problems;
}
