import type { ReactNode } from "react";

import { cx } from "../lib/cx";
import type { SectionId } from "../sections/sections";
import styles from "./Section.module.css";

type SectionProps = {
  id: SectionId;
  label: string;
  /** Centres content in the full viewport instead of the nav-clearing column. */
  centered?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * A full-viewport snap target. `tabIndex={-1}` exists so the side nav can move
 * focus here after an instant jump.
 */
export function Section({ id, label, centered, className, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-label={label}
      tabIndex={-1}
      className={cx(styles.section, centered && styles.centered, className)}
    >
      {children}
    </section>
  );
}
