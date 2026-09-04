import type { TransitionEvent } from "react";

import { cx } from "../lib/cx";
import styles from "./Loader.module.css";

type LoaderProps = {
  /** Once true the curtain slides up; `onExited` fires when it is offscreen. */
  exiting: boolean;
  onExited: () => void;
};

export function Loader({ exiting, onExited }: LoaderProps) {
  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    // The curtain has several animated descendants; only the slide counts.
    if (event.target === event.currentTarget && event.propertyName === "translate") onExited();
  };

  return (
    <div
      className={cx(styles.loader, exiting && styles.exit)}
      role="status"
      aria-label="Loading"
      onTransitionEnd={handleTransitionEnd}
    >
      <span className={styles.bar} aria-hidden="true" />
    </div>
  );
}
