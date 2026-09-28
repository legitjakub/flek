import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  PRIMARY_TIME_INTENTS, TIME_OPTIONS, activeChips, activeCount, applyIntent, clearAdvancedFilters,
  intentOf,
  wideningSteps,
  windowFor,
  type Filters,
} from '../src/features/discovery/filters';
import { cutoffFor } from '../src/features/merchant/CreateOfferSheet';
import { readDiscoveryState } from '../src/features/discovery/useDiscoveryState';

const NOW = '2026-09-10T09:00:00.000Z';
const filters = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

describe('rail and advanced time filters', () => {
  it('preserves advanced choices in the shared feed/map URL state', () => {
    for (const path of ['/', '/mapa']) {
      const url = new URL(`${path}?when=soon&daypart=afternoon&radius_m=1000&sort=cheapest`, 'https://www.app-flek.eu');
      const { filters: parsed } = readDiscoveryState(url.searchParams);
      expect(parsed).toMatchObject({ when: 'soon', daypart: 'afternoon', radius_m: 1000, sort: 'cheapest' });
      expect(intentOf(parsed)).toBeNull();
      expect(activeCount(parsed)).toBe(4);
    }
  });
  it('has exactly four primary choices and still opens on Dnes', () => {
    expect(PRIMARY_TIME_INTENTS.map((i) => i.label)).toEqual(['Vše', 'Brzy', 'Dnes', 'Zítra']);
    expect(intentOf(DEFAULT_FILTERS)).toBe('today');
  });

  it('keeps Do 2 h in the sheet without falsely lighting Brzy', () => {
    expect(TIME_OPTIONS.find((i) => i.value === 'soon')?.label).toBe('Do 2 h');
    const advanced = filters({ when: 'soon' });
    expect(intentOf(advanced)).toBeNull();
    expect(intentOf(advanced, 'today')).toBeNull();
    expect(intentOf(filters({ when: 'now' }), 'today')).toBe('today');
    expect(windowFor('soon', NOW).until).not.toBe(windowFor('now', NOW).until);
    expect(activeCount(advanced)).toBe(1);
    const chip = activeChips(advanced, (s) => s)[0];
    expect(chip.label).toBe('Do 2 h');
    expect(chip.clear(advanced).when).toBe(DEFAULT_FILTERS.when);
  });

  it.each(['morning', 'afternoon', 'evening'] as const)('keeps %s visible alongside any window', (daypart) => {
    const advanced = filters({ when: 'soon', daypart });
    const chips = activeChips(advanced, (s) => s);
    expect(chips.map((c) => c.key)).toEqual(['when', 'daypart']);
    expect(activeCount(advanced)).toBe(2);
    expect(chips[1].clear(advanced)).toMatchObject({ when: 'soon', daypart: null });
    expect(intentOf(filters({ daypart }))).toBe('today');
    expect(applyIntent(advanced, 'tomorrow')).toMatchObject({ when: 'tomorrow', daypart: null });
  });

  it('clears advanced filters and keeps the badge equal to removable chips', () => {
    const advanced = filters({ when: 'soon', daypart: 'afternoon', category: 'sport', radius_m: 1000, min_discount_pct: 20, max_price_cents: 30000, sort: 'cheapest' });
    expect(activeCount(advanced)).toBe(activeChips(advanced, (s) => s).length);
    expect(clearAdvancedFilters(advanced)).toEqual(DEFAULT_FILTERS);
    expect(clearAdvancedFilters(filters({ when: 'tomorrow', daypart: 'evening' }))).toEqual(filters({ when: 'tomorrow' }));
    expect(activeCount(DEFAULT_FILTERS)).toBe(0);
  });
});

describe('service search', () => {
  it('shares the query between feed and map, including Czech text', () => {
    for (const path of ['/', '/mapa']) {
      const url = new URL(`${path}?query=%20Masáž%20&when=now`, 'https://www.app-flek.eu');
      const parsed = readDiscoveryState(url.searchParams).filters;
      expect(parsed.query).toBe('Masáž');
      expect(applyIntent(parsed, 'tomorrow').query).toBe('Masáž');
      expect(TIME_OPTIONS.find((i) => i.value === 'now')?.label).toBe('Brzy');
      expect(windowFor('now', NOW).until).toBe('2026-09-10T13:00:00.000Z');
    }
  });

  it('keeps search visible and removable without resetting other choices', () => {
    const searched = filters({ query: 'jóga', daypart: 'evening' });
    const chips = activeChips(searched, (s) => s);
    expect(activeCount(searched)).toBe(chips.length);
    expect(chips.find((chip) => chip.key === 'query')?.clear(searched)).toEqual(filters({ daypart: 'evening' }));
    expect(clearAdvancedFilters(searched)).toEqual(DEFAULT_FILTERS);
  });

  it('bounds a query restored from the URL and treats whitespace as empty', () => {
    expect(readDiscoveryState(new URLSearchParams({ query: 'x'.repeat(100) })).filters.query).toHaveLength(80);
    expect(readDiscoveryState(new URLSearchParams({ query: '   ' })).filters.query).toBe('');
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
