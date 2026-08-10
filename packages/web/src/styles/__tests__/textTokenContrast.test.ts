import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Rgb = readonly [number, number, number];

const css = readFileSync(
  fileURLToPath(new URL('../../app.css', import.meta.url)),
  'utf8',
);

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing ${selector} declarations`);
  return match[1];
}

function rgba(block: string, token: string): { foreground: Rgb; alpha: number } {
  const match = block.match(
    new RegExp(`--${token}:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([\\d.]+)\\s*\\)`),
  );
  if (!match) throw new Error(`Missing rgba token --${token}`);
  return {
    foreground: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4]),
  };
}

function hex(block: string, token: string): Rgb {
  const match = block.match(new RegExp(`--${token}:\\s*#([0-9a-f]{6})`, 'i'));
  if (!match) throw new Error(`Missing hex token --${token}`);
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

function composite(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  return foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha),
  ) as unknown as Rgb;
}

function relativeLuminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: Rgb, b: Rgb): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('text token contrast', () => {
  it.each([
    ['light', ':root'],
    ['dark', "[data-theme='dark']"],
  ] as const)('%s --soft text clears WCAG AA against the page', (_theme, selector) => {
    const block = declarations(selector);
    const background = hex(block, 'page-bg');
    const soft = rgba(block, 'soft');
    const rendered = composite(soft.foreground, soft.alpha, background);

    expect(contrast(rendered, background)).toBeGreaterThanOrEqual(4.5);
  });
});
