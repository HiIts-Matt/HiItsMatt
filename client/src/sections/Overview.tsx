import {
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { REVEAL_DELAY_MS } from "../components/ActivityTimeline";
import { tiltTowards, untilt } from "../components/CardHand";
import { productInitials } from "../components/ProductCard";
import { SectionTitle } from "../components/SectionTitle";
import { useSeen } from "../hooks/useSeen";
import { api, apiUrl, unwrap } from "../lib/api";
import { useCareer } from "./Career";
import { useContributions, useProfile } from "./GitHub";
import styles from "./Overview.module.css";
import { coverImage, useProjects } from "./Projects";
import { SECTION_META, pagePath, type SectionId } from "./sections";

const EMAIL = "hi.its.ma77@gmail.com";

/** How much of the row of cards has to scroll into view before it is dealt. */
const DEAL_THRESHOLD = 0.2;

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
  /** Its place in the row: the deal and the stagger go left to right. */
  index: number;
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
 *
 * Handled like the career page's cards: dealt in when the row is first seen,
 * lifted on a spring when pointed at, and leaning towards the pointer. The
 * slot carries the deal and the link the lift and lean, so the three compose.
 */
function EntryCard({ id, index, title, meta, onNavigate, children }: EntryCardProps) {
  const { number, label } = SECTION_META[id];

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(id);
  };

  return (
    <div className={styles.slot} style={{ "--i": index } as CSSProperties}>
      <a
        className={styles.entry}
        href={pagePath(id)}
        onClick={onClick}
        onPointerMove={tiltTowards}
        onPointerLeave={untilt}
      >
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
    </div>
  );
}

function Skeleton() {
  return <span className={styles.skeleton} />;
}

type ContactState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "error"; message: string };

/**
 * Name, email, message, sent to the API, which stores it and emails and texts
 * me. The browser checks the fields first; the server checks them again and
 * owns the rate limit, and its error messages are shown as they come.
 */
function ContactForm() {
  const [state, setState] = useState<ContactState>({ status: "idle" });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "");

    setState({ status: "sending" });
    try {
      await unwrap(
        api.contact.$post({
          json: { name: text("name"), email: text("email"), message: text("message"), website: text("website") },
        }),
        "Your message couldn't be sent",
      );
      setState({ status: "sent" });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  if (state.status === "sent") {
    return (
      <p className={styles.formSent} role="status">
        Thanks, your message is on its way. I’ll reply to the email address you gave.
      </p>
    );
  }

  const sending = state.status === "sending";

  return (
    <form className={styles.form} onSubmit={onSubmit} aria-busy={sending}>
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input className={styles.input} name="name" autoComplete="name" required maxLength={100} />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input className={styles.input} name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>

      <label className={`${styles.field} ${styles.fieldMessage}`}>
        <span className={styles.label}>Message</span>
        <textarea className={styles.input} name="message" rows={5} required maxLength={5000} />
      </label>

      {/* The honeypot: off screen and out of the tab order, so only a bot fills it in. */}
      <label className={styles.trap} aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      <div className={styles.formFoot}>
        <button className={styles.primary} type="submit" disabled={sending}>
          {sending ? "Sending…" : "Send message"}
        </button>
        <p className={styles.formNote}>Your IP address is kept for 30 days to stop spam.</p>
        {state.status === "error" && (
          <p className={styles.formError} role="alert">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * The homepage: who I am and how to reach me, then a card for each page
 * behind this one. The stack still reads front to back, but nobody has to —
 * each card jumps straight to its page, carrying a glimpse of what is there
 * (current role, project covers, a year of commits) so the choice is informed.
 *
 * `onscreen` is true from the moment the page starts arriving until it has
 * fully left; the cards are dealt the first time they scroll into view within
 * that, and gathered up again once the page has gone.
 */
export function Overview({ onNavigate, onscreen }: { onNavigate: (id: SectionId) => void; onscreen: boolean }) {
  const career = useCareer();
  const projects = useProjects();
  const profile = useProfile();
  const contributions = useContributions();
  // The page's own scroller, not the document: the Section this page renders in.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const layout = useCallback((node: HTMLDivElement | null) => setScroller(node?.closest("section") ?? null), []);
  const entries = useRef<HTMLElement>(null);
  const dealt = useSeen(entries, scroller, onscreen, DEAL_THRESHOLD);

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
    <div ref={layout} className={styles.layout}>
      <SectionTitle id="overview" />

      <div className={styles.about}>
        <p className={styles.summary}>
          I’m Matt, a full-stack developer in Melbourne working mostly in React, TypeScript and Node. By day I build
          fraud detection and compliance products at Docuscan, end to end from the UI down to Postgres and AWS; in my
          own time it’s a Raspberry Pi homelab, small tools like Claude Crab, and this site.
        </p>

        <div className={styles.details}>
          <a className={styles.primary} href={`mailto:${EMAIL}`}>
            {EMAIL}
          </a>
          <a className={styles.secondary} href="/cv.pdf" download>
            Download CV
          </a>
          <span className={styles.place}>
            Melbourne, AU · <MelbourneTime />
          </span>
        </div>
      </div>

      <section className={styles.group} aria-labelledby="overview-explore">
        <h3 id="overview-explore" className={styles.groupTitle}>
          Explore
        </h3>

        <nav
          ref={entries}
          className={styles.entries}
          aria-labelledby="overview-explore"
          data-dealt={dealt ? "true" : undefined}
          style={{ "--deal-delay": `${REVEAL_DELAY_MS}ms` } as CSSProperties}
        >
          <EntryCard
            id="career"
            index={0}
            title="Professional work"
            onNavigate={onNavigate}
            meta={current ? `${current.company} · ${products.length} products` : "Where I work, and what I built there"}
          >
            {career.status === "loading" && <Skeleton />}
            {current && (
              <>
                <span className={styles.lineStrong}>{current.role}</span>
                <span className={styles.logos}>
                  {products.slice(0, 4).map((product, index) => (
                    <span
                      key={product.id}
                      className={styles.logo}
                      style={{ "--accent": product.color, "--i": index } as CSSProperties}
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
            index={1}
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
            index={2}
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
      </section>

      <section className={styles.group} aria-labelledby="overview-contact">
        <h3 id="overview-contact" className={styles.groupTitle}>
          Contact me
        </h3>

        <ContactForm />
      </section>
    </div>
  );
}
