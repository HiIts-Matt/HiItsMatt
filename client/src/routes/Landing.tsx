import { useCallback, useEffect, useRef, useState } from "react";

import { Loader } from "../components/Loader";
import { Section } from "../components/Section";
import { SideNav } from "../components/SideNav";
import { scrollToSection, useActiveSection } from "../hooks/useActiveSection";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { Intro } from "../sections/Intro";
import { Overview } from "../sections/Overview";
import { Projects } from "../sections/Projects";
import { SECTIONS, SECTION_IDS } from "../sections/sections";

const [intro, overview, projects] = SECTIONS;

/** Below this the curtain feels like a flash rather than a transition. */
const MIN_CURTAIN_MS = 650;
/** Hard release: WebGL can be unavailable or the chunk can fail to load. */
const MAX_CURTAIN_MS = 5000;
/** Backstop in case `transitionend` never arrives (background tab, no compositor). */
const SLIDE_TIMEOUT_MS = 1200;

type Phase = "loading" | "revealing" | "ready";

export function Landing() {
  const activeId = useActiveSection(SECTION_IDS);
  const prefersReducedMotion = usePrefersReducedMotion();

  // A deep link means the visitor asked for a specific section, so the intro
  // curtain would only be in the way — and locking scroll would fight the jump.
  const [phase, setPhase] = useState<Phase>(() =>
    window.location.hash.slice(1) ? "ready" : "loading",
  );
  const mountedAt = useRef(Date.now());

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
    const id = window.location.hash.slice(1);
    if (id && SECTION_IDS.some((sectionId) => sectionId === id)) scrollToSection(id);
  }, []);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(beginReveal, MAX_CURTAIN_MS);
    return () => window.clearTimeout(timer);
  }, [phase, beginReveal]);

  // The curtain covers the viewport, so scrolling behind it would silently move
  // the page to a section the visitor never saw.
  useEffect(() => {
    if (phase === "ready") return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealing") return;
    const timer = window.setTimeout(() => setPhase("ready"), SLIDE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const finishReveal = useCallback(() => setPhase("ready"), []);

  return (
    <>
      <Section id={intro.id} label={intro.label} centered>
        <Intro revealed={phase === "ready"} onBackdropReady={handleBackdropReady} />
      </Section>

      <Section id={overview.id} label={overview.label}>
        <Overview />
      </Section>

      <Section id={projects.id} label={projects.label}>
        <Projects />
      </Section>

      <SideNav activeId={activeId} />

      {phase !== "ready" && <Loader exiting={phase === "revealing"} onExited={finishReveal} />}
    </>
  );
}
