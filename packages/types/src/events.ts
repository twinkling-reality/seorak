import { EVENT_BATCH_SCHEMA_VERSION } from "./event-protocol.ts";
import type { AgentId } from "./agent.ts";
export type { AgentId } from "./agent.ts";

export type SessionId = string;
export type EventId = string;
export type IsoTimestamp = string;

/**
 * AgentId — which agent/tool produced a session. Open string union: the known
 * literals ("claude-code", "codex" — both shipped adapters) keep autocomplete +
 * exhaustiveness on the known paths, while `(string & {})` admits ANY future
 * adapter id ("cursor", …) WITHOUT a `@seorak/types` release per tool — the
 * multi-tool seam (docs/specs/multi-tool.md §SessionEvent + agent-union seam).
 * Everything downstream of the collector keys on `event.kind`, never on a
 * closed agent set, so widening this never forces a worker/web change.
 * SessionSummary.agent is already plain `string`, so AgentId is a structural
 * subtype of what the projections already accept.
 */
/**
 * SessionCapabilities and its registry/resolver live in `capabilities.ts`, next
 * to the both-legs rule they enforce. This import is only for
 * `SessionStartEvent`; the package barrel exports `capabilities.ts` directly.
 */
import type { SessionCapabilities } from "./capabilities.ts";

export type SessionEvent =
  | SessionStartEvent
  | ToolCallEvent
  | SessionEndEvent
  | SessionNotificationEvent
  | GitMomentumEvent
  | SessionDeltaEvent
  | SessionLineSurvivalEvent
  | SessionTokensEvent
  | RepoToolchainEvent
  | SessionPromptEvent
  | AgentQuotaEvent;

/**
 * BranchWorkType — the coarse intent of a session's work, classified ON-MACHINE
 * from the git branch-name PREFIX and then the branch string is discarded (only
 * this closed enum ships). The sanctioned classify-then-discard move
 * (DEVELOPER-MODEL ADR-DM6): `feat/…`→feature, `fix/…`→fix, `refactor/…`→refactor,
 * `chore|ci|docs|build|test|style|perf/…`→chore, everything else (incl. main /
 * master / a bare name)→other. A work-TYPE conditioner (outcome | work-type),
 * never a grade. Absent when HEAD is detached, the cwd is not a repo, or git
 * capture is off. @grounding outcome
 */
export type BranchWorkType = "feature" | "fix" | "refactor" | "chore" | "other";

export interface SessionStartEvent {
  kind: "session.start";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  /** Stable salted per-repo id (sha256 of per-machine salt + git origin/toplevel,
   *  else the cwd) — identifies the repo across sessions WITHOUT revealing the
   *  path. Replaces the absolute workingDir: the absolute path stays LOCAL (the
   *  collector uses the cwd as a git cwd + to register the repo for the momentum
   *  sweep) and NEVER ships. The same salted-id + basename rule the git events
   *  already follow. @grounding outcome */
  repoId: string;
  /** basename(cwd / git toplevel) ONLY — the last path segment, e.g. "seorak",
   *  never an absolute path. The repo display label. */
  repoLabel: string;
  /** Which agent/tool produced this session, set by the active collector adapter
   *  (NOT hardcoded). Open union so a second tool needs no types release. */
  agent: AgentId;
  agentVersion: string;
  /** Per-session capability set, set ONCE here by the adapter and never mutated.
   *  OPTIONAL so legacy/KV-only collectors and hand-built test events stay valid;
   *  the live collector always sets it. Absent ⇒ unknown (the worker falls back
   *  to its existing per-field null gates, treating claude-code as capable).
   *  @grounding outcome */
  capabilities?: SessionCapabilities;
  /** Coarse work intent, from the branch-name prefix (classified on-machine, the
   *  branch string discarded — DEVELOPER-MODEL ADR-DM6). Absent when HEAD is
   *  detached / not a repo / git capture is off. A closed enum, never a branch
   *  name. @grounding outcome */
  branchWorkType?: BranchWorkType;
}

/**
 * Coarse file kind for edit-family calls, derived ON-MACHINE from the path
 * (extension + test-dir/test-suffix heuristics) which is then discarded.
 * A CLOSED seven-value enum: it can never reconstruct a path, so it ships
 * regardless of the fileLabels opt-in (CAPTURE-PRINCIPLE: signals, not
 * content). `other` means "matched no rule", never a guess.
 */
export type FileCategory =
  | "source"
  | "test"
  | "config"
  | "styles"
  | "docs"
  | "data"
  | "other";

/**
 * FileLanguage — the language FAMILY of an edited file, the finer increment over
 * the 7-bucket `fileCategory` (which collapses all code to "source"). Derived
 * ON-MACHINE from the extension (the path is discarded) and a CLOSED family enum:
 * dialects/versions collapse (ts+tsx→typescript, c+h→c) so it reveals stack MIX
 * without a per-file fingerprint. Rides the `fileSignals` opt-in (same gate as
 * `fileId`). Absent when no rule matches (never a guessed value) — honest-empty,
 * the same discipline as `fileCategory`. @grounding usage
 */
export type FileLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "kotlin"
  | "swift"
  | "c"
  | "cpp"
  | "csharp"
  | "ruby"
  | "php"
  | "shell"
  | "lua"
  | "html"
  | "css"
  | "sql"
  | "markdown"
  | "json"
  | "yaml"
  | "toml"
  | "vue"
  | "svelte";

/**
 * UndoKind — a within-session work DISCARD, classified ON-MACHINE from a git
 * command (the command was already lifted for verification and is discarded here;
 * only this closed enum ships). A narrowed set of genuine "changed back" actions:
 * `git reset --hard` → reset-hard, `git restore` / `git checkout -- …` → restore,
 * `git clean` → clean, `git revert` → revert. A friction/attention SHAPE, NEVER a
 * grade — a revert is "changed back", not "bad work" (CAPTURE-FOUNDATION ADR-CF6;
 * surfacing is hard-gated and outcome-conditioned). Absent for any other call.
 * @grounding outcome
 */
export type UndoKind = "reset-hard" | "restore" | "clean" | "revert";

/**
 * KnownToolName — the CLOSED set of tool tokens whose names ship verbatim,
 * across ALL adapters. `ToolCallEvent.toolName` stays a plain `string` on the
 * wire, but each collector adapter SANITIZES its value to one of these, or the
 * `"mcp"` bucket (every `mcp__<server>__<tool>` name, so a private MCP server
 * name never ships), or `"other"`. The emit value-pin (emit.ts) is the runtime
 * backstop. A raw/unknown name can never reach an event (CAPTURE-FOUNDATION
 * ADR-CF2, the P0 leak fix).
 *
 * Per-adapter vocabulary is disjoint on purpose: the Claude Code built-ins pass
 * through tool-name.ts; the two Codex
 * tokens (`Shell` = exec_command/shell, `ApplyPatch` = patch_apply_end) are
 * DISTINCT from Bash/Edit so two tools' distributions never merge wherever the
 * D1 `agent` column is NULL — un-merging an append-only log is impossible.
 * Codex's remaining tool vocabulary (dynamic tools: `tap`, `js`, `spawn_agent`,
 * …) is OPEN like MCP names and folds to `"other"`.
 */
export type KnownToolName =
  | "Task"
  | "Bash"
  | "BashOutput"
  | "KillShell"
  | "KillBash"
  | "Glob"
  | "Grep"
  | "Read"
  | "Edit"
  | "MultiEdit"
  | "Write"
  | "NotebookEdit"
  | "WebFetch"
  | "WebSearch"
  | "TodoWrite"
  | "ExitPlanMode"
  | "SlashCommand"
  | "ListMcpResources"
  | "ReadMcpResource"
  | "Shell"
  | "ApplyPatch";

export interface ToolCallEvent {
  kind: "tool.call";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  /** The tool name. Sanitized by the collector to a `KnownToolName`, the `"mcp"`
   *  bucket, or `"other"` before emit (tool-name.ts) — a raw/private tool name
   *  (e.g. an `mcp__<server>__…` server string) never ships. Value-pinned by the
   *  emit allowlist. @grounding usage */
  toolName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Populated by the collector: false on PostToolUse, true on
   *  PostToolUseFailure. Claude Code emits these as two SEPARATE hook events; the
   *  collector binds one script to BOTH and derives this boolean from
   *  hook_event_name with ZERO output parsing (the failure-info `tool_error`
   *  string is CONTENT and is never read or emitted). Publish-safe,
   *  collector-consumable home for the tool-call error signal that
   *  OverviewSnapshot.tools.callStats.errorRate consumes ("errored / calls that
   *  returned"): denominator = tool.call events whose `errored` is a boolean,
   *  numerator = `errored === true`. Optional so KV-only/legacy rows stay honest
   *  (absent, not false). @grounding outcome */
  errored?: boolean;
  /** Per-model token/cost accumulation. A single tool.call delta can span
   *  multiple assistant turns on DIFFERENT models, so byModel honesty needs a
   *  per-model breakdown here (not a scalar model tag). The collector buckets
   *  each transcript row by `row.message.model` (usage.ts) and emits one item per
   *  distinct model. `costUsd` is the PRICED cost for that model over this delta;
   *  a model NOT in the price table contributes its tokens with `costUsd: 0`
   *  (unpriced), and the honest-empty marker lives at the worker byModel layer
   *  (`ModelRollup.costUsd = null` when a model's whole cost is unpriced) — never
   *  a silent $0. Absent (not []) when the delta has no assistant rows. Publish-
   *  safe home for OverviewSnapshot.tools.byModel.
   *
   *  `cacheReadTokens`/`cacheWriteTokens` carry the per-model cache split so the
   *  WORKER can RE-PRICE this model from tokens alone (option C: pricing authority
   *  moved server-side) — cache cost is a large share of a cached Claude session,
   *  so byModel/headline repricing needs it per-model, not just the top-level sum.
   *  `costUsd` remains as the collector's advisory price (the no-event-log
   *  fallback); the worker recomputes from the tokens when present. @grounding cost */
  models?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
  }[];
  /** Lines added by THIS edit-tool call, derived ON-MACHINE by the adapter from
   *  the tool's own payload (Edit/MultiEdit: an LCS line-diff of old_string →
   *  new_string; Write: the line count of the written content) — the strings are
   *  read locally to count and immediately discarded, only the COUNT ships
   *  (CAPTURE-PRINCIPLE: derive on machine, ship the derivation). Absent — NOT 0 —
   *  for non-edit tools, failed calls (the edit never applied), and adapters that
   *  cannot derive it, so aggregates stay honest. @grounding usage */
  linesAdded?: number;
  /** Lines removed by THIS edit-tool call. Same derivation + honesty contract as
   *  `linesAdded`. Write carries 0 here when it overwrites (the replaced content
   *  is not in the payload, so removed lines are unknowable without reading the
   *  file — which the collector never does). @grounding usage */
  linesRemoved?: number;
  /** Salted per-file identity for edit-family calls (CAPTURE-PRINCIPLE: the
   *  repoId move one level down). sha256(per-machine salt + "\0" + absolute
   *  path), derived ON-MACHINE by the adapter — the path itself never ships.
   *  Powers file heat / rework recurrence / files-in-play. Absent for non-edit
   *  tools, failed calls, and when the `fileSignals` capture toggle is off.
   *  @grounding usage */
  fileId?: string;
  /** Salted identity of the file's directory (sha256(salt + "\0" + dirname)).
   *  Same derivation + absence contract as `fileId`. @grounding usage */
  dirId?: string;
  /** Coarse file KIND, derived ON-MACHINE from the path's basename and
   *  extension, then the path is discarded — only this closed enum ships.
   *  Deliberately NOT gated by the `fileLabels` opt-in: a seven-value enum
   *  cannot reconstruct a path or name, so it clears the capture boundary
   *  (signals, not content). Absent when the derivation has no rule for the
   *  path (never a guessed bucket) or on rows from older collectors.
   *  @grounding usage */
  fileCategory?: FileCategory;
  /** Human-readable file label — BASENAME ONLY, never a path segment more.
   *  Ships only when the default-OFF `fileLabels` capture toggle is opted in
   *  (your own repos, readable widget rows). @grounding usage */
  fileLabel?: string;
  /** Directory label — basename of the file's directory. Same opt-in contract
   *  as `fileLabel`. @grounding usage */
  dirLabel?: string;
  /** Verification signal (Capture Roadmap item 4): when this tool.call is a Bash
   *  command, the collector classifies the command LOCALLY into a verification
   *  kind and then DISCARDS the command string (the command is content and never
   *  ships). Absent for non-Bash / non-verification calls — the cheapest honest
   *  "did it work" without any output parsing of the command text. Consumed by
   *  OverviewSnapshot.tools.verification. @grounding outcome */
  verificationKind?: "test" | "build" | "typecheck" | "lint";
  /** Whether that verification run passed (tool_response exit_code === 0 / success
   *  === true). Absent — NOT false — when the result is unknown (no exit signal),
   *  so the pass-rate denominator stays "runs that returned a result". @grounding outcome */
  verificationPassed?: boolean;
  /** Language FAMILY of the edited file (closed enum), derived on-machine from the
   *  discarded path. Rides the `fileSignals` opt-in with `fileId`. Absent for
   *  non-edit calls and unmapped extensions (never a guess). @grounding usage */
  fileLanguage?: FileLanguage;
  /** Within-session work discard (closed enum), classified on-machine from a git
   *  command that is then discarded. Absent for any non-undo call. Captured
   *  log-only; surfacing is gated + outcome-conditioned (never a grade). @grounding outcome */
  undoKind?: UndoKind;
}

/**
 * The verbatim Claude Code SessionEnd `reason` enum (confirmed against the official hooks
 * docs). LIFECYCLE, not completion/quality: it records HOW the session ended (coarse),
 * never whether the work succeeded. The collector maps a recognized value straight through
 * and DEFAULTS unknown values to "other" (a real bucket, never a fabricated one).
 *
 * RUNTIME ARRAY, not just a type union, and that is the point. This union was hand-copied
 * into a web zod schema, a web copy map, and a demo fixture; the copies drifted to four
 * values, agreed with each other, and disagreed with production. The first session that
 * ended with `resume` failed the snapshot parse and blanked the entire Model pillar while
 * 987 web tests stayed green. A union with no runtime representation has nothing to check
 * a copy against. Build every enum/map/fixture FROM this array so a new reason is a
 * compile error, not a blank page.
 *
 * @grounding cadence
 */
export const SESSION_END_REASONS = [
  "clear",
  "resume",
  "logout",
  "prompt_input_exit",
  "bypass_permissions_disabled",
  "other",
] as const;

export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export interface SessionEndEvent {
  kind: "session.end";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  reason: SessionEndReason;
}

/**
 * SessionNotificationEvent is the collector's content-free signal that the
 * agent needs the human. ENUM ONLY — the Claude Code
 * notification `message` is CONTENT and is NEVER read or emitted (the emit-allowlist
 * is the runtime backstop). `permission_prompt` = blocked awaiting tool approval (the
 * clean "needs you" signal a silence-timer cannot fake); `idle_prompt` = waiting at
 * the prompt (lossy — any idle); `other` = any other notification kind. Drives the
 * live-ambient surface's needs-you glance, nothing else (not a quality signal).
 */
export interface SessionNotificationEvent {
  kind: "session.notification";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  notificationType: "permission_prompt" | "idle_prompt" | "other";
}

/**
 * gitContext — the honest-empty gate for every git read. Computed by the
 * collector from the session's cwd via a single documented precedence
 * (no-repo > detached > dirty-at-start > no-remote > clean). A non-git cwd is
 * "no-repo", so absent git is NEVER a silent zero. An enum only — carries no
 * path or content. @grounding outcome
 */
export type GitContext =
  | "no-repo"
  | "clean"
  | "dirty-at-start"
  | "detached"
  | "no-remote";

/**
 * GitMomentumEvent — a repo-scoped, lockfile-aware NET-change snapshot emitted
 * alongside session.start. COUNTS + ids/enum ONLY: no diffs, no file paths, no
 * code. Repo-scoped (NOT session-lifecycle) — the worker logs it to D1 but the
 * session reducer MUST skip it (it never creates/mutates a SessionState).
 *
 * Anti-vanity: raw lines-of-code is NEVER a score. The headline is
 * files-touched + NET change (linesAdded - linesDeleted), with generated/
 * lockfile lines filtered out and reported separately as `generatedLinesExcluded`
 * so the exclusion is auditable, never silent.
 */
/** Coarse repo-size band (distinct tracked files), never the raw count. */
export type RepoSizeBand = "xs" | "s" | "m" | "l" | "xl";
/** Coarse repo-age band (from the root-commit date), never the raw date. */
export type RepoAgeBand = "new" | "recent" | "established" | "mature";

/**
 * RepoShape — the coarse SHAPE of the repo a session ran in, derived ON-MACHINE
 * and bucketed (never a raw file count or date): whether it is a monorepo, its
 * size band, and its age band. A work-CONTEXT conditioner (outcome | repo-shape),
 * bands only so it cannot pin an exact repo. Rides `git.momentum`; absent when
 * underivable (honest-empty, never a guessed band). @grounding outcome
 */
export interface RepoShape {
  monorepo: boolean;
  sizeBand: RepoSizeBand;
  ageBand: RepoAgeBand;
}

export interface GitMomentumEvent {
  kind: "git.momentum";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  /** Stable per-repo id: sha256(per-machine salt + normalized origin url, else
   *  toplevel). Identifies a repo across sessions WITHOUT revealing it. */
  repoId: string;
  /** basename(toplevel) ONLY — the last path segment, NEVER an absolute path. */
  repoLabel: string;
  /** The git state at session start; "no-repo" gates this event out entirely
   *  (undefined, never emitted). @grounding outcome */
  gitContext: GitContext;
  /** Trailing window the counts cover (env SEORAK_MOMENTUM_WINDOW_DAYS, default 7). */
  windowDays: number;
  /** Commits in the window. @grounding outcome */
  commits: number;
  /** Distinct NON-ignored paths changed in the window. The lead metric. */
  filesTouched: number;
  /** Lines added over NON-ignored files (binary "-" markers count as 0).
   *  Raw LOC is never a score — pair with linesDeleted for NET change. */
  linesAdded: number;
  /** Lines deleted over NON-ignored files (binary "-" markers count as 0). */
  linesDeleted: number;
  /** Added+deleted lines summed over IGNORED (generated/lockfile) files —
   *  reported so the anti-vanity exclusion is auditable, never silent. */
  generatedLinesExcluded: number;
  /** Coarse repo shape (monorepo + size/age bands), derived on-machine and
   *  bucketed. Absent when underivable. A nested object — value-checked in full by
   *  the emit allowlist (the first git.momentum deep branch). @grounding outcome */
  repoShape?: RepoShape;
}

/**
 * SessionDeltaEvent — "did THIS session ship or thrash?" A retrospective,
 * repo-scoped snapshot emitted at session.end describing how the working tree +
 * HEAD moved between session start and end. COUNTS + ids/enum ONLY — no diffs, no
 * paths, and deliberately NO commit SHAs: a sha is a correlatable fingerprint
 * (googleable to the repo/author/diff) that would defeat the salted `repoId`, so
 * the start HEAD is remembered in a LOCAL per-session cursor and consumed only to
 * COUNT commits. Logged to D1; the session reducer skips it (non-lifecycle), like
 * git.momentum.
 *
 * Anti-vanity: lead with files-touched + NET uncommitted change; generated/
 * lockfile lines are filtered and surfaced separately. "Shipped" = commitsLanded
 * > 0; "thrash" = nothing landed but uncommitted churn is high.
 */
export interface SessionDeltaEvent {
  kind: "session.delta";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  repoId: string;
  repoLabel: string;
  /** git state at session END. */
  gitContext: GitContext;
  /** git state at session START — a `dirty-at-start` repo's uncommitted counts
   *  are not all this session's work. @grounding outcome */
  startGitContext: GitContext;
  /** Commits that landed between the start and end HEAD (rev-list count, never
   *  the shas). Absent — never a fabricated 0 — when the start HEAD was unknown
   *  (cursor missing, zero-commit start, history rewrite). @grounding outcome */
  commitsLanded?: number;
  /** Whether HEAD advanced (start sha known and differs from end sha). */
  headMoved: boolean;
  /** Distinct NON-ignored paths still uncommitted at end. The lead metric. */
  filesTouchedUncommitted: number;
  /** NET-change inputs over NON-ignored uncommitted tracked files (binary "-" = 0). */
  linesAddedUncommitted: number;
  linesDeletedUncommitted: number;
  /** Added+deleted lines over IGNORED (generated/lockfile) uncommitted files —
   *  the anti-vanity exclusion, surfaced so it stays auditable. */
  generatedLinesExcludedUncommitted: number;
}

/** The fixed maturation-ladder rung a line-survival check is for. A CLOSED enum
 *  (never a wall-clock / ageDays value) so the deterministic `eventId` and the
 *  worker's `(sessionId, rung)` read-dedup stay idempotent. Only "3d" in the
 *  first commit; the 8d/30d curve remains foundation-gated. */
export type LineSurvivalRung = "3d";

/** The session-level on-branch fate. `retained`/`overwritten` are RATED (enter the
 *  rate); `unreachable`/`unknown` are EXCLUDED (honest-empty, never graded gone). */
export type LineSurvivalFate = "retained" | "overwritten" | "unreachable" | "unknown";

/**
 * SessionLineSurvivalEvent — WS3 on-branch LINE survival. It supersedes the retired,
 * revert-blind commit-reachability approach: a `git revert` leaves the original sha
 * an ancestor of HEAD, so reachability alone scores backed-out work as "survived".
 * At a fixed maturation rung the daemon resolves the session's
 * recorded BRANCH tip and runs `git blame --porcelain -M -C -w` against it, counting
 * how many of the session's AUTHORED lines still trace to the session's own commits —
 * so a revert/overwrite reads `overwritten` while a reformat (handled by `-w`) and a
 * squash-merge-vs-branch-tip read `retained`. COUNTS + closed enums ONLY — never a
 * sha, path, branch name, diff, or line. Logged to D1; the KV reducer skips it like
 * git.momentum, so the log is the only place it lives. Anti-grade:
 * a low rate is "more changed back", NEVER "bad work" — persistence, not quality.
 */
/**
 * LineSurvivalCommit — one commit this session's work landed in (HEAD-TO-HEAD ADR-H4).
 *
 * The ONLY nested shape on this event, and it earns its place by making three numbers
 * EXACT that would otherwise be estimates:
 *
 *   1. **Commits landed per agent** must be a count of DISTINCT commits. Two sessions of
 *      one agent can land in the same commit, so summing per-session counts over-reports.
 *      The salted `id` lets the worker take a set UNION and get the true number.
 *   2. **Attribution coverage per agent** (the ADR-H9 gate) needs a denominator: the total
 *      lines in the commits that agent's work landed in. `added` carries it, and the same
 *      union de-duplicates it.
 *   3. **The three buckets** (this agent / contested / yours) need the contested split,
 *      which is a property of the COMMIT, not of the session — so two sessions reporting
 *      the same commit report the same value, and the union counts it once.
 *
 * PRIVACY: `id` is `saltedHash(sha)` — the same non-reversible, machine-salted recipe as
 * `repoId` and `fileId`, one level over. A raw sha is a globally-correlatable fingerprint
 * that would defeat the salted `repoId`; a salted commit id is an opaque grouping key that
 * lets the worker de-duplicate without ever learning what it de-duplicated.
 */
export interface LineSurvivalCommit {
  /** Salted, non-reversible commit id — `saltedHash(sha)`. NEVER the sha itself. */
  id: string;
  /** Total non-ignored lines the commit ADDED, across every file in it. The coverage
   *  DENOMINATOR. A property of the commit, identical across sessions reporting it. */
  added: number;
  /** Of `added`, the lines in files TWO OR MORE agents edited in the window, so no single
   *  agent owns them. Excluded from every agent's legs, and COUNTED so the surface can say
   *  so rather than resolve it by a coin flip. Also a property of the commit. */
  contested: number;
  /** Of `added`, the lines attributed to THIS session (files only its agent touched). The
   *  survival denominator's contribution. Invariant: `authored + contested <= added`. */
  authored: number;
}

export interface SessionLineSurvivalEvent {
  kind: "session.linesurvival";
  /** Deterministic per `(sessionId, rung, attributed-sha-set)`. The D1 `event_id` PK then
   *  collapses a re-emitted sweep for free (idempotent re-check).
   *
   *  The SHA SET is in the seed on purpose (ADR-H10): a session's attributed commits can
   *  legitimately GROW later, when a file it touched is finally committed. Keying on the
   *  set means a changed attribution emits a NEW row that the worker's latest-wins dedup
   *  picks up, while an unchanged one collapses on the PK. Without it, D1's
   *  `INSERT OR IGNORE` would silently keep the FIRST, staler answer forever. */
  eventId: EventId;
  /** The ORIGINAL session whose authored lines were re-checked (not a new session). */
  sessionId: SessionId;
  /** When the survival CHECK ran (the sweep time), not the original session time. */
  at: IsoTimestamp;
  repoId: string;
  /** basename ONLY — present only under the default-OFF `repoLabels` opt-in
   *  (CaptureSettings); omitted otherwise so the world-open read stays re-id-safe. */
  repoLabel?: string;
  /** git state of the repo at check time; "no-repo" gates this out (never emitted). */
  gitContext: GitContext;
  /** The fixed maturation-ladder rung (closed enum, never wall-clock). */
  rung: LineSurvivalRung;
  /** The session-level on-branch fate (see LineSurvivalFate). */
  fate: LineSurvivalFate;
  /** The session's landed commit count — the floor / sample-size basis (the worker
   *  suppresses the rate below a small floor). Always >= 1. */
  commitsChecked: number;
  /** Non-ignored lines the session authored (the survival denominator). */
  linesAuthored: number;
  /** Of those, still attributed to the session's commits at the branch tip — 0 for
   *  `unreachable`/`unknown`. Invariant: `linesSurviving <= linesAuthored`. */
  linesSurviving: number;
  /** Per-commit breakdown (ADR-H4 — see LineSurvivalCommit). Present only on events from
   *  the git-attribution mechanism; ABSENT on the retired session-window ones, so its
   *  absence honestly means "this row cannot be attributed to an agent", never zero. */
  commits?: LineSurvivalCommit[];
  /** Attributed files that no longer exist at the blame ref. Their lines count 0 surviving,
   *  which is CORRECT for a deletion and an UNDER-count for a move (git blame cannot read a
   *  path that is gone). Emitted so the under-count is visible rather than silent — the bias
   *  only ever reads survival LOW, never high, which is the right direction to be wrong. */
  filesGoneFromTip?: number;
}

/**
 * PackageManager — the repo's package manager, detected ON-MACHINE from lockfile
 * presence (existsSync only, ZERO content read). A closed enum; `null` when none
 * is detected (honest-empty, never guessed). @grounding outcome
 */
export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "pip"
  | "poetry"
  | "uv"
  | "pipenv"
  | "cargo"
  | "gomod"
  | "bundler"
  | "composer"
  | "maven"
  | "gradle";

/**
 * Framework — the repo's primary framework/stack, detected ON-MACHINE by matching
 * a closed table against manifest dependency KEYS (the manifest is read to match
 * and then DISCARDED — never shipped, CAPTURE-FOUNDATION ADR-CF3). A closed enum;
 * `null` when none of the known frameworks is present. The single highest-value
 * outcome conditioner (outcome | stack). @grounding outcome
 */
export type Framework =
  | "next"
  | "nuxt"
  | "remix"
  | "sveltekit"
  | "astro"
  | "react"
  | "vue"
  | "svelte"
  | "angular"
  | "solid"
  | "expo"
  | "react-native"
  | "electron"
  | "express"
  | "fastify"
  | "nest"
  | "django"
  | "flask"
  | "fastapi"
  | "rails"
  | "laravel"
  | "spring";

/**
 * RepoToolchainEvent — a repo-scoped toolchain-identity snapshot emitted alongside
 * session.start: which package manager + framework the repo uses. ENUMS + salted
 * id ONLY — the lockfile is only existsSync'd, the manifest is read on-machine to
 * match a closed framework table and then DISCARDED (never a dep name, path, or
 * manifest string ships). Repo-scoped (NOT session-lifecycle): the worker logs it
 * to D1 but the KV session reducer MUST skip it (like git.momentum). Gated by the
 * `toolchain` capture setting; emitted only when at least one of the two is
 * detected. The toolchain/stack conditioning axis DEVELOPER-MODEL named as missing
 * (ADR-DM5: outcome | stack). @grounding outcome
 */
export interface RepoToolchainEvent {
  kind: "repo.toolchain";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  /** Salted per-repo id (same recipe as session.start / git.momentum). */
  repoId: string;
  /** basename ONLY — present only under the default-OFF `repoLabels` opt-in
   *  (like session.linesurvival), omitted otherwise so the world-open read stays
   *  re-id-safe. Never a path. */
  repoLabel?: string;
  /** git state at capture time (enum only). */
  gitContext: GitContext;
  /** Detected package manager, or null when none is present (existsSync only). */
  packageManager: PackageManager | null;
  /** Detected primary framework, or null when none of the known set matches. */
  framework: Framework | null;
}

/**
 * SessionPromptEvent — a human-steering TICK: the developer submitted a prompt.
 * ENVELOPE ONLY (kind + eventId + sessionId + at) — the prompt TEXT is the densest
 * content surface in the whole system and is NEVER read or emitted (the emit
 * allowlist's envelope-only key-check is the runtime backstop). It exists so the
 * read layer can measure turns-per-session and steering cadence (how much the
 * human interjects vs lets the agent run) — counts + timestamps only. Emitted by
 * the UserPromptSubmit hook (the sixth hook). Session-scoped but NOT a lifecycle
 * transition: the worker logs it to D1 but the KV session reducer skips it.
 * @grounding cadence
 */
export interface SessionPromptEvent {
  kind: "session.prompt";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
}

/**
 * SessionTokensEvent — a session's token usage, carried at SESSION scope because
 * that is the only scope its source actually has (docs/specs/multi-tool.md).
 *
 * WHY THIS EXISTS AND WHY IT IS NOT ON `tool.call`. Claude's hook fires per tool
 * call with a real per-call usage delta, so its tokens ride `tool.call`. Codex's
 * rollout reports usage on a `token_count` row that carries NO call id (verified
 * 2026-07-12: 0 of 344 rows on CLI 0.144.1 carry one) — usage is TURN-scoped, and
 * a turn is not a call. Attributing these tokens to a specific call would invent
 * an attribution the source does not contain and would skew `tools.byTool` with a
 * number the rollout never claimed. So they ride the session.
 *
 * CUMULATIVE, NOT A DELTA. `models[]` holds the session's running TOTALS, re-emitted
 * as the session grows, and the worker keeps the LATEST row per session (greatest
 * `at`). Never summed. This is `git.momentum`'s carrier posture, chosen for the same
 * reason: a cumulative snapshot is idempotent under re-emit, so a re-tail after a
 * crash, a duplicate delivery, or a re-batched read cannot double-count. (Codex's
 * `total_token_usage` is monotonic in every component — verified across all 109
 * local rollouts, zero decreases — which is what makes the snapshot safe to trust.)
 *
 * PER-MODEL, NOT ONE MODEL ID. A Codex session can switch models mid-flight (7 of
 * 109 local rollouts do). One real session put 9,036,471 of its tokens on
 * `gpt-5.4-mini` and the rest on `gpt-5.5`, whose input rate is 6.7x higher —
 * pricing that session under a single stamped model id overstates its cost by 40%.
 * The breakdown is the same shape as `ToolCallEvent.models[]` so `priceModels()`
 * consumes it unchanged, including the partial-pricing path that lets a session mix
 * priced and unpriced models without fabricating a $0.
 *
 * The token fields are CACHE-EXCLUSIVE, like Claude's and unlike Codex's raw ones:
 * the adapter de-includes at the source (Codex's `input_tokens` INCLUDES its
 * `cached_input_tokens`; a field-for-field copy would double-count the cache reads
 * and fabricate a cache-reuse ratio).
 *
 * Session-scoped but NOT a lifecycle transition: the worker logs it to D1 and the
 * KV session reducer skips it. @grounding cost
 */
export interface SessionTokensEvent {
  kind: "session.tokens";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  /** Running session TOTALS split by the model that was active when they accrued.
   *  Latest-wins per session; NEVER summed across rows. A model contributes an entry
   *  only once it has actually consumed tokens (a model named by the transcript but
   *  never billed is absent, not a zero row). */
  models: {
    model: string;
    /** Cache-EXCLUSIVE input (de-included from the source's cache-inclusive field). */
    inputTokens: number;
    /** Includes reasoning tokens, which the vendor bills AS output. */
    outputTokens: number;
    cacheReadTokens: number;
    /** 0 for Codex: OpenAI publishes no cache-write premium and the rollout reports
     *  no such tokens. Present for shape parity with ToolCallEvent.models[]. */
    cacheWriteTokens: number;
  }[];
}

/**
 * AgentQuotaEvent — the provider's own reading of how much of a TOOL'S ACCOUNT quota is
 * gone (docs/specs/multi-tool.md). Codex's `token_count` rows carry a
 * `rate_limits` block with a provider-computed `used_percent`, a real `resets_at`, and
 * the window's length.
 *
 * ACCOUNT-SCOPED, ON A SESSION ENVELOPE. The `sessionId` is PROVENANCE — which session
 * happened to observe it — never a key. This is `repo.toolchain`'s posture: a fact whose
 * real subject is not the session it rode in on. That the reading is account-wide is
 * measured, not assumed: across the local corpus a new session's FIRST reading equals the
 * previous session's LAST, exactly, in 10 of 10 tight handoffs, and 68 of 77 sessions
 * OPEN at a non-zero percentage (up to 55%). A session-scoped counter always starts at 0.
 * Two concurrent sessions read the same number within seconds of each other.
 *
 * WHY IT IS NOT A FIELD ON `session.tokens`, WHICH IS WHERE IT LOOKS LIKE IT BELONGS.
 * Both facts arrive on the SAME `token_count` row, so pairing them is tempting and it is
 * wrong. `handleTokenCount` refuses to emit on five guards that exist for TOKEN reasons —
 * chiefly "no token movement", because Codex re-emits `token_count` with unchanged
 * cumulative totals. Measured over the real corpus, riding `session.tokens` would have
 * SILENTLY DROPPED 2,272 of 8,718 quota readings (26.1%). The quota's freshness would be
 * hostage to guards that know nothing about it, and tightening a token guard later would
 * degrade the gauge with no test to notice. They are two facts at two scopes that one
 * wire format merged, not one fact.
 *
 * NEVER SUMMED, LATEST-WINS GLOBALLY. The truth is the most recent snapshot per (tool,
 * window) across ALL sessions, and it is DEAD once its `resetsAt` has passed: the window
 * it describes no longer exists, and rendering it would be a lie by staleness. Re-emission
 * is safe because the reduce is an overwrite, not a counter, and the D1 primary key
 * collapses a re-tailed row anyway.
 *
 * Logged to D1; the KV session reducer skips it (it is not a lifecycle transition, and
 * bumping a session's liveness off an account metric would corrupt it — `git.momentum`'s
 * rule). @grounding cost
 */
export interface AgentQuotaEvent {
  kind: "agent.quota";
  eventId: EventId;
  sessionId: SessionId;
  at: IsoTimestamp;
  /** WHOSE quota. Carried in the payload rather than read off the `events.agent` column,
   *  because that column is resolved from the sessions a batch reduced, and a batch that
   *  holds only a quota row leaves it NULL — where `agentOfRow` would fall back to
   *  "claude-code" and file an OpenAI reading under Anthropic. */
  tool: AgentId;
  /** Every window the provider reported in this snapshot. A window the provider did NOT
   *  report is ABSENT here, never a zero: absence and 0% are DIFFERENT and the provider
   *  uses both. (One real payload reports the weekly window's emptiness as `0.0%` and the
   *  5-hour window's emptiness by OMITTING it, in the same row. So an absent window is
   *  unexplained, and reading it as zero would fabricate a measurement.) */
  windows: {
    /** The provider's OWN window length, in minutes, exactly as reported. The reader
     *  buckets on THIS, never on the slot the provider put it in: on CLI 0.144.1 the
     *  `primary` slot holds the WEEKLY window on 10.6% of rows and the 5-hour one on the
     *  rest, and `secondary` can be null. The slots are a list, not a schema. */
    windowMinutes: number;
    /** The provider's share-of-window, 0..100. Authoritative and complete as of `at`. */
    usedPercent: number;
    /** When this window resets. The LIVENESS ARBITER: once it has passed, the reading is
     *  dead, because the window it describes no longer exists.
     *
     *  NON-NULLABLE ON PURPOSE, and the adapter DROPS a window it cannot date rather than
     *  emit one. A percentage with no reset time cannot be told apart from the same
     *  percentage a week stale, so it is not a weaker reading, it is an unusable one.
     *  (The Codex reader takes ONE statement of the reset: an absolute `resets_at` in UNIX
     *  SECONDS. A relative `resets_in_seconds` was also read once; measured 2026-07-27,
     *  all 3,580 slots carrying it are on CLI 0.46.0, which is below the adapter's
     *  supported floor, so that reading was retired. A below-floor slot now yields no
     *  window at all — honest absence, not an undated one.) */
    resetsAt: IsoTimestamp;
  }[];
}

export interface EventBatch {
  /** Required wire-contract version. Compatibility is checked before drain. */
  schemaVersion: typeof EVENT_BATCH_SCHEMA_VERSION;
  collectorVersion: string;
  deviceId: string;
  events: SessionEvent[];
}
