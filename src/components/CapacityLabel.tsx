export function capacityLabel(remaining: number, total: number): string | null {
  if (!Number.isInteger(remaining) || remaining < 1) return null;
  if (remaining === 1) return total > 1 ? 'Poslední místo' : null;
  return `${remaining} ${remaining < 5 ? 'volná místa' : 'volných míst'}`;
}

export function CapacityLabel({ remaining, total }: { remaining: number; total: number }) {
  const label = capacityLabel(remaining, total);
  return label ? <span className="inline-flex rounded-md bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">{label}</span> : null;
}
