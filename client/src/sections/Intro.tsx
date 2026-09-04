import { Suspense, lazy } from "react";
import type { CSSProperties } from "react";

import { scrollToSection } from "../hooks/useActiveSection";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { cx } from "../lib/cx";
import styles from "./Intro.module.css";

// The shader backdrop drags in three.js; lazily importing it keeps that weight
// out of the entry chunk so the headline paints first.
const GradientBackdrop = lazy(() => import("./GradientBackdrop"));

/**
 * Hard line breaks, one array per line. The reveal beat is a running index
 * across all lines, so the stagger continues past the break instead of
 * restarting on each row.
 */
let beat = 0;
const LINES = [["Hi,"], ["It’s", "Matt"]].map((line) =>
  line.map((text) => ({ text, beat: beat++ })),
);
const HEADING = LINES.flat()
  .map((word) => word.text)
  .join(" ");

type IntroProps = {
  /** Held false until the loader is offscreen so the stagger is never missed. */
  revealed: boolean;
  onBackdropReady: () => void;
};

export function Intro({ revealed, onBackdropReady }: IntroProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <>
      <Suspense fallback={<div className={styles.fallback} aria-hidden="true" />}>
        <GradientBackdrop animate={!prefersReducedMotion} onReady={onBackdropReady} />
      </Suspense>

      <div className={cx(styles.content, revealed && styles.playing)}>
        {/* The words are separate elements for the stagger, so the accessible
            name is stated once here rather than reconstructed from spans. */}
        <h1 className={styles.title} aria-label={HEADING}>
          {LINES.map((line) => (
            <span key={line[0]?.text} className={styles.line} aria-hidden="true">
              {line.map((word) => (
                <span key={word.text} className={styles.word}>
                  <span
                    className={styles.wordInner}
                    style={{ "--index": word.beat } as CSSProperties}
                  >
                    {word.text}
                  </span>
                </span>
              ))}
            </span>
          ))}
        </h1>

        <button type="button" className={styles.cue} onClick={() => scrollToSection("overview")}>
          <span className={styles.cueRail} aria-hidden="true" />
          Scroll
        </button>
      </div>
    </>
  );
}
