import type { CaptureSettings } from '@seorak/types';

/** Settings-facing capture prompts — questions the user answers with the row toggle. */
export const CAPTURE_PROMPTS: Record<keyof CaptureSettings, string> = {
  lineCounts: 'Count lines added and removed on each edit?',
  gitMomentum: 'Track commits, files, and line counts from your local git?',
  fileSignals: 'Send salted file ids on edits so paths never leave your machine?',
  fileLabels: 'Show real file and folder names on your repos, basename only?',
  toolchain: 'Detect package manager and framework from lockfiles on your repos?',
  repoLabels: 'Show repo basenames on outcome breakdowns, not just salted ids?',
};
