import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  TIME_INTENTS,
  intentOf,
  wideningSteps,
  windowFor,
  type Filters,
} from '../src/features/discovery/filters';
import { cutoffFor } from '../src/features/merchant/CreateOfferSheet';

const NOW = '2026-09-10T09:00:00.000Z';
const filters = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

describe('rail', () => {
  it('leads with Vše and still opens on Dnes', () => {
    expect(TIME_INTENTS[0].key).toBe('week');
    expect(DEFAULT_FILTERS.when).toBe('today');
    expect(intentOf(DEFAULT_FILTERS)).toBe('today');
  });

  it('lights a pill for every combination the sheet can produce', () => {
    // Thirteen of the twenty reachable pairs matched no pill and the rail went dark.
    for (const when of ['now', 'soon', 'today', 'tomorrow', 'week'] as const) {
      for (const daypart of [null, 'morning', 'afternoon', 'evening'] as const) {
        expect(intentOf(filters({ when, daypart })), `${when}/${daypart}`).not.toBeNull();
      }
    }
  });
});

describe('cold-start ladder', () => {
  // 09:00 and 21:00 Prague: late in the evening "the next four hours" runs past midnight
  // while "today" ends at it, so the ladder cannot simply assume today is wider.
  it.each(['2026-09-10T07:00:00.000Z', '2026-09-10T19:00:00.000Z'])('never widens a search into a window that excludes what was asked for (%s)', (NOW) => {
    for (const when of ['now', 'soon', 'today', 'tomorrow', 'week'] as const) {
      const asked = windowFor(when, NOW);
      for (const step of wideningSteps(filters({ when }), NOW)) {
        const got = windowFor(step.when, NOW);
        // Every rung has to contain the one below it. "Dnes" widening to "Zítra" did not:
        // it replaced today's results with tomorrow's.
        expect(Date.parse(got.from!), `${when} → ${step.when}`).toBeLessThanOrEqual(Date.parse(asked.from!));
        expect(Date.parse(got.until!), `${when} → ${step.when}`).toBeGreaterThanOrEqual(Date.parse(asked.until!));
      }
    }
  });

  it('never narrows the radius below the one that was chosen', () => {
    for (const radius_m of [1000, 5000, 25000]) {
      for (const step of wideningSteps(filters({ radius_m }), NOW)) {
        expect(step.radius_m).toBeGreaterThanOrEqual(radius_m);
      }
    }
  });

  it('leaves the exact filter unlabelled and labels every widening', () => {
    const steps = wideningSteps(filters(), NOW);
    expect(steps[0].note).toBeNull();
    expect(steps.slice(1).every((s) => typeof s.note === 'string')).toBe(true);
  });
});

describe('cutoffFor', () => {
  const now = Date.parse(NOW);
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

  it('sits fifteen minutes before a start with room to spare', () => {
    expect(cutoffFor(at(120), NOW)).toBe(at(105));
  });

  it('never lands inside the five-minute floor publish_offer enforces', () => {
    // A slot twenty minutes out used to derive a cutoff the server then rejected.
    const cutoff = Date.parse(cutoffFor(at(20), NOW));
    expect(cutoff).toBeGreaterThan(now + 5 * 60_000);
    expect(cutoff).toBeLessThanOrEqual(now + 20 * 60_000);
  });

  it('never lands after the start itself', () => {
    for (const minutes of [7, 10, 16, 45]) {
      expect(Date.parse(cutoffFor(at(minutes), NOW))).toBeLessThanOrEqual(now + minutes * 60_000);
    }
  });
});
