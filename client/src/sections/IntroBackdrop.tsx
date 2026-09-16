import { Suspense, lazy, useEffect, useRef } from "react";

import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { edgeOutline } from "./edge";
import styles from "./IntroBackdrop.module.css";

// The shader backdrop drags in three.js; lazily importing it keeps that weight
// out of the entry chunk so the headline paints first.
const GradientBackdrop = lazy(() => import("./GradientBackdrop"));

const MASK_ID = "intro-edge-mask";

type IntroBackdropProps = {
  /** Fired once the shader is painting stable frames; drives the loader curtain. */
  onReady: () => void;
};

/**
 * The intro's gradient and the chevron edge it ends on.
 *
 * This is handed to the page as its backdrop rather than nested in its content
 * because the edge has to paint *outside* the page's screen, and the page's
 * scroller clips its own overflow. The layer is one screen plus a band, pinned
 * to the top of the intro's page layer, so it travels with the page exactly as
 * the old in-section backdrop scrolled away with the section.
 *
 * The band is the whole trick. The canvas is sized to cover screen + band, so
 * there is real, still-animating gradient below the intro's screen; an ink
 * rectangle then hides that band, and the chevron is a hole cut in the ink.
 * What reaches below the intro is therefore not a copy or a second shader — it
 * is the same canvas, the same frame, seen through a fixed outline.
 *
 * Nothing here is driven by the transition. The edge is simply where the
 * background stops; the handover is the page sliding up and taking it along,
 * which uncovers the band the stage was clipping. So the path is written once
 * per resize and never touched again — no work at all on an animation frame.
 */
export function IntroBackdrop({ onReady }: IntroBackdropProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const band = useRef<SVGSVGElement>(null);
  const outline = useRef<SVGPathElement>(null);

  useEffect(() => {
    const element = band.current;
    if (!element) return;

    // The band's height is a clamp on viewport height and its width is the
    // layer's, so the pixel geometry the outline needs is only knowable from
    // the box itself.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || !outline.current) return;
      const { width, height } = entry.contentRect;
      outline.current.setAttribute("d", edgeOutline(width, height));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.layer} aria-hidden="true">
      <Suspense fallback={<div className={styles.fallback} />}>
        <GradientBackdrop animate={!prefersReducedMotion} onReady={onReady} />
      </Suspense>

      {/*
        With motion reduced the band collapses to zero height (see the layer's
        media query), so there is nothing to cover and nothing to animate.
      */}
      {!prefersReducedMotion && (
        <svg className={styles.band} ref={band} focusable="false" aria-hidden="true">
          <defs>
            <mask id={MASK_ID} maskUnits="userSpaceOnUse">
              {/* White keeps the ink; the chevron is painted black to punch it
                  back out. */}
              <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
              <path ref={outline} fill="#000" />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="var(--c-ink)" mask={`url(#${MASK_ID})`} />
        </svg>
      )}
    </div>
  );
}
