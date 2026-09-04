import { useEffect, useState } from "react";

/**
 * Tracks which snap section currently owns the viewport.
 *
 * Ratios are compared across all observed sections rather than trusting the
 * first `isIntersecting` callback: mid-scroll two sections are always partly
 * visible, and picking the larger one is what keeps the nav from flickering.
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

    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.intersectionRatio);
        }

        let bestId = "";
        let bestRatio = 0;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }

        if (bestId) setActive(bestId);
      },
      // A dense threshold list is what makes the comparison meaningful; with a
      // single threshold the ratios only update when a section crosses it.
      { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
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
