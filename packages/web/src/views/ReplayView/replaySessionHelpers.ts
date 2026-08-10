import type { SessionSummary } from '../../lib/apiSchemas.js';

export function repoIdFor(session: SessionSummary | null, fallback: string): string {
  return session?.repoId || session?.project || fallback;
}

export function projectFor(session: SessionSummary | null, fallback: string): string {
  return session?.project || repoIdFor(session, fallback);
}
