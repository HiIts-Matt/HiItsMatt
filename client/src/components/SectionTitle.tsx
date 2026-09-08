import { SECTION_META, type SectionId } from "../sections/sections";
import styles from "./SectionTitle.module.css";

type SectionTitleProps = {
  id: SectionId;
};

/**
 * Numbered mono line over an oversized display word. The heading is the section
 * name itself — the old "What I work on" said less than the rail already did —
 * so the mono line carries the index plus the one thing the name leaves out.
 * Text comes from `SECTION_META`, which keeps the heading, the side nav and the
 * section's accessible name on the same words.
 */
export function SectionTitle({ id }: SectionTitleProps) {
  const { label, number, note } = SECTION_META[id];

  return (
    <header className={styles.title}>
      {/* Decoration: the rail announces the position, and "zero two em dash"
          in front of every heading is noise. */}
      <p className={styles.eyebrow} aria-hidden="true">
        {number}
        {note ? ` | ${note}` : null}
      </p>
      <h2 className={styles.heading}>{label}</h2>
    </header>
  );
}
