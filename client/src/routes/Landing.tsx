import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import { Loader } from "../components/Loader";
import { Section } from "../components/Section";
import { SideNav } from "../components/SideNav";
import { PAGE_OVERLAP_MS, PAGE_SETTLE_MS, PAGE_SLIDE_MS, usePager } from "../hooks/usePager";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { Intro } from "../sections/Intro";
import { IntroBackdrop } from "../sections/IntroBackdrop";
import { Overview } from "../sections/Overview";
import { ProjectArticle } from "../sections/ProjectArticle";
import { Projects, useProjects } from "../sections/Projects";
import { SECTIONS, SECTION_IDS } from "../sections/sections";
import styles from "./Landing.module.css";

const [intro, overview, projects] = SECTIONS;

/** Below this the curtain feels like a flash rather than a transition. */
const MIN_CURTAIN_MS = 650;
/** Hard release: WebGL can be unavailable or the chunk can fail to load. */
const MAX_CURTAIN_MS = 5000;
/** Backstop in case `transitionend` never arrives (background tab, no compositor). */
const SLIDE_TIMEOUT_MS = 1200;

/** A project's own page: `#project/<slug>`, always dealt over the projects page. */
const PROJECT_HASH = /^#project\/(.+)$/;

type Route = { pageId: string; slug: string | null };

function readRoute(): Route {
  const match = PROJECT_HASH.exec(window.location.hash);

  return match
    ? { pageId: projects.id, slug: decodeURIComponent(match[1] ?? "") }
    : { pageId: window.location.hash.slice(1), slug: null };
}

/**
 * `open` is false for the length of the closing slide: the sub-page has to stay
 * mounted while it leaves, and unmounting it on the click would cut the
 * transition to a jump.
 */
type Detail = { slug: string; open: boolean };

type Phase = "loading" | "revealing" | "ready";

export function Landing() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const start = useRef(readRoute());

  // A deep link means the visitor asked for a specific page, so the intro
  // curtain would only be in the way.
  const [phase, setPhase] = useState<Phase>(() =>
    window.location.hash.slice(1) ? "ready" : "loading",
  );
  const mountedAt = useRef(Date.now());

  const [detail, setDetail] = useState<Detail | null>(() =>
    start.current.slug ? { slug: start.current.slug, open: true } : null,
  );
  const open = detail?.open ?? false;

  /*
   * The list belongs to the route rather than to the projects page: a link
   * straight to `#project/<slug>` has to resolve that project before its card
   * has ever been rendered, and both readers of the list share this one fetch.
   */
  const projectList = useProjects();

  const article =
    detail && projectList.status === "ready"
      ? (projectList.data.entries
          .flatMap((entry) => (entry.kind === "group" ? entry.group.projects : [entry.project]))
          .find((project) => project.slug === detail.slug) ?? null)
      : null;

  /*
   * Navigation between pages, rather than a scroll position: the handover is a
   * sequence — one page leaving, then the next expanding out from under it —
   * and a scroll offset can only ever express one number. The pages keep their
   * own scrolling, so reading down a long page stays entirely native.
   *
   * Locked while the curtain is up, because the loader covers the viewport, and
   * while a project page is open, because the stack is off to the side: a wheel
   * gesture there belongs to the article.
   */
  const pager = usePager(SECTION_IDS, {
    startId: start.current.pageId,
    locked: phase !== "ready" || open,
    instant: prefersReducedMotion,
  });
  const { activeId, goTo } = pager;

  /*
   * The timing lives in usePager, which needs it for its own input lock, and is
   * published to CSS here so the animations and the lock can never disagree.
   * With motion reduced both halves collapse to nothing — including the delay
   * that sequences them, which a blanket duration override cannot reach, and
   * the overlap that shortens that delay going back up.
   */
  const stage = {
    "--page-slide": `${prefersReducedMotion ? 0 : PAGE_SLIDE_MS}ms`,
    "--page-settle": `${prefersReducedMotion ? 0 : PAGE_SETTLE_MS}ms`,
    "--page-overlap": `${prefersReducedMotion ? 0 : PAGE_OVERLAP_MS}ms`,
  } as CSSProperties;

  /*
   * A sub-page is a navigation, so it pushes: Back closes it, and the close
   * control performs the same navigation rather than a second, parallel one.
   * A visitor who arrived on the link directly has nothing behind them, which
   * `pushed` is what remembers.
   */
  const pushed = useRef(false);

  const openProject = useCallback((slug: string) => {
    window.history.pushState(null, "", `#project/${encodeURIComponent(slug)}`);
    pushed.current = true;
    setDetail({ slug, open: true });
  }, []);

  const closeProject = useCallback(() => {
    if (pushed.current) {
      // popstate does the closing, so both routes through here are one path.
      window.history.back();
      return;
    }

    setDetail((current) => (current ? { ...current, open: false } : null));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const route = readRoute();
      pushed.current = route.slug !== null;

      setDetail((current) => {
        if (route.slug) return { slug: route.slug, open: true };
        return current ? { ...current, open: false } : null;
      });

      if (!route.slug) goTo(route.pageId);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [goTo]);

  // Unmounted only once it is offscreen: its images and any playing video go
  // with it, but not before the slide has finished showing them.
  useEffect(() => {
    if (!detail || detail.open) return;

    const timer = window.setTimeout(
      () => setDetail(null),
      prefersReducedMotion ? 0 : PAGE_SLIDE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [detail, prefersReducedMotion]);

  /*
   * The hash is the only scroll position left to restore: a reload, or a link
   * shared from here, should come back to the page it was taken from. While a
   * project page is up the URL is that page's, and the entry it pushed is not
   * one to overwrite.
   */
  useEffect(() => {
    if (open) return;

    const { pathname, search } = window.location;
    const hash = activeId === intro.id ? "" : `#${activeId}`;
    window.history.replaceState(null, "", `${pathname}${search}${hash}`);
  }, [open, activeId]);

  /*
   * Focus follows the sub-page out. The article takes focus for itself when it
   * opens; on the way back the projects page has to take it, or the keyboard
   * would be left on an element that just went inert. Skipped on the first
   * pass so arriving at the site never steals focus.
   */
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    if (open) return;

    document.getElementById(projects.id)?.focus({ preventScroll: true });
  }, [open]);

  const beginReveal = useCallback(() => {
    setPhase((current) => {
      if (current !== "loading") return current;
      // With motion reduced the slide collapses to nothing, so there is no
      // transition to wait on — drop the curtain outright.
      return prefersReducedMotion ? "ready" : "revealing";
    });
  }, [prefersReducedMotion]);

  const handleBackdropReady = useCallback(() => {
    const remaining = MIN_CURTAIN_MS - (Date.now() - mountedAt.current);
    if (remaining <= 0) {
      beginReveal();
      return;
    }
    window.setTimeout(beginReveal, remaining);
  }, [beginReveal]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(beginReveal, MAX_CURTAIN_MS);
    return () => window.clearTimeout(timer);
  }, [phase, beginReveal]);

  useEffect(() => {
    if (phase !== "revealing") return;
    const timer = window.setTimeout(() => setPhase("ready"), SLIDE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const finishReveal = useCallback(() => setPhase("ready"), []);

  return (
    <div className={styles.root} style={stage}>
      <div className={styles.stage}>
        {/*
          The page stack travels sideways as one: a project's page is not a
          fourth page in it but a layer beside it, and the two move together so
          the stack reads as having been pushed aside rather than replaced.
        */}
        <div className={styles.deck} data-shifted={open ? "true" : undefined} inert={open}>
          {/*
            The backdrop is passed to the page rather than nested in its content:
            its band paints past the page's own bottom edge, which a layer inside
            the scroller could never do.
          */}
          <Section
            id={intro.id}
            label={intro.label}
            role={pager.roleOf(intro.id)}
            direction={pager.direction}
            centered
            backdrop={<IntroBackdrop onReady={handleBackdropReady} />}
          >
            <Intro revealed={phase === "ready"} onAdvance={() => goTo(overview.id)} />
          </Section>

          {/* Both run past one screen: the overview carries the repo belt under
              the profile, and the projects page grows with each published case.
              Each scrolls inside its own page. */}
          <Section
            id={overview.id}
            label={overview.label}
            role={pager.roleOf(overview.id)}
            direction={pager.direction}
          >
            <Overview />
          </Section>

          <Section
            id={projects.id}
            label={projects.label}
            role={pager.roleOf(projects.id)}
            direction={pager.direction}
          >
            <Projects projects={projectList} onOpen={openProject} />
          </Section>
        </div>

        <div
          className={styles.detail}
          data-live={detail ? "true" : undefined}
          data-open={open ? "true" : undefined}
          aria-hidden={open ? undefined : "true"}
          inert={!open}
        >
          {detail && (
            <ProjectArticle
              key={detail.slug}
              slug={detail.slug}
              project={article}
              pending={projectList.status === "loading"}
              onClose={closeProject}
            />
          )}
        </div>
      </div>

      {/* The rail names the three pages of the stack, and the stack is not what
          is on screen while a project page is. */}
      <SideNav activeId={activeId} onSelect={goTo} hidden={open} />

      {phase !== "ready" && <Loader exiting={phase === "revealing"} onExited={finishReveal} />}
    </div>
  );
}
