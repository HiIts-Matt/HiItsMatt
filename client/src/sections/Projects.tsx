import { useState } from "react";
import type { Project, ProjectEntry, ProjectGroup } from "server";

import { SectionTitle } from "../components/SectionTitle";
import { useResource, type Resource } from "../hooks/useResource";
import { api, apiUrl, unwrap } from "../lib/api";
import { cx } from "../lib/cx";
import styles from "./Projects.module.css";

/**
 * A still, even for clips: a grid of autoplaying videos is a lot of bytes for a
 * thumbnail, so a video only shows its cover if the manifest named a poster.
 */
function coverImage(project: Project): { url: string; alt: string } | null {
  for (const media of project.media) {
    const url = media.kind === "image" ? media.url : media.posterUrl;
    if (url) return { url, alt: media.alt ?? `${project.title} cover` };
  }

  return null;
}

type OpenProject = (slug: string) => void;

/**
 * The whole card is the target, but the link itself is the title: a block-level
 * anchor around a card full of other links is invalid, and one around the cover
 * alone would read as "image, link" to a screen reader. The title carries the
 * href and a stretched pseudo-element carries the hit area (see
 * `.open` in Projects.module.css); the links at the foot sit above it.
 */
function ProjectCard({ project, onOpen }: { project: Project; onOpen: OpenProject }) {
  const cover = coverImage(project);
  const updated = new Date(project.pushedAt).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

  return (
    <article className={styles.card}>
      {cover ? (
        <div className={styles.cover}>
          <img
            className={styles.media}
            src={apiUrl(cover.url)}
            alt={cover.alt}
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : (
        // A whitelisted repo publishes before its assets exist; say so quietly
        // instead of leaving a hole in the grid.
        <div className={cx(styles.cover, styles.coverEmpty)}>
          <span className={styles.coverInitials} aria-hidden="true">
            {project.title.slice(0, 2).toUpperCase()}
          </span>
          <span className={styles.coverHint}>No media yet</span>
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>
            <a
              className={styles.open}
              href={`#project/${project.slug}`}
              onClick={(event) => {
                // Modified clicks belong to the browser: a project page is a
                // real URL, so opening one in a new tab has to keep working.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onOpen(project.slug);
              }}
            >
              {project.title}
            </a>
          </h3>
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

        {/* Pushed to the bottom of the card so every row of links lines up. */}
        <div className={styles.links}>
          {project.homepage && (
            <a
              className={styles.linkPrimary}
              href={project.homepage}
              target="_blank"
              rel="noreferrer"
            >
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
 * A group has no repository and therefore no manifest: its cover, languages and
 * last-touched date are all read off its members, and clicking it opens them in
 * a full-width row beneath the card rather than navigating anywhere. Its
 * members are ordinary cards once open, so each one opens its own page.
 */
function GroupCard({ group, onOpen }: { group: ProjectGroup; onOpen: OpenProject }) {
  const [open, setOpen] = useState(false);
  const panelId = `group-${group.slug}`;

  const cover = group.projects.map(coverImage).find((entry) => entry !== null) ?? null;
  const languages = [
    ...new Set(group.projects.flatMap((project) => (project.language ? [project.language] : []))),
  ];
  const latest = group.projects.reduce(
    (newest, project) => (project.pushedAt > newest ? project.pushedAt : newest),
    group.projects[0]?.pushedAt ?? "",
  );
  const updated = new Date(latest).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
  // A group can be down to one visible member while the others are private and
  // skipped, so the count is written rather than assumed plural.
  const count = `${group.projects.length} repo${group.projects.length === 1 ? "" : "s"}`;

  return (
    <>
      <button
        type="button"
        className={cx(styles.card, styles.groupCard, open && styles.groupCardOpen)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {cover ? (
          <div className={styles.cover}>
            <img
              className={styles.media}
              src={apiUrl(cover.url)}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div className={cx(styles.cover, styles.coverEmpty)}>
            <span className={styles.coverInitials} aria-hidden="true">
              {group.title.slice(0, 2).toUpperCase()}
            </span>
            <span className={styles.coverHint}>{count}</span>
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.titleRow}>
            <h3 className={styles.title}>{group.title}</h3>
            <span className={styles.year}>{count}</span>
          </div>

          <p className={styles.tagline}>
            {group.projects.map((project) => project.title).join(" · ")}
          </p>

          <div className={styles.meta}>
            {languages.map((language) => (
              <span key={language} className={styles.metaItem}>
                <span className={styles.languageDot} />
                {language}
              </span>
            ))}
            <span className={styles.metaItem}>Updated {updated}</span>
          </div>

          <span className={styles.links}>
            <span className={styles.linkPrimary}>
              {open ? "Hide repos" : `Show ${count}`}
            </span>
          </span>
        </div>
      </button>

      {open && (
        // Spans the whole grid, so it lands on its own row directly under the
        // card's row instead of squeezing into one column.
        <div id={panelId} className={styles.groupPanel}>
          {group.projects.map((project) => (
            <ProjectCard key={project.slug} project={project} onOpen={onOpen} />
          ))}
        </div>
      )}
    </>
  );
}

/** The published list, exactly as the API returns it. */
export type ProjectList = { entries: ProjectEntry[] };

export type ProjectsResource = Resource<ProjectList>;

/**
 * The list of published projects. Exported because the route owns it: a link
 * to one project's page has to resolve that project whether or not this
 * section has ever been on screen, and two `useResource` calls would be two
 * fetches of the same list.
 */
export function useProjects(): ProjectsResource {
  return useResource<ProjectList>("projects", () =>
    unwrap(api.github.projects.$get(), "Could not load the projects"),
  );
}

type ProjectsProps = {
  projects: ProjectsResource;
  onOpen: OpenProject;
};

/**
 * The curated half of the site: repositories named in the server's PROJECT_REPOS
 * whitelist, on the same measure as the overview so the two sections read as one
 * column. Each card is a cover plus the metadata from the repo's `.portfolio`
 * manifest, and opens the project's own page — the full media set and the
 * write-up live there. Distinct from the overview's carousel, which lists every
 * public repo automatically and links straight out to GitHub.
 */
export function Projects({ projects, onOpen }: ProjectsProps) {
  return (
    <div className={styles.layout}>
      <SectionTitle id="projects" />

      {projects.status === "error" && <p className={styles.notice}>{projects.message}</p>}

      {projects.status === "loading" && (
        <div className={styles.cards}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonCard} />
          ))}
        </div>
      )}

      {projects.status === "ready" && projects.data.entries.length === 0 && (
        <p className={styles.notice}>No projects are published yet.</p>
      )}

      {projects.status === "ready" && projects.data.entries.length > 0 && (
        <div className={styles.cards}>
          {projects.data.entries.map((entry) =>
            entry.kind === "group" ? (
              <GroupCard key={`group-${entry.group.slug}`} group={entry.group} onOpen={onOpen} />
            ) : (
              <ProjectCard key={entry.project.slug} project={entry.project} onOpen={onOpen} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
