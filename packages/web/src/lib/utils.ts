export interface ColorEntry {
  name: string;
  hex: string;
}

export function formatDuration(m: number | null | undefined): string {
  if (m == null || typeof m !== 'number' || m <= 0) return '<1m';
  if (m >= 60) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${Math.round(m)}m`;
}

/**
 * Spelled-out duration for answer prose: "18 minutes", "2 hours 40 minutes",
 * "1 hour", "less than a minute". The compact formatDuration ("18m") stays the
 * right form for dense table cells; a person-talking answer reads it out fully.
 */
export function formatDurationLong(m: number | null | undefined): string {
  if (m == null || typeof m !== 'number' || m <= 0) return 'less than a minute';
  const mins = Math.round(m);
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  const hourPart = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  if (rem === 0) return hourPart;
  return `${hourPart} ${rem} ${rem === 1 ? 'minute' : 'minutes'}`;
}

export const COLOR_PALETTE: ColorEntry[] = [
  { name: 'red', hex: '#ff3b30' },
  { name: 'cyan', hex: '#32ced6' },
  { name: 'yellow', hex: '#ffc600' },
  { name: 'green', hex: '#28cd41' },
  { name: 'magenta', hex: '#c44dff' },
  { name: 'blue', hex: '#0a84ff' },
  { name: 'orange', hex: '#ff9f0a' },
  { name: 'lime', hex: '#30d158' },
  { name: 'pink', hex: '#ff375f' },
  { name: 'sky', hex: '#64d2ff' },
  { name: 'lavender', hex: '#7d7aff' },
  { name: 'white', hex: '#98989d' },
];

export function getColorHex(name: string): string | undefined {
  return COLOR_PALETTE.find((c) => c.name === name)?.hex;
}
