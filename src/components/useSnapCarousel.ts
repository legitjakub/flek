import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Native horizontal scrolling with a small amount of state for controls and pagination.
 * CSS owns the gesture; this hook only finds the nearest snapped item and moves controls
 * to an exact item. That keeps touch scrolling responsive while making every carousel in
 * the app behave the same way.
 */
export function useSnapCarousel<T extends HTMLElement>(
  count: number,
  resetKey?: string,
  onIndexChange?: (index: number) => void,
) {
  const viewportRef = useRef<T>(null);
  const frame = useRef<number | null>(null);
  const changeHandler = useRef(onIndexChange);
  /*
   * Where a button press is taking the carousel, while the smooth scroll is still on its
   * way. Without it the scroll handler reported the item the viewport happened to be
   * nearest to mid-flight — the one being left — so a single press on "Dále" set step 2,
   * dropped back to step 1 at 40 ms and returned to step 2 at 123 ms. Every control bound
   * to the index jumped three times, and the footer button changed width twice.
   */
  const target = useRef<number | null>(null);
  const settle = useRef<number | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    changeHandler.current = onIndexChange;
  }, [onIndexChange]);

  const goTo = useCallback((requested: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    if (!viewport || count === 0) return;
    const next = Math.max(0, Math.min(requested, count - 1));
    const items = viewport.querySelectorAll<HTMLElement>('[data-snap-item]');
    const item = items[next];
    if (!item) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.current = next;
    // A safety net for browsers without `scrollend`, and for a swipe that interrupts the
    // animation: the lock never outlives a smooth scroll by much.
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => { target.current = null; }, 700);
    viewport.scrollTo({
      left: item.offsetLeft - viewport.offsetLeft,
      behavior: reduced ? 'auto' : behavior,
    });
    setIndex(next);
    changeHandler.current?.(next);
  }, [count]);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => {
      const items = [...viewport.querySelectorAll<HTMLElement>('[data-snap-item]')];
      if (!items.length) return;
      const left = viewport.scrollLeft + viewport.offsetLeft;
      let nearest = 0;
      let distance = Number.POSITIVE_INFINITY;
      items.forEach((item, itemIndex) => {
        const current = Math.abs(item.offsetLeft - left);
        if (current < distance) {
          nearest = itemIndex;
          distance = current;
        }
      });
      // Mid-flight towards a pressed item, the only nearest item worth reporting is the
      // destination itself.
      if (target.current !== null) {
        if (nearest !== target.current) return;
        target.current = null;
      }
      setIndex((current) => {
        if (current !== nearest) changeHandler.current?.(nearest);
        return nearest;
      });
    });
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      goTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      goTo(count - 1);
    }
  }, [count, goTo, index]);

  useEffect(() => {
    setIndex(0);
    const id = window.requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [resetKey]);

  useEffect(() => () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    if (settle.current !== null) window.clearTimeout(settle.current);
  }, []);

  return {
    viewportRef,
    index: Math.min(index, Math.max(0, count - 1)),
    goTo,
    onScroll,
    onKeyDown,
    canGoBack: index > 0,
    canGoForward: index < count - 1,
  };
}
