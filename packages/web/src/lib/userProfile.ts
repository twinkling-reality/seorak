const PROFILE_STORAGE_KEY = 'seorak:user-profile-v1';

export interface UserProfile {
  handle: string;
  color: string;
}

const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

const HANDLE_ADJECTIVES = [
  'calm',
  'clear',
  'steady',
  'quiet',
  'sharp',
  'warm',
  'late',
  'early',
  'open',
  'focused',
] as const;

const HANDLE_NOUNS = [
  'dev',
  'ship',
  'loop',
  'trace',
  'stack',
  'repo',
  'commit',
  'edit',
  'build',
  'session',
] as const;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Random local username — always matches dashboard handle rules. */
export function generateHandle(): string {
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `${pick(HANDLE_ADJECTIVES)}_${pick(HANDLE_NOUNS)}${suffix}`.slice(0, 20);
}

export function readStoredProfile(): UserProfile | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      handle: typeof parsed.handle === 'string' ? parsed.handle : '',
      color: typeof parsed.color === 'string' ? parsed.color : 'lavender',
    };
  } catch {
    return null;
  }
}

export function writeStoredProfile(profile: UserProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage failures should not block the session.
  }
}

/** Restore saved profile or assign a generated handle on first run. */
export function ensureUserProfile(): UserProfile {
  const stored = readStoredProfile();
  const color = stored?.color?.trim() || 'lavender';
  const handle = stored?.handle?.trim();
  if (handle && HANDLE_PATTERN.test(handle)) {
    return { handle, color };
  }
  const profile = { handle: generateHandle(), color };
  writeStoredProfile(profile);
  return profile;
}
