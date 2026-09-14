export type ProjectedPin = { x: number; y: number; width: number; indexes: number[] };

/*
 * Rendered marker heights, centred on the map point (styles.css). A pin is the 48 px photo
 * over the 24 px price ticket pulled up 8 px. A cluster is the 46 px count, its 5 + 2 px ring
 * on both sides and the ticket 2 px below: 46 + 14 + 2 + 24. The old flat 54 px box was
 * shorter than either, so a pin's ticket landed on the ring of the cluster under it.
 */
export const PIN_HEIGHT = 64;
export const CLUSTER_HEIGHT = 86;
/** Air between two markers, so a shadow or the selected pin's scale-up does not touch the next one. */
const GAP = 8;

const heightOf = (pin: ProjectedPin) => (pin.indexes.length > 1 ? CLUSTER_HEIGHT : PIN_HEIGHT);

/** Whether two markers drawn at these points would touch. */
export function markersCollide(a: ProjectedPin, b: ProjectedPin): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 10 && Math.abs(a.y - b.y) < (heightOf(a) + heightOf(b)) / 2 + GAP;
}

/** Merge intersecting touch targets at the current zoom; never hide a cheaper offer behind another pin. */
export function clusterPins(points: ProjectedPin[]): ProjectedPin[] {
  const groups = points.map((point) => ({ ...point, indexes: [...point.indexes] }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (!markersCollide(a, b)) continue;
        const total = a.indexes.length + b.indexes.length;
        groups[i] = {
          x: (a.x * a.indexes.length + b.x * b.indexes.length) / total,
          y: (a.y * a.indexes.length + b.y * b.indexes.length) / total,
          width: Math.max(148, a.width, b.width),
          indexes: [...a.indexes, ...b.indexes],
        };
        groups.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return groups;
}
