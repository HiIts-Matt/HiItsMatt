import { scrollToSection } from "../hooks/useActiveSection";
import { cx } from "../lib/cx";
import { SECTIONS } from "../sections/sections";
import styles from "./SideNav.module.css";

type SideNavProps = {
  activeId: string;
};

export function SideNav({ activeId }: SideNavProps) {
  return (
    <nav className={styles.nav} aria-label="Page sections">
      {SECTIONS.map((section, index) => {
        const isActive = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            className={cx(styles.item, isActive && styles.active)}
            aria-current={isActive ? "true" : undefined}
            onClick={() => scrollToSection(section.id)}
          >
            <span className={styles.index} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className={styles.label}>{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
