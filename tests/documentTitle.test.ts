import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLE, composeTitle, contentTitle, routeTitle } from '../src/lib/documentTitle';

describe('document title', () => {
  it('names the page first and the app after it', () => {
    expect(routeTitle('/rezervace', 'Rezervace')).toBe('Rezervace — FLEK');
    expect(routeTitle('/partner/sluzby', 'Služby')).toBe('Služby — FLEK Partner');
    expect(routeTitle('/admin/nahlaseni', 'Bezpečnost obsahu')).toBe('Bezpečnost obsahu — FLEK Admin');
    expect(routeTitle('/', null)).toBe(DEFAULT_TITLE);
    expect(routeTitle('/neexistuje', undefined)).toBe('Stránka nenalezena — FLEK');
  });

  it('prefers what the page shows, keeps the unread count in front and lets a ringing request flash over it', () => {
    const base = { route: 'Přehled — FLEK Partner', detail: null, badge: 0, flash: null };
    expect(composeTitle(base)).toBe('Přehled — FLEK Partner');
    expect(composeTitle({ ...base, badge: 2 })).toBe('(2) Přehled — FLEK Partner');
    expect(composeTitle({ ...base, badge: 2, flash: '🔔 Nová žádost o rezervaci' })).toBe('🔔 Nová žádost o rezervaci');
    expect(composeTitle({ ...base, route: 'FLEK — FLEK', detail: 'Masáž zad · Studio — FLEK' })).toBe('Masáž zad · Studio — FLEK');
  });

  it('builds a content title only from what is known', () => {
    expect(contentTitle('Masáž zad', 'Studio U Parku')).toBe('Masáž zad · Studio U Parku — FLEK');
    expect(contentTitle('Studio U Parku')).toBe('Studio U Parku — FLEK');
    expect(contentTitle(undefined, null, '  ')).toBeNull();
  });
});
