import { type CSSProperties, Fragment } from "react";
import type { CareerJob, CareerProduct } from "server";

import { PAGE_SLIDE_MS } from "../hooks/usePager";
import styles from "./ActivityTimeline.module.css";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/*
 * Reveal choreography. Each bar is its own launch, and launches follow the
 * calendar: a bar waits in proportion to how far across the axis it starts, so
 * the chart fills in left to right in the order the work happened. A row's
 * label arrives with its first bar.
 *
 * The page's handover slide is still running when it becomes the current page,
 * so the whole sequence waits for most of it: the reveal should start as the
 * page lands, not behind the page that is leaving.
 */
export const REVEAL_DELAY_MS = Math.round(PAGE_SLIDE_MS * 0.6);
/** Time between a launch at the axis start and one at its far end. */
const SWEEP_MS = 1000;

/** A bar's run time grows with how far it travels, within limits. */
const MIN_BAR_MS = 820;
const MAX_BAR_MS = 1300;

const PARTICLE_SHAPES = ["dot", "square", "dash", "tri"] as const;

// en-US on purpose: en-AU and en-GB abbreviate September to "Sept".
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function formatMonth(ms: number): string {
  return monthYear.format(ms);
}

/**
 * "Apr 2026 – Present", from the product's first period to its last. Period
 * ends are exclusive, so the last month shown is the day before.
 */
export function activeRange(product: CareerProduct): string | null {
  const first = product.periods[0];
  const last = product.periods.at(-1);

  if (!first || !last) {
    return null;
  }

  return `${formatMonth(toMs(first.start))} – ${last.end ? formatMonth(toMs(last.end) - DAY_MS) : "Present"}`;
}

/**
 * Deterministic scatter: the same bar throws the same burst on every visit,
 * so the reveal is choreographed rather than random.
 */
function seeded(key: string): () => number {
  let state = 2166136261;

  for (const char of key) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  }

  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;

    return (state >>> 0) / 4294967296;
  };
}

type Particle = { shape: (typeof PARTICLE_SHAPES)[number]; dx: number; dy: number; rot: number; tint: boolean };

/**
 * The debris a bar throws off as it lands. `impact` (0–1, the bar's share of
 * the heaviest bar's commits) sets how many pieces and how far they fly: a
 * heavy stretch of work hits harder than a fortnight.
 */
function burst(key: string, impact: number): Particle[] {
  const random = seeded(key);
  const count = 4 + Math.round(impact * 4);

  return Array.from({ length: count }, (_, index) => {
    // Mostly forward, fanned either side of the direction of travel; the odd
    // piece kicks back along the bar.
    const back = index === count - 1 && count > 5;
    const angle = back
      ? Math.PI + (random() - 0.5) * 0.9
      : (index / Math.max(count - 2, 1) - 0.5) * 2.4 + (random() - 0.5) * 0.35;
    const distance = (back ? 7 : 11 + random() * 12) * (0.75 + impact * 0.55);
    const shape = PARTICLE_SHAPES[Math.floor(random() * PARTICLE_SHAPES.length)]!;

    return {
      shape,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      // Dashes fly point-first; the rest tumble.
      rot: shape === "dash" ? (angle * 180) / Math.PI : (random() - 0.5) * 260,
      tint: random() > 0.55,
    };
  });
}

type Bar = {
  key: string;
  left: number;
  width: number;
  title: string;
  commits: number;
};

type ActivityTimelineProps = {
  job: CareerJob;
  /** Product under the pointer, here or on its card; only its bars brighten. */
  active: string | null;
  onActive: (id: string | null) => void;
  /** Product whose card has been played: its bars are marked on the axis. */
  selected: string | null;
  /**
   * The page is on screen. Turning true plays the reveal; turning false puts
   * every bar back at its start, ready for the next visit.
   */
  revealed: boolean;
};

/**
 * One row per product across the job's dates: when each was being worked on,
 * in its colour. The axis runs from the job's start to today, or to its
 * end date once there is one, so an ongoing period grows by itself between runs
 * of the activity script.
 */
export function ActivityTimeline({ job, active, onActive, selected, revealed }: ActivityTimelineProps) {
  const axisStart = toMs(job.start);
  const axisEnd = Math.max(job.end ? Math.min(toMs(job.end), Date.now()) : Date.now(), axisStart + WEEK_MS);
  const position = (ms: number) => Math.min(Math.max(((ms - axisStart) / (axisEnd - axisStart)) * 100, 0), 100);

  // Quarterly ticks from the first quarter boundary on or after the start.
  const ticks: { ms: number; left: number }[] = [];
  const cursor = new Date(axisStart);
  cursor.setUTCDate(1);

  while (cursor.getUTCMonth() % 3 !== 0 || cursor.getTime() < axisStart) {
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (; cursor.getTime() < axisEnd; cursor.setUTCMonth(cursor.getUTCMonth() + 3)) {
    ticks.push({ ms: cursor.getTime(), left: position(cursor.getTime()) });
  }

  // A cascade, oldest work at the top; products with no activity sink.
  const rows = [...job.products]
    .sort((a, b) => (a.periods[0]?.start ?? "9999").localeCompare(b.periods[0]?.start ?? "9999"))
    .map((product) => ({
      product,
      bars: product.periods.flatMap((period): Bar[] => {
        const startMs = toMs(period.start);
        const endMs = Math.min(period.end ? toMs(period.end) : axisEnd, axisEnd);

        if (endMs <= startMs) {
          return [];
        }

        const commits = product.weeks
          .filter((week) => toMs(week.week) >= startMs && toMs(week.week) < endMs)
          .reduce((sum, week) => sum + week.commits, 0);

        return [
          {
            key: period.start,
            left: position(startMs),
            width: position(endMs) - position(startMs),
            title: `${product.name}: ${formatMonth(startMs)} – ${period.end ? formatMonth(endMs - DAY_MS) : "Present"} · ${commits} commit${commits === 1 ? "" : "s"}`,
            commits,
          },
        ];
      }),
    }));

  // Impact is relative to the heaviest bar in this job, so every job's
  // timeline uses its whole range of landings.
  const heaviest = Math.max(1, ...rows.flatMap((row) => row.bars.map((bar) => bar.commits)));

  return (
    <div
      className={styles.timeline}
      data-revealed={revealed ? "true" : undefined}
      style={{ "--reveal-delay": `${REVEAL_DELAY_MS}ms` } as CSSProperties}
    >
      <ul className={styles.rows}>
        {rows.map(({ product, bars }) => {
          const range = activeRange(product);
          const rowDelay = Math.round(((bars[0]?.left ?? 0) / 100) * SWEEP_MS);

          return (
            <li
              key={product.id}
              className={styles.row}
              style={{ "--accent": product.color, "--row-delay": `${rowDelay}ms` } as CSSProperties}
              onPointerEnter={() => onActive(product.id)}
              onPointerLeave={() => onActive(null)}
            >
              <span className={styles.label}>
                <span className={styles.dot} aria-hidden="true" />
                {product.name}
                {/* The bars are drawn, not read: this is what a screen reader gets. */}
                <span className={styles.visuallyHidden}>{range ? `, ${range}` : ", no recorded activity"}</span>
              </span>

              <span className={styles.track} aria-hidden="true">
                {ticks.map((tick) => (
                  <span key={tick.ms} className={styles.gridline} style={{ left: `${tick.left}%` }} />
                ))}

                {bars.map((bar) => {
                  const impact = Math.sqrt(bar.commits / heaviest);
                  const duration = Math.round(Math.min(MAX_BAR_MS, Math.max(MIN_BAR_MS, 640 + bar.width * 8)));
                  const motion = {
                    "--l": `${bar.left}%`,
                    "--w": `${bar.width}%`,
                    "--bar-delay": `${Math.round((bar.left / 100) * SWEEP_MS)}ms`,
                    "--dur": `${duration}ms`,
                    "--impact": impact.toFixed(3),
                  } as CSSProperties;

                  return (
                    <Fragment key={bar.key}>
                      <span
                        className={styles.bar}
                        data-active={active === product.id ? "true" : undefined}
                        data-selected={selected === product.id ? "true" : undefined}
                        title={bar.title}
                        style={motion}
                      >
                        <span className={styles.fill} />
                      </span>

                      <span className={styles.burst} style={motion}>
                        {burst(`${product.id}:${bar.key}`, impact).map((particle, index) => (
                          <span
                            key={index}
                            className={styles.particle}
                            data-shape={particle.shape}
                            data-tint={particle.tint ? "true" : undefined}
                            style={
                              {
                                "--dx": `${particle.dx.toFixed(1)}px`,
                                "--dy": `${particle.dy.toFixed(1)}px`,
                                "--rot": `${particle.rot.toFixed(0)}deg`,
                              } as CSSProperties
                            }
                          />
                        ))}
                      </span>
                    </Fragment>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>

      <div className={styles.axis} aria-hidden="true">
        <span className={styles.ticks}>
          {/* A label this close to the end would run into the end label. */}
          {ticks
            .filter((tick) => tick.left < 90)
            .map((tick) => (
              <span
                key={tick.ms}
                className={styles.tick}
                // Centred on its date, except at the very start, where it would hang off the card.
                data-start={tick.left < 4 ? "true" : undefined}
                style={{ left: `${tick.left}%` }}
              >
                {formatMonth(tick.ms)}
              </span>
            ))}
          {/* The month they left, as the job header spells it. */}
          <span className={styles.end}>{job.end ? formatMonth(toMs(job.end)) : "Now"}</span>
        </span>
      </div>
    </div>
  );
}
