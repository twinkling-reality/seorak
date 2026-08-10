// The web RENDER of a project's identity mark. The hash and hue derivation are
// NOT here — they live in @seorak/types (identity.ts), because the phone draws
// the same mark and a project that is two different colors across surfaces is
// not an identity. This file only turns those hues into CSS.
import { projectHues } from '@seorak/types';

/**
 * Solid per-project accent for DATA FILLS (chart segments, bars). Same hash and
 * base hue as projectGradient, so a segment visibly rhymes with the project's
 * squircle chip — but solid: the chip gradient's radial layers land at different
 * relative positions per mark width, so the same project renders as different
 * colors across marks. Identity color must be one color.
 */
export function projectAccent(repoId: string): string {
  const { baseHue } = projectHues(repoId);
  return `hsl(${baseHue}, 40%, 62%)`;
}

export function projectGradient(repoId: string): string {
  const { baseHue, hue2, accent, x1, y1, x2, y2 } = projectHues(repoId);

  return [
    `radial-gradient(circle at ${x1}% ${y1}%, hsla(${baseHue}, 42%, 76%, 0.95) 0%, transparent 55%)`,
    `radial-gradient(circle at ${x2}% ${y2}%, hsla(${accent}, 32%, 70%, 0.6) 0%, transparent 50%)`,
    `linear-gradient(145deg, hsla(${baseHue}, 28%, 84%, 1), hsla(${hue2}, 32%, 80%, 1))`,
  ].join(', ');
}
