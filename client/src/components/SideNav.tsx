import { cx } from "../lib/cx";
import { SECTION_META, SECTIONS } from "../sections/sections";
import styles from "./SideNav.module.css";

type SideNavProps = {
  /** The page in view, or the one being handed to while a handover runs. */
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * A project's page is open, so the rail names three pages that are all off
   * to the side. It leaves with them rather than floating over a sub-page it
   * cannot navigate to.
   */
  hidden: boolean;
};

export function SideNav({ activeId, onSelect, hidden }: SideNavProps) {
  return (
    <nav
      className={styles.nav}
      aria-label="Page sections"
      data-hidden={hidden ? "true" : undefined}
      inert={hidden}
    >
      {SECTIONS.map((section) => {
        const isActive = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            className={cx(styles.item, isActive && styles.active)}
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSelect(section.id)}
          >
            <span className={styles.index} aria-hidden="true">
              {SECTION_META[section.id].number}
            </span>
            <span className={styles.label}>{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
