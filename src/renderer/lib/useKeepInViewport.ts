import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Gap kept between a clamped menu and the window edge (matches Radix `collisionPadding`). */
export const VIEWPORT_MARGIN = 8;

/**
 * Keeps an absolutely positioned dropdown (found by `selector` inside `containerRef`)
 * horizontally inside the window while `active`, shifting it with `translate` so its
 * CSS anchor still decides the preferred side. Re-clamps on window resize.
 * Radix popovers do this themselves; this is for the hand-positioned menus.
 * Change `revision` when a different menu element may be rendered under the same selector.
 */
export function useKeepInViewport(
  containerRef: RefObject<HTMLElement | null>,
  selector: string,
  active: boolean,
  revision?: unknown,
): void {
  useLayoutEffect(() => {
    if (!active) return;
    const menu = containerRef.current?.querySelector<HTMLElement>(selector);
    if (!menu) return;
    const place = () => {
      menu.style.translate = '';
      const rect = menu.getBoundingClientRect();
      const limit = window.innerWidth - VIEWPORT_MARGIN;
      let dx = 0;
      if (rect.right > limit) dx = limit - rect.right;
      if (rect.left + dx < VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - rect.left;
      if (dx !== 0) menu.style.translate = `${dx}px 0`;
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      menu.style.translate = '';
    };
  }, [containerRef, selector, active, revision]);
}
