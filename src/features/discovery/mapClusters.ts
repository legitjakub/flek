export type ProjectedPin = { x: number; y: number; width: number; indexes: number[] };
export type PositionedPin = ProjectedPin & { offsetX: number; offsetY: number };

/*
 * Rendered marker heights, centred on the map point (styles.css). A pin is the 48 px photo
 * over the 24 px price ticket pulled up 8 px. A cluster is the 46 px count, its 5 + 2 px ring
 * on both sides and the ticket 2 px below: 46 + 14 + 2 + 24. The old flat 54 px box was
 * shorter than either, so a pin's ticket landed on the ring of the cluster under it.
 */
export const PIN_HEIGHT = 64;
/** Air between two markers, so a shadow or the selected pin's scale-up does not touch the next one. */
const GAP = 8;

const heightOf = (_pin?: ProjectedPin) => PIN_HEIGHT;

/** Whether two markers drawn at these points would touch. */
export function markersCollide(a: ProjectedPin, b: ProjectedPin): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 10 && Math.abs(a.y - b.y) < (heightOf(a) + heightOf(b)) / 2 + GAP;
}

/**
 * Keep every venue visible. Nearby places are nudged around their real screen position instead
 * of being replaced by a count that makes the customer zoom before seeing a single offer.
 *
 * Candidate order is fixed, so the same viewport always produces the same layout. Four compact
 * rings handle ordinary city-centre density without moving a pin so far that it appears to belong
 * to another neighbourhood. If an exceptionally dense view has no free candidate, the position
 * with the least overlap wins; the pin still exists and remains keyboard reachable.
 */
export function spreadPins(points: ProjectedPin[]): PositionedPin[] {
  const placed: PositionedPin[] = [];
  const candidates: Array<[number, number]> = [[0, 0]];
  for (const radius of [28, 48, 68, 88]) {
    const steps = radius < 48 ? 8 : 12;
    for (let step = 0; step < steps; step += 1) {
      const angle = -Math.PI / 2 + step * Math.PI * 2 / steps;
      candidates.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
    }
  }

  points.forEach((point) => {
    let best: PositionedPin | null = null;
    let bestOverlap = Number.POSITIVE_INFINITY;
    for (const [offsetX, offsetY] of candidates) {
      const candidate: PositionedPin = {
        ...point,
        indexes: [...point.indexes],
        x: point.x + offsetX,
        y: point.y + offsetY,
        offsetX,
        offsetY,
      };
      const overlap = placed.reduce((sum, other) => sum + (markersCollide(candidate, other) ? 1 : 0), 0);
      if (overlap === 0) {
        best = candidate;
        break;
      }
      if (overlap < bestOverlap) {
        best = candidate;
        bestOverlap = overlap;
      }
    }
    placed.push(best ?? { ...point, indexes: [...point.indexes], offsetX: 0, offsetY: 0 });
  });
  return placed;
}
