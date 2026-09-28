import { useCallback, useEffect, useRef, useState } from "react";
import type { CareerJob } from "server";

import { ActivityTimeline, formatMonth } from "../components/ActivityTimeline";
import { CardHand } from "../components/CardHand";
import { CardDetails, CardFront, CardSurface } from "../components/ProductCard";
import { SectionTitle } from "../components/SectionTitle";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useResource } from "../hooks/useResource";
import { api, unwrap } from "../lib/api";
import styles from "./Career.module.css";

const dateStamp = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

/**
 * Where the hand of cards is used instead of the grid: wide and tall enough for
 * the fan plus a played card under the timeline, and a pointer that can hover.
 * Everywhere else — phones, tablets, small windows — the cards are a grid.
 */
const HAND_QUERY = "(min-width: 1180px) and (min-height: 760px) and (hover: hover) and (pointer: fine)";

/** Must match `--card-h` in CardHand.module.css. */
const CARD_HEIGHT_REM = 25.2;
/** The most a played card grows; less when the screen is too short to fit it under the graph. */
const MAX_GROW = 1.5;
/** Space between the timeline and a played card, below the card, and above the timeline. */
const PLAYED_GAP_PX = 20;
const PLAYED_MARGIN_PX = 24;
const TIMELINE_TOP_PX = 16;

/** Keys that scroll the page, and so put a played card back. */
const SCROLL_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];

type JobProps = {
  job: CareerJob;
  generatedAt: string | null;
  onscreen: boolean;
  /** Hand of cards (large screens with a mouse), or the grid. */
  hand: boolean;
  /** This employer is the one on screen: its hand is the one dealt in. */
  current: boolean;
  /** The page's scroller: what playing a card scrolls, and what scrolling it puts the card back. */
  scroller: HTMLElement | null;
};

function Job({ job, generatedAt, onscreen, hand, current, scroller }: JobProps) {
  // Shared by the timeline rows and the cards: pointing at either lifts both.
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [play, setPlay] = useState({ shift: 0, grow: 1 });
  const timeline = useRef<HTMLElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const cards = job.products.filter((product) => product.card);
  const dealt = hand && onscreen && current;

  /*
   * Playing a card scrolls the page so the timeline sits just above where the
   * card will land, then sends the card there, as big as fits beneath it (up
   * to 1.5×). The timeline is never pushed off the top to make room — it is
   * what the card is being read against — so a short screen gets a smaller
   * card instead. Everything is measured after the scroll is clamped to the
   * page, so a timeline that cannot scroll any higher still gets the card
   * directly beneath it.
   */
  const select = useCallback(
    (id: string | null) => {
      const box = timeline.current;

      if (!id || !box || !scroller) {
        setSelected(null);
        return;
      }

      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const cardHeight = CARD_HEIGHT_REM * rem;
      const screen = scroller.clientHeight;
      const rect = box.getBoundingClientRect();
      const top = scroller.getBoundingClientRect().top;
      const bottom = rect.bottom - top;
      // As high as the timeline may go, and as high as the full-size card needs it.
      const highest = TIMELINE_TOP_PX + rect.height;
      const wantedBottom = Math.max(highest, screen - PLAYED_MARGIN_PX - PLAYED_GAP_PX - cardHeight * MAX_GROW);
      const target = Math.min(
        Math.max(scroller.scrollTop + bottom - wantedBottom, 0),
        scroller.scrollHeight - screen,
      );
      const landedBottom = bottom - (target - scroller.scrollTop);
      const room = screen - PLAYED_MARGIN_PX - PLAYED_GAP_PX - landedBottom;
      const grow = Math.min(MAX_GROW, Math.max(1, room / cardHeight));
      const cardTop = landedBottom + PLAYED_GAP_PX;

      scroller.scrollTo({ top: target, behavior: reducedMotion ? "auto" : "smooth" });
      // The card's slot sits one card height above the bottom of the screen.
      setPlay({ shift: Math.round(cardTop - (screen - cardHeight)), grow });
      setSelected(id);
    },
    [reducedMotion, scroller],
  );

  // Anything that takes the hand away takes the played card back into it.
  useEffect(() => {
    if (!dealt) setSelected(null);
  }, [dealt]);

  /*
   * A played card goes back on: Esc, a click anywhere but a card, or any
   * attempt to scroll. The scroll this component started itself fires no
   * wheel, touch or key events, so it never closes the card it opened.
   */
  useEffect(() => {
    if (!selected || !scroller) return;

    const close = () => setSelected(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (SCROLL_KEYS.includes(event.key) && !(event.target as Element | null)?.closest("[data-card-slot]")) close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest("[data-card-slot]")) close();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("wheel", close, { passive: true });
    scroller.addEventListener("touchmove", close, { passive: true });

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("wheel", close);
      scroller.removeEventListener("touchmove", close);
    };
  }, [selected, scroller]);

  return (
    <article className={styles.job} data-hand={hand && cards.length > 0 ? "true" : undefined} data-job="">
      <header className={styles.jobHead}>
        <div className={styles.jobTitleRow}>
          <h3 className={styles.company}>
            {job.url ? (
              <a href={job.url} target="_blank" rel="noreferrer">
                {job.company}
              </a>
            ) : (
              job.company
            )}
          </h3>
          <span className={styles.jobDates}>
            {formatMonth(Date.parse(`${job.start}T00:00:00Z`))} –{" "}
            {job.end ? formatMonth(Date.parse(`${job.end}T00:00:00Z`)) : "Present"}
          </span>
        </div>
        <p className={styles.role}>
          {job.role}
          {job.location && <span className={styles.location}> · {job.location}</span>}
        </p>
        {job.summary && <p className={styles.summary}>{job.summary}</p>}
      </header>

      {job.products.length > 0 && (
        <section
          ref={timeline}
          className={styles.card}
          aria-label={`What I worked on at ${job.company}, over time`}
        >
          <h4 className={styles.cardTitle}>Active periods</h4>
          <ActivityTimeline
            job={job}
            active={selected ?? active}
            selected={selected}
            onActive={setActive}
            revealed={onscreen}
          />
          <p className={styles.footnote}>
            Weekly commits from git history
            {generatedAt ? `, updated ${dateStamp.format(new Date(generatedAt))}` : ""}. Four quiet weeks end a
            period; heavier stretches of work land harder.
          </p>
        </section>
      )}

      {cards.length > 0 &&
        (hand ? (
          <CardHand
            label={job.company}
            products={cards}
            shown={dealt}
            active={active}
            selected={selected}
            play={play}
            onActive={setActive}
            onSelect={select}
          />
        ) : (
          <div className={styles.products}>
            {cards.map((product) => (
              <CardSurface
                key={product.id}
                product={product}
                data-active={active === product.id ? "true" : undefined}
                onPointerEnter={() => setActive(product.id)}
                onPointerLeave={() => setActive(null)}
              >
                <CardFront product={product} />
                <CardDetails product={product} />
              </CardSurface>
            ))}
          </div>
        ))}
    </article>
  );
}

/**
 * Work, as opposed to the GitHub pages after it: everything here — every
 * employer, its products, their logos and the activity behind the timeline —
 * comes from the data store, so all of it changes with a push, not a deploy.
 *
 * `onscreen` is true from the moment the page starts arriving until it has
 * fully left: the timeline replays its reveal on every visit, and resets only
 * once nobody can see it happen.
 *
 * On large screens each employer takes a screen of its own, and its products
 * are a hand of cards held along the bottom edge. Scrolling from one employer
 * to the next drops one hand and deals the other.
 */
export function Career({ onscreen }: { onscreen: boolean }) {
  const career = useResource("career", () => unwrap(api.career.$get(), "Could not load career details"));
  const hand = useMediaQuery(HAND_QUERY);
  // The page's own scroller, not the document: the Section this page renders in.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const layout = useCallback((node: HTMLDivElement | null) => setScroller(node?.closest("section") ?? null), []);
  const [current, setCurrent] = useState(0);
  const jobCount = career.status === "ready" ? career.data.jobs.length : 0;

  /*
   * Which employer is on screen: the one crossing a line 40% of the way down
   * the page. Between two (in the gap) the last one keeps its hand.
   */
  useEffect(() => {
    const root = scroller;
    if (!hand || !root || jobCount < 2) return;

    const jobs = [...root.querySelectorAll<HTMLElement>("[data-job]")];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(jobs.indexOf(entry.target as HTMLElement));
        }
      },
      { root, rootMargin: "-40% 0px -60% 0px" },
    );

    for (const job of jobs) observer.observe(job);
    return () => observer.disconnect();
  }, [hand, jobCount, scroller]);

  return (
    <div ref={layout} className={styles.layout}>
      <SectionTitle id="career" />

      {career.status === "error" && <p className={styles.notice}>{career.message}</p>}

      {career.status === "loading" && (
        <div className={styles.skeletons}>
          <div className={styles.skeletonBlock} />
          <div className={styles.skeletonCard} />
        </div>
      )}

      {career.status === "ready" &&
        career.data.jobs.map((job, index) => (
          <Job
            key={`${job.company}-${job.start}`}
            job={job}
            generatedAt={career.data.activityGeneratedAt}
            onscreen={onscreen}
            hand={hand}
            current={index === current}
            scroller={scroller}
          />
        ))}
    </div>
  );
}
