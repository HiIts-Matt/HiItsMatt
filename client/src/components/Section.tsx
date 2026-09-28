import { type CSSProperties, createContext, type ReactNode, useContext, useState } from "react";

import type { PageDirection, PageRole } from "../hooks/usePager";
import { cx } from "../lib/cx";
import type { SectionId } from "../sections/sections";
import styles from "./Section.module.css";

type SectionProps = {
  id: SectionId;
  label: string;
  /** Which part this page plays in the current handover; drives the animation. */
  role: PageRole;
  /** Which way the handover is going, or null while the stack is at rest. */
  direction: PageDirection | null;
  /** Centres content in the full viewport instead of the nav-clearing column. */
  centered?: boolean;
  /**
   * Painted behind the content and *outside* the page's scroller, so a backdrop
   * can reach past the page's own box — which is what lets the intro's chevron
   * edge show while the page slides away. See IntroBackdrop.
   *
   * A page carrying one therefore has to travel a band deeper to be offscreen,
   * which is what `--page-overshoot` buys.
   */
  backdrop?: ReactNode;
  children: ReactNode;
};

const PageLayerContext = createContext<HTMLElement | null>(null);

/**
 * The page's pinned layer: an element above the scroller, the size of the page,
 * that does not scroll. Portal into it for anything that belongs to the screen
 * rather than to the document — it still moves and dims with the page during a
 * handover, which `position: fixed` inside the scroller would not do reliably
 * (the handover's filter turns the scroller into the containing block).
 *
 * Null until the page has mounted.
 */
export function usePageLayer(): HTMLElement | null {
  return useContext(PageLayerContext);
}

/**
 * One page of the stack: an animated layer wrapping the page's own scroller.
 *
 * Two elements rather than one because the two jobs are mutually exclusive. The
 * scroller has to clip its overflow, and the layer has to *not* clip, so the
 * intro's edge band can paint below the page and be revealed as the page
 * leaves. Only the stage clips, at the viewport.
 *
 * `tabIndex={-1}` is on the scroller: the pager moves focus there on every
 * handover, which is both what keyboard scrolling needs and how a screen reader
 * lands on the page that just arrived.
 */
export function Section({
  id,
  label,
  role,
  direction,
  centered,
  backdrop,
  children,
}: SectionProps) {
  // The page being handed to is live immediately — its links are the ones worth
  // clicking, and focus is already inside it while it grows.
  const active = role === "current" || role === "entering";
  const [layer, setLayer] = useState<HTMLElement | null>(null);

  return (
    <div
      className={styles.page}
      style={backdrop ? ({ "--page-overshoot": "var(--edge-band)" } as CSSProperties) : undefined}
      data-role={role}
      data-direction={direction ?? undefined}
      aria-hidden={active ? undefined : "true"}
      inert={!active}
    >
      {backdrop}

      <PageLayerContext.Provider value={layer}>
        <section
          id={id}
          aria-label={label}
          tabIndex={-1}
          className={cx(styles.scroller, centered && styles.centered)}
        >
          {children}
        </section>
      </PageLayerContext.Provider>

      <div ref={setLayer} className={styles.layer} />
    </div>
  );
}
