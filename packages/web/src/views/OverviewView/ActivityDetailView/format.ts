// 24-hour clock to "12a / 9a / 12p / 3p" glyph; matches the labels used
// across activity rhythm vizes so the heatmap reads consistently.
export function hourGlyph(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}
