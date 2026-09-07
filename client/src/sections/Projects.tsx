import { useState } from "react";
import type { Project, ProjectMedia } from "server";

import { SectionTitle } from "../components/SectionTitle";
import { useResource } from "../hooks/useResource";
import { api, apiUrl, unwrap } from "../lib/api";
import { cx } from "../lib/cx";
import styles from "./Projects.module.css";

function MediaFrame({ media, title }: { media: ProjectMedia; title: string }) {
  if (media.kind === "video") {
    return (
      <video
        className={styles.media}
        src={apiUrl(media.url)}
        poster={media.posterUrl ? apiUrl(media.posterUrl) : undefined}
        controls
        playsInline
        // Videos are streamed through the API; only load the first frames until
        // someone actually presses play.
        preload="metadata"
      />
    );
  }

  return (
    <img
      className={styles.media}
      src={apiUrl(media.url)}
      alt={media.alt ?? `${title} screenshot`}
      loading="lazy"
      decoding="async"
    />
  );
}

function ProjectCase({ project }: { project: Project }) {
  const [index, setIndex] = useState(0);
  const active = project.media[index];

  const updated = new Date(project.pushedAt).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

  return (
    <article className={styles.case}>
      <div className={styles.gallery}>
        {active ? (
          <>
            <div className={styles.frame}>
              <MediaFrame media={active} title={project.title} />
            </div>

            {active.caption && <p className={styles.caption}>{active.caption}</p>}

            {project.media.length > 1 && (
              <div className={styles.thumbs}>
                {project.media.map((media, position) => {
                  const poster = media.kind === "image" ? media.url : media.posterUrl;

                  return (
                    <button
                      key={media.url}
                      type="button"
                      className={cx(styles.thumb, position === index && styles.thumbActive)}
                      aria-label={`Show ${project.title} media ${position + 1} of ${project.media.length}`}
                      aria-current={position === index ? "true" : undefined}
                      onClick={() => setIndex(position)}
                    >
                      {poster ? (
                        <img src={apiUrl(poster)} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className={styles.thumbGlyph} aria-hidden="true">
                          ▶
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          // A whitelisted repo publishes before its assets exist; say so quietly
          // instead of leaving a hole in the layout.
          <div className={cx(styles.frame, styles.frameEmpty)}>
            <span className={styles.frameInitials} aria-hidden="true">
              {project.title.slice(0, 2).toUpperCase()}
            </span>
            <span className={styles.frameHint}>No media yet</span>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{project.title}</h3>
          {project.year && <span className={styles.year}>{project.year}</span>}
        </div>

        {project.tagline && <p className={styles.tagline}>{project.tagline}</p>}
        {project.summary && <p className={styles.summary}>{project.summary}</p>}

        {project.tags.length > 0 && (
          <ul className={styles.tags}>
            {project.tags.map((tag) => (
              <li key={tag} className={styles.tag}>
                {tag}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.meta}>
          {project.language && (
            <span className={styles.metaItem}>
              <span className={styles.languageDot} />
              {project.language}
            </span>
          )}
          {project.status && <span className={styles.metaItem}>{project.status}</span>}
          {project.isPrivate && <span className={styles.metaItem}>Private repo</span>}
          {project.stars > 0 && <span className={styles.metaItem}>★ {project.stars}</span>}
          <span className={styles.metaItem}>Updated {updated}</span>
        </div>

        <div className={styles.links}>
          {project.homepage && (
            <a className={styles.linkPrimary} href={project.homepage} target="_blank" rel="noreferrer">
              Visit
            </a>
          )}
          {project.links.map((link) => (
            <a
              key={link.url}
              className={styles.link}
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </a>
          ))}
          {project.htmlUrl && (
            <a className={styles.link} href={project.htmlUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The curated half of the site: repositories named in the server's PROJECT_REPOS
 * whitelist, presented with the images and clips committed to each one under
 * `.portfolio/`. Distinct from the overview's carousel, which lists every public
 * repo automatically and links straight out to GitHub.
 */
export function Projects() {
  const projects = useResource("projects", () =>
    unwrap(api.github.projects.$get(), "Could not load the projects"),
  );

  return (
    <div className={styles.layout}>
      <SectionTitle id="projects" />

      {projects.status === "error" && <p className={styles.notice}>{projects.message}</p>}

      {projects.status === "loading" && (
        <div className={styles.cases}>
          {[0, 1].map((index) => (
            <div key={index} className={styles.skeletonCase} />
          ))}
        </div>
      )}

      {projects.status === "ready" && projects.data.projects.length === 0 && (
        <p className={styles.notice}>No projects are published yet.</p>
      )}

      {projects.status === "ready" && projects.data.projects.length > 0 && (
        <div className={styles.cases}>
          {projects.data.projects.map((project) => (
            <ProjectCase key={project.slug} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
