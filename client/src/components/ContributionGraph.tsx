import { useEffect, useRef } from "react";
import type { ContributionWeek } from "server";

import styles from "./ContributionGraph.module.css";

type ContributionGraphProps = {
  weeks: ContributionWeek[];
  total: number;
};

const LEVELS = [0, 1, 2, 3, 4] as const;

export function ContributionGraph({ weeks, total }: ContributionGraphProps) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A year of weeks overflows every realistic column width, and the
    // interesting end is the recent one.
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks]);

  return (
    <div className={styles.wrap}>
      <div className={styles.scroller} ref={scroller}>
        <div className={styles.grid} role="img" aria-label={`${total} contributions in the last year`}>
          {weeks.map((week) =>
            week.days.map((day) => (
              <div
                key={day.date}
                className={styles.day}
                data-level={day.level}
                title={`${day.count} contribution${day.count === 1 ? "" : "s"} on ${day.date}`}
              />
            )),
          )}
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.total}>{total.toLocaleString()} contributions this year</span>
        Less
        <span className={styles.legendSwatches}>
          {LEVELS.map((level) => (
            <span key={level} className={styles.day} data-level={level} />
          ))}
        </span>
        More
      </div>
    </div>
  );
}
