import { type CSSProperties, type SyntheticEvent, useEffect, useRef, useState } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { cx } from "../lib/cx";
import { SECTION_META, SECTIONS } from "../sections/sections";
import styles from "./SideNav.module.css";

type SideNavProps = {
  /** The page in view, or the one being handed to while a handover runs. */
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * A project's page is open, so the rail names pages that are all off
   * to the side. It leaves with them rather than floating over a sub-page it
   * cannot navigate to.
   */
  hidden: boolean;
};

/** Must match the breakpoint in SideNav.module.css. */
const PHONE_QUERY = "(max-width: 640px)";

// Read once: the credit is the year the page was opened in, not a live clock.
const YEAR = new Date().getFullYear();

/*
 * The pager turns pages on any swipe, wheel or touch that reaches the window.
 * While the menu is open those belong to the menu, so they stop here.
 */
const keepFromPager = (event: SyntheticEvent) => event.stopPropagation();

/**
 * The page rail. On desktop it is always open, a column on the left edge. On
 * phones it folds into a pill along the bottom naming the current page; tapping
 * it grows the pill into the same rail, most of the screen tall, its rows dealt
 * in one after another the way the overview's cards are.
 */
export function SideNav({ activeId, onSelect, hidden }: SideNavProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const active = SECTIONS.find((section) => section.id === activeId);
  // Only a phone's menu can be closed; the desktop rail always is the list.
  const expanded = phone && open;

  // Anything that moves the page, hides the rail or leaves the phone layout closes it.
  useEffect(() => {
    setOpen(false);
  }, [activeId, hidden, phone]);
  useEffect(() => {
    if (!expanded) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const swallow = expanded
    ? { onWheel: keepFromPager, onTouchStart: keepFromPager, onTouchEnd: keepFromPager }
    : {};

  return (
    <>
      <div
        className={styles.backdrop}
        data-open={expanded ? "true" : undefined}
        aria-hidden="true"
        onClick={() => setOpen(false)}
        {...swallow}
      />

      <nav
        className={styles.nav}
        aria-label="Page sections"
        data-hidden={hidden ? "true" : undefined}
        data-open={expanded ? "true" : undefined}
        inert={hidden}
        {...swallow}
      >
        <button
          ref={toggle}
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls="page-sections"
          aria-label={expanded ? "Close page menu" : "Open page menu"}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={styles.burger} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {active && <span>{active.label}</span>}
        </button>

        <div id="page-sections" className={styles.list} inert={phone && !open}>
          {SECTIONS.map((section, index) => {
            const isActive = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                className={cx(styles.item, isActive && styles.active)}
                style={{ "--i": index } as CSSProperties}
                aria-current={isActive ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  onSelect(section.id);
                }}
              >
                <span className={styles.index} aria-hidden="true">
                  {SECTION_META[section.id].number}
                </span>
                <span className={styles.label}>{section.label}</span>
              </button>
            );
          })}

          <p className={styles.credit} style={{ "--i": SECTIONS.length } as CSSProperties}>
            <img className={styles.logo} src="/icon.png" alt="" width={22} height={22} />
            <span className={styles.creditName}>Hi_Its_Matt</span>
            <span className={styles.creditMeta}>
              {YEAR} | v{__APP_VERSION__}
            </span>
          </p>
        </div>
      </nav>
    </>
  );
}
