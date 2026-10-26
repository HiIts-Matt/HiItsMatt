import { useCallback, useEffect, useRef, useState } from "react";

/** Below this the curtain feels like a flash rather than a transition. */
const MIN_CURTAIN_MS = 650;
/** Hard release: WebGL can be unavailable or the chunk can fail to load. */
const MAX_CURTAIN_MS = 5000;
/** Backstop in case `transitionend` never arrives (background tab, no compositor). */
const SLIDE_TIMEOUT_MS = 1200;

export type CurtainPhase = "loading" | "revealing" | "ready";

/**
 * The loader curtain over the intro: held until the shader paints (or the hard
 * release fires), then slid away. `skip` starts it already lifted, for a visit
 * that lands somewhere the intro is not on screen.
 *
 * `onBackdropReady` goes to IntroBackdrop, `onExited` to the Loader.
 */
export function useCurtain({ skip, reducedMotion }: { skip: boolean; reducedMotion: boolean }) {
  const [phase, setPhase] = useState<CurtainPhase>(() => (skip ? "ready" : "loading"));
  const mountedAt = useRef(Date.now());

  const beginReveal = useCallback(() => {
    setPhase((current) => {
      if (current !== "loading") return current;
      // With motion reduced the slide collapses to nothing, so there is no
      // transition to wait on — drop the curtain outright.
      return reducedMotion ? "ready" : "revealing";
    });
  }, [reducedMotion]);

  const onBackdropReady = useCallback(() => {
    const remaining = MIN_CURTAIN_MS - (Date.now() - mountedAt.current);
    if (remaining <= 0) {
      beginReveal();
      return;
    }
    window.setTimeout(beginReveal, remaining);
  }, [beginReveal]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(beginReveal, MAX_CURTAIN_MS);
    return () => window.clearTimeout(timer);
  }, [phase, beginReveal]);

  useEffect(() => {
    if (phase !== "revealing") return;
    const timer = window.setTimeout(() => setPhase("ready"), SLIDE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const onExited = useCallback(() => setPhase("ready"), []);

  return { phase, onBackdropReady, onExited };
}
