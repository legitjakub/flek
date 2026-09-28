import { useEffect } from 'react';

/**
 * One owner for `document.title`. The route names the page, a page may name its content (the
 * offer, the venue), the partner console puts the unread count in front and a ringing request
 * flashes over all of it. Each of them used to write the whole title and put back "the previous
 * one" when done, so whichever finished last could restore a title from another page.
 */
export const DEFAULT_TITLE = 'FLEK — volné termíny se slevou';

let route = DEFAULT_TITLE;
let detail: string | null = null;
let badge = 0;
let flash: string | null = null;

/** What the tab says right now; pure, so the rules can be tested. */
export function composeTitle(state: { route: string; detail: string | null; badge: number; flash: string | null }): string {
  if (state.flash) return state.flash;
  const page = state.detail ?? state.route;
  return state.badge > 0 ? `(${state.badge}) ${page}` : page;
}

function apply() {
  if (typeof document === 'undefined') return;
  document.title = composeTitle({ route, detail, badge, flash });
}

/** The name of the page the route shows; set on every navigation. */
export function setRouteTitle(title: string) {
  route = title;
  apply();
}

/**
 * A page's own, more specific name once its content is known; the page clears it (`null`) when it
 * unmounts. React runs the old page's cleanup before the new route's effects, so it never leaks.
 */
export function setDetailTitle(title: string | null) {
  detail = title;
  apply();
}

/** Unread requests in front of the title, in the partner console. */
export function setTitleBadge(count: number) {
  badge = Math.max(0, count);
  apply();
}

/** Replaces the whole title while it is set; `null` restores the composed one. */
export function flashTitle(text: string | null) {
  flash = text;
  apply();
}

/** "Služby — FLEK Partner": the page first, so tabs and history stay tellable apart. */
export function routeTitle(path: string, title: string | null | undefined): string {
  if (title === null) return DEFAULT_TITLE;
  const app = path.startsWith('/partner') ? 'FLEK Partner' : path.startsWith('/admin') ? 'FLEK Admin' : 'FLEK';
  return `${title ?? 'Stránka nenalezena'} — ${app}`;
}

/** Names the page after its content while it is shown, e.g. the offer or the venue. */
export function contentTitle(...parts: (string | null | undefined)[]): string | null {
  const named = parts.map((part) => part?.trim()).filter(Boolean);
  return named.length ? `${named.join(' · ')} — FLEK` : null;
}

/** Holds the page's own title while it is shown, and gives the route's back when it leaves. */
export function useDetailTitle(title: string | null) {
  useEffect(() => {
    setDetailTitle(title);
    return () => setDetailTitle(null);
  }, [title]);
}
