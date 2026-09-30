import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useState } from "react";

import { productInitials } from "../components/ProductCard";
import { SectionTitle } from "../components/SectionTitle";
import { apiUrl } from "../lib/api";
import { useCareer } from "./Career";
import { useContributions, useProfile } from "./GitHub";
import styles from "./Overview.module.css";
import { coverImage, useProjects } from "./Projects";
import { SECTION_META, pagePath, type SectionId } from "./sections";

const EMAIL = "hi.its.ma77@gmail.com";

// en-AU names the zone the way people there do: AEST in winter, AEDT in summer.
const melbourneTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Melbourne",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** The time where I am, so "can we work together" has half its answer up front. */
function MelbourneTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Ticks on the minute, not a minute after the page happened to load.
    let interval = 0;
    const timeout = window.setTimeout(
      () => {
        setNow(new Date());
        interval = window.setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  return <time dateTime={now.toISOString()}>{melbourneTime.format(now)}</time>;
}

type EntryCardProps = {
  id: SectionId;
  title: string;
  /** The foot of the card: a count, a date, one fact about what is behind it. */
  meta: ReactNode;
  onNavigate: (id: SectionId) => void;
  children: ReactNode;
};

/**
 * A way into one of the pages behind this one, so a visitor who reads only
 * this page still sees everything there is. It is a real link: a plain click
 * jumps there with the same handover as the side nav, and a modified click
 * opens the page's own URL in a new tab.
 */
function EntryCard({ id, title, meta, onNavigate, children }: EntryCardProps) {
  const { number, label } = SECTION_META[id];

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(id);
  };

  return (
    <a className={styles.entry} href={pagePath(id)} onClick={onClick}>
      <span className={styles.entryIndex}>
        {number} | {label}
      </span>
      <span className={styles.entryTitle}>{title}</span>
      <span className={styles.glimpse}>{children}</span>
      <span className={styles.entryMeta}>
        <span>{meta}</span>
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
      </span>
    </a>
  );
}

function Skeleton() {
  return <span className={styles.skeleton} />;
}

/**
 * The homepage: who I am and how to reach me, then a card for each page
 * behind this one. The stack still reads front to back, but nobody has to —
 * each card jumps straight to its page, carrying a glimpse of what is there
 * (current role, project covers, a year of commits) so the choice is informed.
 */
export function Overview({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const career = useCareer();
  const projects = useProjects();
  const profile = useProfile();
  const contributions = useContributions();

  const jobs = career.status === "ready" ? career.data.jobs : [];
  // The job still running; newest first, so failing that, the latest one.
  const current = jobs.find((job) => !job.end) ?? jobs[0];
  const products = current?.products.filter((product) => product.card) ?? [];

  const projectList =
    projects.status === "ready"
      ? projects.data.entries.flatMap((entry) => (entry.kind === "group" ? entry.group.projects : [entry.project]))
      : [];
  const covers = projectList
    .map((project) => coverImage(project))
    .filter((cover) => cover !== null)
    .slice(0, 3);

  return (
    <div className={styles.layout}>
      <SectionTitle id="overview" />

      <div className={styles.about}>
        <p className={styles.lead}>
          Software engineer in Melbourne, building document and compliance products at Docuscan.
        </p>

        <div className={styles.details}>
          <ul className={styles.facts}>
            <li className={styles.available}>Open to freelance / contract</li>
            <li>
              Melbourne, AU · <MelbourneTime />
            </li>
          </ul>

          <a className={styles.primary} href={`mailto:${EMAIL}`}>
            {EMAIL}
          </a>
          <a className={styles.secondary} href="/cv.pdf" download>
            Download CV
          </a>
        </div>
      </div>

      <nav className={styles.entries} aria-label="Where to next">
        <EntryCard
          id="career"
          title="Professional work"
          onNavigate={onNavigate}
          meta={current ? `${current.company} · ${products.length} products` : "Where I work, and what I built there"}
        >
          {career.status === "loading" && <Skeleton />}
          {current && (
            <>
              <span className={styles.lineStrong}>{current.role}</span>
              <span className={styles.logos}>
                {products.slice(0, 4).map((product) => (
                  <span
                    key={product.id}
                    className={styles.logo}
                    style={{ "--accent": product.color } as CSSProperties}
                    title={product.name}
                  >
                    {product.logoUrl ? (
                      <img src={apiUrl(product.logoUrl)} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span className={styles.initials}>{productInitials(product.name)}</span>
                    )}
                  </span>
                ))}
              </span>
            </>
          )}
        </EntryCard>

        <EntryCard
          id="projects"
          title="Personal projects"
          onNavigate={onNavigate}
          meta={projects.status === "ready" ? `${projectList.length} projects` : "Things I build in my own time"}
        >
          {projects.status === "loading" && <Skeleton />}
          {covers.length > 0 && (
            <span className={styles.covers}>
              {covers.map((cover, index) => (
                <img
                  key={cover.url}
                  className={styles.cover}
                  style={{ "--i": index } as CSSProperties}
                  src={apiUrl(cover.url)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </span>
          )}
          {projectList.length > 0 && (
            <span className={styles.line}>
              {projectList
                .slice(0, 3)
                .map((project) => project.title)
                .join(" · ")}
            </span>
          )}
        </EntryCard>

        <EntryCard
          id="github"
          title="GitHub"
          onNavigate={onNavigate}
          meta={profile.status === "ready" ? `${profile.data.publicRepos} public repos` : "Everything public, live"}
        >
          {contributions.status === "loading" && <Skeleton />}
          {contributions.status === "ready" && (
            <>
              <span className={styles.figure}>{contributions.data.total.toLocaleString()}</span>
              <span className={styles.line}>contributions in the last year</span>
            </>
          )}
        </EntryCard>
      </nav>
    </div>
  );
}
