import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The leaving page's slide off the top edge.
 *
 * The two halves of a handover are ordered rather than simultaneous — the
 * arriving page only grows once the page above it is gone — so the total is
 * close to their sum and both numbers have to stay short enough that
 * navigating never feels like waiting. CSS reads them as custom properties
 * (see Landing), so these constants are the only place the timing is written
 * down.
 */
export const PAGE_SLIDE_MS = 520;

/** The arriving page's growth back to full size, starting when the slide ends. */
export const PAGE_SETTLE_MS = 340;

/**
 * How early the second beat of an upward handover starts.
 *
 * Going down, the big movement comes first: the handover reads as continuous
 * from the frame it begins. Going up it comes second, and a strictly
 * sequential pair leaves a dead moment between the current page dropping back
 * and the previous one arriving over it — the shrink is far too quiet to carry
 * that gap on its own. Starting the slide before the shrink has finished takes
 * the pause out without making either movement shorter. Going down keeps its
 * full sequence, because nothing there is waiting on anything.
 */
export const PAGE_OVERLAP_MS = 160;

/**
 * `current` is the resting page; during a handover the two pages involved are
 * `leaving` and `entering` and every other page is `hidden`. The roles carry
 * the animation — see Section.module.css.
 */
export type PageRole = "current" | "leaving" | "entering" | "hidden";

export type PageDirection = "down" | "up";

/**
 * One handover, end to end: the input lock, and nothing else, is measured in
 * it. Up finishes sooner than down by exactly the overlap and the lock has to
 * follow, because a lock outlasting its own animation is a page that ignores
 * the next gesture for no reason the visitor can see.
 */
const HANDOVER_MS: Record<PageDirection, number> = {
  down: PAGE_SLIDE_MS + PAGE_SETTLE_MS,
  up: PAGE_SLIDE_MS + PAGE_SETTLE_MS - PAGE_OVERLAP_MS,
};

/** A scroller within this many pixels of an end counts as resting on it. */
const EDGE_PX = 2;

/** Below this a wheel event is noise — a trackpad resting under a palm. */
const INTENT_PX = 4;

/** Line-mode wheels report notches, not pixels; this is the usual line height. */
const LINE_PX = 16;

/**
 * A wheel event this long after the previous one starts a new gesture.
 *
 * This one number is the whole intent rule. Momentum after a flick arrives as
 * an unbroken stream, so a flick that happens to run off the end of a page
 * cannot page: the stream has no break in it. Stopping and pushing again does,
 * and that is a deliberate second gesture.
 */
const QUIET_MS = 140;

/** Swipe distance that pages, once the scroller is already at that end. */
const SWIPE_PX = 56;

/** Which way each key pages, once the page itself has nothing left to scroll. */
const STEP_BY_KEY: Record<string, 1 | -1> = {
  ArrowDown: 1,
  PageDown: 1,
  " ": 1,
  Spacebar: 1,
  ArrowUp: -1,
  PageUp: -1,
};

/**
 * Space and the arrows belong to a focused control before they belong to the
 * pager: the repo belt's view toggle is a button, and paging away from it
 * instead of pressing it would be wrong.
 */
const INTERACTIVE = "a, button, input, select, textarea, summary, [contenteditable]";

type Handover = { from: number; to: number; direction: PageDirection };

type Pager = {
  /** The page the visitor is on, or is being handed to. */
  activeId: string;
  /** Non-null only while a handover is running. */
  direction: PageDirection | null;
  roleOf: (id: string) => PageRole;
  goTo: (id: string) => void;
};

/** Whether a scroller has anything left to give in this direction. */
function atEnd(scroller: HTMLElement, direction: number): boolean {
  return direction > 0
    ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE_PX
    : scroller.scrollTop <= EDGE_PX;
}

/**
 * Discrete page navigation for a stack of full-viewport pages.
 *
 * The document does not scroll: each page is its own scroller, and moving
 * between them is a handover this hook drives rather than a scroll position
 * the browser interpolates. That is the price of the transition itself — one
 * page leaving while the next expands underneath it is a sequence of two
 * animations, and a scroll offset can only ever express one number.
 *
 * What it buys back is that a page's own overflow stays completely native.
 * Reading down the overview or the projects list is a plain scroll with plain
 * momentum; the pager only takes the gesture over once the page has nothing
 * left to scroll in that direction, which is the same rule for wheel, keys and
 * touch.
 *
 * Intent, not position, is what triggers a page change, and the three inputs
 * say it the same way: a step needs a gesture that started after the page had
 * already run out. A flick whose momentum happens to land on the bottom of a
 * page is one unbroken wheel stream, a held arrow key is one keypress repeated,
 * and a swipe that began while the page could still scroll is one swipe — none
 * of them page. Without that rule every long scroll would end one page further
 * down than the visitor asked for.
 *
 * A handover itself swallows input until it finishes: one gesture moves one
 * page, never two, which is what `scroll-snap-stop: always` used to promise.
 */
export function usePager(
  ids: readonly string[],
  options: { startId?: string; locked?: boolean; instant?: boolean } = {},
): Pager {
  const { startId, locked = false, instant = false } = options;

  /*
   * Which page the stack opens on. The caller decides, because the URL is not
   * always a page id: a link to a project's own page names the project, and
   * the page behind it is the one this stack has to start on.
   */
  const [index, setIndex] = useState(() => Math.max(0, ids.indexOf(startId ?? "")));
  const [handover, setHandover] = useState<Handover | null>(null);

  /*
   * Input handlers are attached once and read everything they need from here.
   * Rebinding a non-passive wheel listener on every render would be pointless
   * work, and when the last wheel event arrived is not render state: nothing on
   * screen depends on it.
   */
  const live = useRef({ ids, index, locked, instant, lockUntil: 0, wheelAt: 0 });

  useEffect(() => {
    live.current.ids = ids;
    live.current.index = index;
    live.current.locked = locked;
    live.current.instant = instant;
  });

  const go = useCallback((to: number, fromNav: boolean) => {
    const state = live.current;
    const from = state.index;
    if (state.locked || to === from || to < 0 || to >= state.ids.length) return;
    if (Date.now() < state.lockUntil) return;

    const target = document.getElementById(state.ids[to] ?? "");

    /*
     * Stepping off the end of a page is continuous reading, so the page it
     * lands on keeps the scroll position it was left at: going back up returns
     * you to the line you left rather than to the top. A nav jump is a request
     * for the page itself, so that one starts at its beginning.
     */
    if (fromNav && target) target.scrollTop = 0;

    const direction: PageDirection = to > from ? "down" : "up";

    // Written before the render lands so a second gesture inside the same tick
    // cannot read a stale index and skip a page.
    state.index = to;
    state.lockUntil = Date.now() + (state.instant ? 0 : HANDOVER_MS[direction]);

    setIndex(to);
    setHandover({ from, to, direction });
  }, []);

  useEffect(() => {
    if (!handover) return;
    const timer = window.setTimeout(
      () => setHandover(null),
      instant ? 0 : HANDOVER_MS[handover.direction],
    );
    return () => window.clearTimeout(timer);
  }, [handover, instant]);

  const activeId = ids[index] ?? "";

  /*
   * Focus follows the page, after the commit rather than inside `go`: until the
   * render lands the arriving page is still inert, and an inert element cannot
   * take focus at all. It has to move — keyboard scrolling belongs to whichever
   * scroller holds focus, and the page being left goes inert behind it.
   *
   * Not on the first pass: arriving at the site is not a navigation, and
   * stealing focus on load would be. The page last focused is remembered rather
   * than a "first run" flag, so a remount — StrictMode's double effect in dev,
   * for one — cannot mistake the page already on screen for an arrival.
   */
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (focused.current === activeId) return;
    const first = focused.current === null;
    focused.current = activeId;
    if (first) return;
    document.getElementById(activeId)?.focus({ preventScroll: true });
  }, [activeId]);

  useEffect(() => {
    let touch: { y: number; top: boolean; bottom: boolean } | null = null;

    const current = () => {
      const state = live.current;
      return document.getElementById(state.ids[state.index] ?? "");
    };

    const onWheel = (event: WheelEvent) => {
      const state = live.current;
      // Pinch-zoom arrives as a ctrl-wheel and is not navigation.
      if (state.locked || event.ctrlKey) return;

      const now = Date.now();
      const gap = now - state.wheelAt;
      state.wheelAt = now;

      /*
       * Sideways gestures belong to whatever is under the pointer — the repo
       * belt is a horizontal scroller and has to stay browsable. A mouse says
       * sideways by holding shift, which Chrome still reports on `deltaY`, so
       * the modifier is the only tell there; a trackpad says it by travelling
       * further across than down. Counted as part of the stream before being
       * dropped, so the vertical tail of a sideways flick cannot page either.
       */
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      // Line- and page-mode wheels report notches; normalise before comparing.
      const travel = event.deltaMode === 0 ? event.deltaY : event.deltaY * LINE_PX;
      if (Math.abs(travel) < INTENT_PX) return;

      const direction = travel > 0 ? 1 : -1;
      const scroller = current();
      if (!scroller || !atEnd(scroller, direction)) return;

      // The page has nothing left to scroll, so the gesture is the pager's:
      // taking it stops rubber-banding and the browser's overscroll gestures.
      event.preventDefault();

      // Mid-stream: this is the tail of a gesture the page already answered.
      if (gap <= QUIET_MS || now < state.lockUntil) return;

      go(state.index + direction, false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const state = live.current;
      if (state.locked || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      /*
       * A held key is the keyboard's version of momentum: it scrolls the page
       * to its end and stops there. Paging needs a fresh press, which is the
       * same "one gesture, one page" rule the wheel follows.
       */
      if (event.repeat) return;

      const direction = STEP_BY_KEY[event.key];
      if (!direction) return;

      const target = event.target as HTMLElement | null;
      if (event.key === " " || event.key === "Spacebar") {
        if (target?.closest(INTERACTIVE)) return;
      }

      const scroller = current();
      // Still scrollable: native keyboard scrolling owns the key.
      if (!scroller || !atEnd(scroller, direction)) return;
      if (Date.now() < state.lockUntil) return;

      event.preventDefault();
      go(state.index + direction, false);
    };

    /*
     * Touch is decided at the end of the gesture from the state it started in:
     * a swipe that began with the page scrollable scrolls it and nothing else,
     * even if it happens to reach the end on the way. Nothing is prevented —
     * `overscroll-behavior` already keeps the swipe inside the page — so the
     * native scroll stays exactly as responsive as it was.
     */
    const onTouchStart = (event: TouchEvent) => {
      const start = event.touches[0];
      if (event.touches.length !== 1 || !start) {
        touch = null;
        return;
      }

      const scroller = current();
      touch = {
        y: start.clientY,
        top: !scroller || atEnd(scroller, -1),
        bottom: !scroller || atEnd(scroller, 1),
      };
    };

    const onTouchEnd = (event: TouchEvent) => {
      const start = touch;
      touch = null;

      const end = event.changedTouches[0];
      if (!start || !end || live.current.locked) return;

      const travel = start.y - end.clientY;
      if (Math.abs(travel) < SWIPE_PX) return;

      const direction = travel > 0 ? 1 : -1;
      if (direction > 0 ? !start.bottom : !start.top) return;
      if (Date.now() < live.current.lockUntil) return;

      go(live.current.index + direction, false);
    };

    // `passive: false` is what makes preventDefault possible on wheel.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [go]);

  const roleOf = useCallback(
    (id: string): PageRole => {
      const position = ids.indexOf(id);
      if (handover) {
        if (position === handover.to) return "entering";
        if (position === handover.from) return "leaving";
        return "hidden";
      }
      return position === index ? "current" : "hidden";
    },
    [handover, ids, index],
  );

  const goTo = useCallback((id: string) => go(live.current.ids.indexOf(id), true), [go]);

  return { activeId, direction: handover?.direction ?? null, roleOf, goTo };
}
