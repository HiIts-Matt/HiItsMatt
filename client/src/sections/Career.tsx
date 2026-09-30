import { useCallback, useEffect, useRef, useState } from "react";
import type { CareerJob } from "server";

import { ActivityTimeline, formatMonth } from "../components/ActivityTimeline";
import { CardHand } from "../components/CardHand";
import { CardDetails, CardFront, CardSurface } from "../components/ProductCard";
import { SectionTitle } from "../components/SectionTitle";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useResource } from "../hooks/useResource";
import { useSeen } from "../hooks/useSeen";
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
/** Space below a played card, and above the timeline. */
const PLAYED_MARGIN_PX = 24;
const TIMELINE_TOP_PX = 16;
/*
 * How much of each has to scroll into view before it plays: most of the graph,
 * whose reveal is a sweep across it, but only the top of the taller hand.
 */
const REVEAL_THRESHOLD = 0.4;
const DEAL_THRESHOLD = 0.2;

type JobProps = {
  job: CareerJob;
  generatedAt: string | null;
  onscreen: boolean;
  /** Hand of cards (large screens with a mouse), or the grid. */
  hand: boolean;
  /** The page's scroller: what the graph and hand scroll into view in, and what playing a card scrolls. */
  scroller: HTMLElement | null;
};

function Job({ job, generatedAt, onscreen, hand, scroller }: JobProps) {
  // Shared by the timeline rows and the cards: pointing at either lifts both.
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [grow, setGrow] = useState(1);
  const timeline = useRef<HTMLElement>(null);
  const handBox = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const cards = job.products.filter((product) => product.card);
  /*
   * The graph plays its reveal, and the hand is dealt, the first time each
   * scrolls into view on a visit to the page — not before, where the ones
   * further down would play to nobody, and not again on scrolling back. Both
   * reset once the page has left, ready for the next visit.
   */
  const revealed = useSeen(timeline, scroller, onscreen, REVEAL_THRESHOLD);
  const dealt = useSeen(handBox, scroller, hand && onscreen, DEAL_THRESHOLD);

  /*
   * Playing a card scrolls the page so the timeline sits just above the hand,
   * then grows the card as big as fits on screen beneath it (up to 1.5×). The
   * timeline is never pushed off the top to make room — it is what the card is
   * being read against — so a short screen gets a smaller card instead.
   * Everything is measured after the scroll is clamped to the page, so a hand
   * that cannot scroll any higher still gets a card that fits under it.
   */
  const select = useCallback(
    (id: string | null) => {
      const graph = timeline.current;
      const held = handBox.current;

      if (!id || !graph || !held || !scroller) {
        setSelected(null);
        return;
      }

      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const cardHeight = CARD_HEIGHT_REM * rem;
      const screen = scroller.clientHeight;
      const top = scroller.getBoundingClientRect().top;
      const graphTop = graph.getBoundingClientRect().top - top;
      const handTop = held.getBoundingClientRect().top - top;
      // As high as the hand may go, and as high as the full-size card needs it.
      const highest = TIMELINE_TOP_PX + handTop - graphTop;
      const wantedTop = Math.max(highest, screen - PLAYED_MARGIN_PX - cardHeight * MAX_GROW);
      const target = Math.min(
        Math.max(scroller.scrollTop + handTop - wantedTop, 0),
        scroller.scrollHeight - screen,
      );
      const landedTop = handTop - (target - scroller.scrollTop);
      const room = screen - PLAYED_MARGIN_PX - landedTop;

      scroller.scrollTo({ top: target, behavior: reducedMotion ? "auto" : "smooth" });
      setGrow(Math.min(MAX_GROW, Math.max(1, room / cardHeight)));
      setSelected(id);
    },
    [reducedMotion, scroller],
  );

  // Anything that takes the hand away takes the played card back into it.
  useEffect(() => {
    if (!dealt) setSelected(null);
  }, [dealt]);

  // A played card goes back on Esc, or a click anywhere but a card.
  useEffect(() => {
    if (!selected) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest("[data-card-slot]")) setSelected(null);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selected]);

  return (
    <article className={styles.job}>
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
            revealed={revealed}
          />
          <p className={styles.footnote}>
            Weekly commits from git history
            {generatedAt ? `, updated ${dateStamp.format(new Date(generatedAt))}` : ""}
          </p>
        </section>
      )}

      {cards.length > 0 &&
        (hand ? (
          <CardHand
            ref={handBox}
            label={job.company}
            products={cards}
            shown={dealt}
            active={active}
            selected={selected}
            grow={grow}
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
 * Work, as opposed to the GitHub pages either side of it: everything here —
 * every employer, its products, their logos and the activity behind the
 * timeline — comes from the data store, so all of it changes with a push, not
 * a deploy.
 *
 * `onscreen` is true from the moment the page starts arriving until it has
 * fully left. Within that, each employer's graph plays its reveal, and on
 * large screens its hand of cards is dealt, as it scrolls into view.
 */
export function Career({ onscreen }: { onscreen: boolean }) {
  const career = useResource("career", () => unwrap(api.career.$get(), "Could not load career details"));
  const hand = useMediaQuery(HAND_QUERY);
  // The page's own scroller, not the document: the Section this page renders in.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const layout = useCallback((node: HTMLDivElement | null) => setScroller(node?.closest("section") ?? null), []);

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
        career.data.jobs.map((job) => (
          <Job
            key={`${job.company}-${job.start}`}
            job={job}
            generatedAt={career.data.activityGeneratedAt}
            onscreen={onscreen}
            hand={hand}
            scroller={scroller}
          />
        ))}
    </div>
  );
}
