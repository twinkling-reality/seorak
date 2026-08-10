/**
 * capture.ts — the capture-settings contract shared by the worker (stores +
 * serves them), the collector (fetches + enforces them on-machine), and the web
 * (the Settings → Data & capture toggles).
 *
 * Scope guard (CAPTURE-PRINCIPLE): these toggles only ever REDUCE capture below
 * the default — they gate optional signal families the collector derives
 * locally — with ONE deliberate exception: `fileLabels` is a default-OFF opt-in
 * that widens what ships from salted ids to human-readable basenames. That is
 * still never a raw path/prompt/diff (the trust boundary holds); it exists so a
 * developer can choose readable file/directory names on their own repos.
 * Nothing here turns the core session/tool/token capture off (that is
 * "uninstall", not a setting).
 */
export interface CaptureSettings {
  /** Edit-tool line counts (ToolCallEvent.linesAdded/linesRemoved), derived
   *  on-machine from edit payloads. Default on — counts only ever ship. */
  lineCounts: boolean;
  /** Git momentum / session-delta / survival capture (commit + file + line
   *  COUNTS from local git). The web toggle mirrors the local SEORAK_MOMENTUM
   *  env override; the env, being the explicit local word, wins. Default on. */
  gitMomentum: boolean;
  /** Per-file salted identity on edit tool.calls (ToolCallEvent.fileId/dirId =
   *  sha256(machine salt + path), same recipe as repoId). Powers file heat,
   *  rework recurrence, and files-in-play WITHOUT any path leaving the machine.
   *  Default on — it ships only 64-hex ids. */
  fileSignals: boolean;
  /** Human-readable labels (basenames ONLY, never full paths) riding next to
   *  fileId/dirId. Default OFF — the explicit opt-in for your own repos where
   *  you want readable names on the file widgets. No effect while
   *  `fileSignals` is off. */
  fileLabels: boolean;
  /** Repo toolchain identity capture (RepoToolchainEvent: packageManager +
   *  framework, derived on-machine from lockfile/manifest presence, enums only).
   *  Default on — it ships only closed enums + a salted id. `false` suppresses the
   *  whole repo.toolchain event. */
  toolchain: boolean;
  /** Human-readable repo basename (`repoLabel`) on the OUTCOME events
   *  (line-survival, and any future per-repo outcome breakdown) and their
   *  WORLD-OPEN read endpoints. Default OFF — the salted `repoId` keys everything;
   *  the basename is a re-identification vector on un-authed reads, so it ships
   *  only when the owner opts in for their own dashboard (mirrors `fileLabels`;
   *  the real fix, auth on reads, lands with tenancy). Never a path. Scope: the
   *  collector gates only `repo.toolchain` and `session.linesurvival` on this
   *  toggle; `session.start`, `git.momentum`, and `session.delta` carry the
   *  basename regardless. */
  repoLabels: boolean;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  lineCounts: true,
  gitMomentum: true,
  fileSignals: true,
  toolchain: true,
  fileLabels: false,
  repoLabels: false,
};

/** Coerce an unknown (stored row, request body, fetched JSON) into a full
 *  CaptureSettings, defaulting any missing/non-boolean field to its
 *  DEFAULT_CAPTURE_SETTINGS value (NOT blanket-on: fileLabels defaults off).
 *  Shared by the worker's read/write paths and the collector's fetch so every
 *  consumer resolves partial/corrupt data identically — fault-soft. */
export function coerceCaptureSettings(raw: unknown): CaptureSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const field = (key: keyof CaptureSettings): boolean =>
    typeof obj[key] === "boolean" ? (obj[key] as boolean) : DEFAULT_CAPTURE_SETTINGS[key];
  return {
    lineCounts: field("lineCounts"),
    gitMomentum: field("gitMomentum"),
    fileSignals: field("fileSignals"),
    toolchain: field("toolchain"),
    fileLabels: field("fileLabels"),
    repoLabels: field("repoLabels"),
  };
}
