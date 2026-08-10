import clsx from 'clsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import styles from './ToolIcon.module.css';

function faviconUrl(website: string | undefined): string | null {
  if (!website) return null;
  try {
    const { hostname } = new URL(website);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
  } catch {
    return null;
  }
}

interface Props {
  tool: string;
  website?: string;
  /** Backend-resolved icon URL from evaluation metadata (icon_url field). */
  iconUrl?: string;
  /** Favicon URL from evaluation metadata. */
  favicon?: string;
  /** Brand color extracted from the tool's icon (metadata.brand_color). */
  brandColor?: string;
  /** px by default; pass an em string when the mark must track prose size. */
  size?: number | string;
  monochrome?: boolean;
  className?: string;
  ariaHidden?: boolean;
}

export default function ToolIcon({
  tool,
  website,
  iconUrl,
  favicon,
  brandColor,
  size = 18,
  monochrome = false,
  className = '',
  ariaHidden = true,
}: Props) {
  const meta = getToolMeta(tool);
  const classes = clsx(styles.icon, monochrome && styles.monochrome, className);

  // 1. Local SVG (highest quality - hand-curated, 13 tools)
  if (meta.icon) {
    if (monochrome) {
      return (
        <span className={classes} style={{ width: size, height: size }} aria-hidden={ariaHidden}>
          <img src={meta.icon} alt="" />
        </span>
      );
    }

    return (
      <span
        className={classes}
        style={{
          width: size,
          height: size,
          backgroundColor: meta.color,
          WebkitMaskImage: `url(${meta.icon})`,
          maskImage: `url(${meta.icon})`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
        aria-hidden={ariaHidden}
      />
    );
  }

  // 2. Backend-resolved icon (cached in KV, resolved at evaluation time)
  if (iconUrl) {
    return (
      <span className={classes} style={{ width: size, height: size }} aria-hidden={ariaHidden}>
        <img src={iconUrl} alt="" className={styles.favicon} />
      </span>
    );
  }

  // 3. Favicon from metadata
  if (favicon) {
    return (
      <span className={classes} style={{ width: size, height: size }} aria-hidden={ariaHidden}>
        <img src={favicon} alt="" className={styles.favicon} />
      </span>
    );
  }

  // 4. Google favicon service - fallback for tools with a website but no cached icon
  const gFavicon = faviconUrl(website);
  if (gFavicon) {
    return (
      <span className={classes} style={{ width: size, height: size }} aria-hidden={ariaHidden}>
        <img src={gFavicon} alt="" className={styles.favicon} />
      </span>
    );
  }

  // 5. Letter fallback - use brand color from metadata if available, else toolMeta color
  const fallbackColor = brandColor || meta.color;
  return (
    <span
      className={clsx(classes, styles.fallback)}
      style={{ width: size, height: size, backgroundColor: fallbackColor }}
      aria-hidden={ariaHidden}
    >
      {meta.label.slice(0, 1)}
    </span>
  );
}

/**
 * The tool identity mark set inline in answer prose — the agent-side mirror of
 * ProjectInline. The mark is em-sized so it tracks whatever prose it sits in,
 * and the pair never breaks across a wrap. Brand color rides the mark only;
 * the label stays ink so prose legibility never depends on a brand hue.
 */
export function ToolInline({ tool, className }: { tool: string; className?: string }) {
  const meta = getToolMeta(tool);
  return (
    <span className={clsx(styles.inline, className)}>
      <ToolIcon tool={tool} size="0.85em" className={styles.inlineIcon} />
      <span className={styles.inlineLabel}>{meta.label}</span>
    </span>
  );
}
