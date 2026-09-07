import type { ReactNode } from "react";

import { cx } from "../lib/cx";
import type { SectionId } from "../sections/sections";
import styles from "./Section.module.css";

type SectionProps = {
  id: SectionId;
  label: string;
  /** Centres content in the full viewport instead of the nav-clearing column. */
  centered?: boolean;
  /**
   * Lets the section grow past one screen. Scroll snapping still aligns its
   * top edge, but an oversized snap area is scrollable from end to end rather
   * than being pinned to a single resting position.
   */
  tall?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * A full-viewport snap target. `tabIndex={-1}` exists so the side nav can move
 * focus here after an instant jump.
 */
export function Section({ id, label, centered, tall, className, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-label={label}
      tabIndex={-1}
      className={cx(styles.section, centered && styles.centered, tall && styles.tall, className)}
    >
      {children}
    </section>
  );
}
