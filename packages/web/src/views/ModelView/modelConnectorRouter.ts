/**
 * Text-avoiding annotation connector paths — from CleanerChat connectorRouter.ts
 * (Technology/cleanerchat).
 */

export interface ConnectorInput {
  termX: number;
  termY: number;
  badgeX: number;
  badgeY: number;
  textLeft: number;
  textRight: number;
  lineHeight: number;
  side: 'left' | 'right';
}

const CORNER_R = 8;
const MIN_R = 2;

function n(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}

function directCurve(
  termX: number,
  termY: number,
  badgeX: number,
  badgeY: number,
  isRight: boolean,
  textEdgeX: number,
): string {
  const dy = badgeY - termY;
  const dx = badgeX - termX;
  const cp1Y = termY + dy * 0.4;
  const cp2X = isRight ? badgeX - Math.abs(dx) * 0.3 : badgeX + Math.abs(dx) * 0.3;
  return `M${n(termX)},${n(termY)} C${n(termX)},${n(cp1Y)} ${n(cp2X)},${n(badgeY)} ${n(badgeX)},${n(badgeY)}`;
}

export function computeConnectorPath(input: ConnectorInput): string {
  const { termX, termY, badgeX, badgeY, textLeft, textRight, lineHeight, side } = input;
  const isRight = side === 'right';
  const textEdgeX = isRight ? textRight : textLeft;

  const horizDist = isRight ? textEdgeX - termX : termX - textEdgeX;
  if (horizDist <= 4) {
    return directCurve(termX, termY, badgeX, badgeY, isRight, textEdgeX);
  }

  const gapBelow = termY + lineHeight / 2;
  const gapAbove = termY - lineHeight / 2;
  const dy = badgeY - termY;
  let gapY: number;
  if (dy > lineHeight * 0.25) {
    gapY = gapBelow;
  } else if (dy < -lineHeight * 0.25) {
    gapY = gapAbove;
  } else {
    // Same row as the card: never draw through the rest of the line (direct
    // curve). Prefer the gap ABOVE so the run doesn't sit on the next line
    // and read as a different term.
    gapY = gapAbove;
  }

  const vertDist = Math.abs(gapY - termY);
  const r = Math.max(MIN_R, Math.min(CORNER_R, vertDist * 0.45, horizDist * 0.45));

  const dh = isRight ? 1 : -1;
  const dv = gapY > termY ? 1 : -1;

  const marginWidth = Math.abs(badgeX - textEdgeX);
  const p: string[] = [];

  p.push(`M${n(termX)},${n(termY)}`);
  p.push(`L${n(termX)},${n(gapY - dv * r)}`);
  p.push(`Q${n(termX)},${n(gapY)} ${n(termX + dh * r)},${n(gapY)}`);
  p.push(`L${n(textEdgeX)},${n(gapY)}`);

  const cp1X = textEdgeX + dh * marginWidth * 0.4;
  const cp2X = isRight ? badgeX - marginWidth * 0.4 : badgeX + marginWidth * 0.4;
  p.push(`C${n(cp1X)},${n(gapY)} ${n(cp2X)},${n(badgeY)} ${n(badgeX)},${n(badgeY)}`);

  return p.join(' ');
}
