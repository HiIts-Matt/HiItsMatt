import { type CSSProperties, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Loader } from "../components/Loader";
import { Section } from "../components/Section";
import { SideNav } from "../components/SideNav";
import { PAGE_OVERLAP_MS, PAGE_SETTLE_MS, PAGE_SLIDE_MS, usePager } from "../hooks/usePager";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { Career } from "../sections/Career";
import { Intro } from "../sections/Intro";
import { IntroBackdrop } from "../sections/IntroBackdrop";
import { Overview } from "../sections/Overview";
import { ProjectArticle } from "../sections/ProjectArticle";
import { Projects, useProjects } from "../sections/Projects";
import { SECTIONS, SECTION_IDS, pagePath, projectPath } from "../sections/sections";
import styles from "./Landing.module.css";

const [intro, overview, career, projects] = SECTIONS;

/** Below this the curtain feels like a flash rather than a transition. */
const MIN_CURTAIN_MS = 650;
/** Hard release: WebGL can be unavailable or the chunk can fail to load. */
const MAX_CURTAIN_MS = 5000;
/** Backstop in case `transitionend` never arrives (background tab, no compositor). */
const SLIDE_TIMEOUT_MS = 1200;

/** A project's own page: `/projects/<slug>`, always dealt over the projects page. */
const PROJECT_PATH = /^\/projects\/([^/]+)\/?$/;

type Route = { pageId: string; slug: string | null };

function readRoute(): Route {
  const { pathname, hash } = window.location;
  // Links shared before pages had paths — `/#career`, `/#project/<slug>` —
  // still land where they pointed; the URL is rewritten to the path on arrival.
  const path = pathname === "/" && hash.length > 1 ? `/${hash.slice(1).replace(/^project\//, "projects/")}` : pathname;
  const project = PROJECT_PATH.exec(path);

  return project
    ? { pageId: projects.id, slug: decodeURIComponent(project[1] ?? "") }
    : { pageId: path.replace(/^\/|\/$/g, "") || intro.id, slug: null };
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
  const navigate = useNavigate();
  const start = useRef(readRoute());

  // A deep link means the visitor asked for a specific page, so the intro
  // curtain would only be in the way.
  const [phase, setPhase] = useState<Phase>(() => (start.current.pageId !== intro.id ? "ready" : "loading"));
  const mountedAt = useRef(Date.now());

  const [detail, setDetail] = useState<Detail | null>(() =>
    start.current.slug ? { slug: start.current.slug, open: true } : null,
  );
  const open = detail?.open ?? false;

  /*
   * The list belongs to the route rather than to the projects page: a link
   * straight to `/projects/<slug>` has to resolve that project before its card
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

  const openProject = useCallback(
    (slug: string) => {
      navigate(projectPath(slug));
      pushed.current = true;
      setDetail({ slug, open: true });
    },
    [navigate],
  );

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
   * The URL follows the page, so a reload or a link shared from here comes
   * back to it. Changing page replaces the entry rather than pushing one:
   * Back leaves the site, as it did before pages had paths. While a project
   * page is up the URL is that project's — pushed when it was opened, or
   * rewritten here from an old `#project/` link.
   *
   * Driven by the page and project only, never by the URL itself: Back
   * changes the URL before the project it left has closed, and syncing on
   * that would write the project's URL straight back over it.
   */
  const slug = detail?.open ? detail.slug : null;
  const syncUrl = useEffectEvent((target: string) => {
    const { pathname, search, hash } = window.location;
    if (pathname === target && !hash) return;

    navigate({ pathname: target, search }, { replace: true });
  });

  useEffect(() => {
    syncUrl(slug ? projectPath(slug) : pagePath(activeId));
  }, [slug, activeId]);

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

          {/* The rest run past one screen: the overview carries the repo belt
              under the profile, the career page its timeline and a card per
              product, and the projects page grows with each published case.
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
            id={career.id}
            label={career.label}
            role={pager.roleOf(career.id)}
            direction={pager.direction}
          >
            <Career onscreen={pager.roleOf(career.id) !== "hidden"} />
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

      {/* The rail names the pages of the stack, and the stack is not what is on
          screen while a project page is. */}
      <SideNav activeId={activeId} onSelect={goTo} hidden={open} />

      {phase !== "ready" && <Loader exiting={phase === "revealing"} onExited={finishReveal} />}
    </div>
  );
}
