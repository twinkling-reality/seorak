/** Voice primitives — date helpers for answer prose. */

const DAY_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** YYYY-MM-DD -> "Jun 14" (UTC), for direct day labels in answer sentences. */
export function formatDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAY_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** YYYY-MM-DD -> MM-DD, mono-friendly (strip axis / dense cells). */
export function formatStripDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(5) : iso;
}

/** Relative "time since" label: "just now", "3m ago", "2h ago", "5d ago".
 *  Honest "--" on an unparseable timestamp. */
export function formatRelative(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '--';
  const secs = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
