export type ProjectedPin = { x: number; y: number; width: number; indexes: number[] };

/** Merge intersecting touch targets at the current zoom; never hide a cheaper offer behind another pin. */
export function clusterPins(points: ProjectedPin[]): ProjectedPin[] {
  const groups = points.map((point) => ({ ...point, indexes: [...point.indexes] }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 10 || Math.abs(a.y - b.y) >= 54) continue;
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
