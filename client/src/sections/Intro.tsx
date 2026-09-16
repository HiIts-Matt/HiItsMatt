import type { CSSProperties } from "react";

import { cx } from "../lib/cx";
import styles from "./Intro.module.css";

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
  /** Hands over to the next page; the cue is a page step, not a scroll. */
  onAdvance: () => void;
};

/**
 * Content only: the gradient behind it belongs to `IntroBackdrop`, which the
 * page takes as its backdrop rather than as content, because the transition
 * band has to paint past this page's bottom edge.
 */
export function Intro({ revealed, onAdvance }: IntroProps) {
  return (
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

      <button type="button" className={styles.cue} onClick={onAdvance}>
        <span className={styles.cueRail} aria-hidden="true" />
        Scroll
      </button>
    </div>
  );
}
