/**
 * Detail-view answer voice — the tone seam.
 *
 * Every dashboard detail answer speaks in one warm, person-to-person voice. That
 * voice ships with a single tone today (`WARM`). A future Settings toggle
 * (voice: warm | plain) plugs a second `VoiceConfig` in through a provider
 * WITHOUT touching any primitive signature or any answer: only the wordings
 * that genuinely vary by tone live in the config. The mechanical primitives
 * (plural, count, number formatting, list joining) are tone-invariant and take
 * no config at all.
 *
 * Product copy rules: docs/reference/voice-and-scope.md.
 */
export type VoiceTone = 'warm' | 'plain';

export interface VoiceConfig {
  tone: VoiceTone;
  /** The one spelled window phrase, e.g. "the last 30 days". Replaces the
   *  house-jargon deictic "this window" board-wide. */
  windowPhrase: (days: number) => string;
  /** The prior comparison window for period-over-period answers, e.g.
   *  "the 30 days before". */
  priorWindowPhrase: (days: number) => string;
}

/** The one tone shipped today. Warm, plain, direct, never fabricated cheer. */
export const WARM: VoiceConfig = {
  tone: 'warm',
  windowPhrase: (days) => `the last ${days} days`,
  priorWindowPhrase: (days) => `the ${days} days before`,
};
