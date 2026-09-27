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
  /** px by default; pass an em string when the mark must track prose size. */
  size?: number | string;
  monochrome?: boolean;
  className?: string;
  ariaHidden?: boolean;
}

/**
 * A tool's mark, or NOTHING when we have no mark for it.
 *
 * There used to be a fifth branch below: a brand-filled circle holding the
 * first letter of the label. It was removed on 2026-08-17 because it was
 * standing in for recognition it could not deliver. `toolMeta.ts` pins `icon`
 * to null for every tool (ADR 005 §6 legal review; the B7 re-sync was measured
 * impossible on 2026-08-04), so that branch was what every caller actually got,
 * and it was doing two bad things at once:
 *
 *   - Codex and Claude Code both start with C, so the mark separated the two
 *     agents by HUE ALONE. In a screenshot, at a glance, or to a reader with a
 *     red-green deficiency it identified nothing.
 *   - A brand-colored disc holding a letter the vendor never chose is closer to
 *     a FABRICATED mark than to an absent one, which is the opposite of what
 *     `toolMeta.ts` claims the fallback buys ("an absent mark is absent, not
 *     fabricated").
 *
 * Removing it costs no information: every one of the five call sites renders the
 * tool's NAME immediately beside the mark, so nothing here was the sole
 * identifier of anything. Where the brand hue did work it still does, through
 * `--agent-brand` on the heading text (AgentsView.module.css).
 *
 * The branches below are deliberately kept, and so are the call sites. A
 * backend-resolved `iconUrl` from evaluation metadata is a live future path,
 * and if the legal question is ever answered a pinned local mark lights all of
 * this up again with a one-line change in `toolMeta.ts`. Restoring one still
 * goes through `docs/reference/vendored-assets.json` and
 * `npm run vendored-assets:check`.
 */
export default function ToolIcon({
  tool,
  website,
  iconUrl,
  favicon,
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

  // 5. No mark. Render nothing rather than invent one; the caller's label is
  // what names the tool. See the contract note above this function.
  return null;
}

/**
 * A tool named inside prose. The mark is em-sized so it tracks whatever prose it
 * sits in, and the name never breaks across a wrap.
 *
 * With no mark available this currently renders the name alone, which is the
 * intended reading: an agent's name is a proper noun that identifies itself,
 * unlike a project, whose squircle IS its identity because the repo name has no
 * visual one. Brand color still rides the mark only; the label stays ink so
 * prose legibility never depends on a vendor hue.
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
