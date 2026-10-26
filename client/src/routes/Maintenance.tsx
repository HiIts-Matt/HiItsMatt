import { Loader } from "../components/Loader";
import { Section } from "../components/Section";
import { useCurtain } from "../hooks/useCurtain";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { Intro } from "../sections/Intro";
import { IntroBackdrop } from "../sections/IntroBackdrop";
import { SECTION_META } from "../sections/sections";
import styles from "./Maintenance.module.css";

const { intro } = SECTION_META;

/**
 * The whole site while MAINTENANCE is on: the intro exactly as the landing
 * page opens on it, curtain and all, with a notice where the scroll cue was.
 * One page and no rail, so there is nothing to navigate to and nothing that
 * requests data from the API.
 */
export function Maintenance() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { phase, onBackdropReady, onExited } = useCurtain({
    skip: false,
    reducedMotion: prefersReducedMotion,
  });

  return (
    <>
      <div className={styles.stage}>
        <Section
          id={intro.id}
          label={intro.label}
          role="current"
          direction={null}
          centered
          backdrop={<IntroBackdrop onReady={onBackdropReady} />}
        >
          <Intro revealed={phase === "ready"} notice="Sorry, down for maintenance. Back soon." />
        </Section>
      </div>

      {phase !== "ready" && <Loader exiting={phase === "revealing"} onExited={onExited} />}
    </>
  );
}
