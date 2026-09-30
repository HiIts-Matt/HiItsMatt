import { type RefObject, useEffect, useState } from "react";

/**
 * Whether `target` has scrolled into view inside `root` — `threshold` of it
 * showing — since `enabled` last turned true. It latches: scrolling away and
 * back changes nothing, and only `enabled` turning false forgets. Something
 * that plays when it is seen therefore plays once per visit, where it can be
 * watched, and not again on a scroll back.
 */
export function useSeen(
  target: RefObject<Element | null>,
  root: Element | null,
  enabled: boolean,
  threshold: number,
): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = target.current;

    if (!enabled) {
      setSeen(false);
      return;
    }
    if (!node || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { root, threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [target, root, enabled, threshold]);

  return seen;
}
