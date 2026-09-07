import { useEffect, useState } from "react";

/**
 * Ratios only refresh when a threshold is crossed, and a threshold step on a
 * two-screen section is half a viewport of scrolling. Twenty steps keep the
 * comparison current for tall sections without a scroll listener.
 */
const THRESHOLDS = Array.from({ length: 21 }, (_, step) => step / 20);

/**
 * Tracks which snap section currently owns the viewport.
 *
 * The metric is the share of the *viewport* a section covers, not the share of
 * the section that is visible: sections differ in height — the overview and
 * projects pages run past one screen — and an element ratio would rank a fully
 * visible short section above a tall one filling the whole viewport.
 */
export function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = useState<string>(ids[0] ?? "");
  const key = ids.join("|");

  useEffect(() => {
    const elements = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (elements.length === 0) return;

    const coverage = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const viewport = entry.rootBounds?.height ?? window.innerHeight;
          coverage.set(
            entry.target.id,
            viewport > 0 ? entry.intersectionRect.height / viewport : 0,
          );
        }

        let bestId = "";
        let bestCoverage = 0;
        for (const [id, share] of coverage) {
          if (share > bestCoverage) {
            bestCoverage = share;
            bestId = id;
          }
        }

        if (bestId) setActive(bestId);
      },
      { threshold: THRESHOLDS },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  return active;
}

/**
 * Instant jump, no smooth interpolation: with mandatory snapping a smooth
 * programmatic scroll fights the snap engine and can land between sections.
 * Focus moves too, so keyboard and screen-reader users continue from the
 * section they picked rather than from the nav.
 */
export function scrollToSection(id: string): void {
  const element = document.getElementById(id);
  if (!element) return;

  element.scrollIntoView({ behavior: "instant", block: "start" });
  element.focus({ preventScroll: true });
}
