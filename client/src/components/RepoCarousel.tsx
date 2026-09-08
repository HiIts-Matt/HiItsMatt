import { useCallback, useEffect, useRef, useState } from "react";
import type { Repo } from "server";

import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useResource } from "../hooks/useResource";
import { api, unwrap } from "../lib/api";
import styles from "./RepoCarousel.module.css";

/** Ambient drift speed, in CSS pixels per second. */
const DRIFT_PX_PER_SECOND = 42;
/** How long after a touch or wheel the drift stays out of the way. */
const RESUME_DELAY_MS = 3500;

function RepoCard({ repo, hidden }: { repo: Repo; hidden: boolean }) {
  // GitHub's OG renderer 404s for some repos; a broken-image glyph is worse
  // than the gradient placeholder.
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <a
      className={styles.card}
      href={repo.htmlUrl}
      target="_blank"
      rel="noreferrer"
      // The belt renders the list twice; the clone is decorative, and exposing
      // it would duplicate every link for assistive tech.
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
    >
      {thumbFailed ? (
        <span className={styles.thumbFallback}>{repo.name.slice(0, 2).toUpperCase()}</span>
      ) : (
        <img
          className={styles.thumb}
          src={repo.socialImageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setThumbFailed(true)}
        />
      )}
      <span className={styles.name}>{repo.name}</span>
      <span className={styles.excerpt}>
        {repo.description ?? repo.readmeExcerpt ?? "No description yet."}
      </span>
      <span className={styles.footer}>
        <span className={styles.language}>
          {repo.language && (
            <>
              <span className={styles.languageDot} />
              {repo.language}
            </>
          )}
        </span>
        {repo.archived && <span className={styles.archived}>Archived</span>}
        <span>★ {repo.stars}</span>
      </span>
    </a>
  );
}

/**
 * Drifts the rail by writing `scrollLeft` rather than animating a transform, so
 * the ambient motion and the visitor's own wheel, drag or swipe share one
 * coordinate space: taking hold of the rail is just scrolling it.
 */
function useDrift(rail: HTMLDivElement | null, active: boolean) {
  useEffect(() => {
    if (!rail || !active) return;

    let frame = 0;
    let last = performance.now();
    // Browsers that round `scrollLeft` would otherwise swallow every sub-pixel
    // step and never move at this speed.
    let carry = 0;

    const step = (now: number) => {
      const delta = ((now - last) / 1000) * DRIFT_PX_PER_SECOND;
      last = now;

      // One set of cards is exactly half the rail; wrapping there is invisible
      // because the second set is identical.
      const set = rail.scrollWidth / 2;
      const target = rail.scrollLeft + carry + delta;
      rail.scrollLeft = target >= set ? target - set : target;
      carry = target >= set ? 0 : target - rail.scrollLeft;

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [rail, active]);
}

/**
 * Every public repository. This is the automatic half of the site — the personal
 * work section is the curated half — so each card stays deliberately shallow: a
 * name, a line of prose and a link out.
 *
 * Two ways through them: a drifting rail that is also a plain horizontal
 * scroller, and a grid holding all of them at once for anyone who would rather
 * read than chase.
 */
export function RepoCarousel() {
  const repos = useResource("repos", () =>
    unwrap(api.github.repos.$get(), "Could not load repositories"),
  );
  const prefersReducedMotion = usePrefersReducedMotion();

  const [expanded, setExpanded] = useState(false);
  const [held, setHeld] = useState(false);
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  const resumeTimer = useRef<number>(0);

  // Wheel and touch have no hover to leave, so they release on a timer instead.
  const holdBriefly = useCallback(() => {
    setHeld(true);
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setHeld(false), RESUME_DELAY_MS);
  }, []);

  const release = useCallback(() => {
    window.clearTimeout(resumeTimer.current);
    setHeld(false);
  }, []);

  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  useDrift(rail, !expanded && !held && !prefersReducedMotion && repos.status === "ready");

  if (repos.status === "error") {
    return (
      <section className={styles.belt} aria-label="Public repositories">
        <div className={styles.header}>
          <h3 className={styles.title}>Public Repositories</h3>
        </div>
        <p className={styles.notice}>{repos.message}</p>
      </section>
    );
  }

  const count = repos.status === "ready" ? repos.data.repos.length : 0;

  return (
    <section className={styles.belt} aria-label="Public repositories">
      <div className={styles.header}>
        <h3 className={styles.title}>Public Repositories</h3>

        {count > 0 && (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Show rail" : `View all ${count}`}
          </button>
        )}
      </div>

      {repos.status === "loading" && (
        <div className={styles.rail}>
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className={styles.skeletonCard} />
          ))}
        </div>
      )}

      {repos.status === "ready" && count === 0 && (
        <p className={styles.notice}>No public repositories found for this account.</p>
      )}

      {repos.status === "ready" && count > 0 && (
        <div
          // The rail is a scroller; the grid is not, so only the rail gets the
          // ref, the mask and the hold handlers.
          ref={expanded ? undefined : setRail}
          className={expanded ? styles.grid : styles.rail}
          onPointerEnter={expanded ? undefined : () => setHeld(true)}
          onPointerLeave={expanded ? undefined : release}
          onFocusCapture={expanded ? undefined : () => setHeld(true)}
          onBlurCapture={expanded ? undefined : release}
          onWheel={expanded ? undefined : holdBriefly}
          onTouchStart={expanded ? undefined : holdBriefly}
        >
          {repos.data.repos.map((repo) => (
            <RepoCard key={repo.fullName} repo={repo} hidden={false} />
          ))}

          {/* The rail loops, which needs a second set to wrap into; the grid is
              the whole list exactly once. */}
          {!expanded &&
            repos.data.repos.map((repo) => (
              <RepoCard key={`clone-${repo.fullName}`} repo={repo} hidden />
            ))}
        </div>
      )}
    </section>
  );
}
