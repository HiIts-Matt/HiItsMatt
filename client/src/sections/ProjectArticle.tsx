import { useEffect, useRef } from "react";
import type { Project } from "server";

import { Slideshow } from "../components/Slideshow";
import { useResource } from "../hooks/useResource";
import { api, unwrap } from "../lib/api";
import styles from "./ProjectArticle.module.css";

type ProjectArticleProps = {
  /** From the URL, so the article can load before the projects list has. */
  slug: string;
  /** null until the list resolves, and for a slug it does not contain. */
  project: Project | null;
  /** The list is still loading, so a missing project is not yet a missing page. */
  pending: boolean;
  onClose: () => void;
};

/**
 * One project's own page: the sub-page the projects grid opens into.
 *
 * Reading order is the layout: what it looks like, what it is, then the facts
 * about it. The media leads, the article body carries the story, and the
 * metadata sits in a column beside it — none of it is worth a screen of its
 * own, and a sidebar is where a reader already looks for it.
 */
export function ProjectArticle({ slug, project, pending, onClose }: ProjectArticleProps) {
  const article = useResource(`article:${slug}`, () =>
    unwrap(
      api.github.projects[":slug"].article.$get({ param: { slug } }),
      "Could not load this project's write-up",
    ),
  );

  // Escape is what closes an overlay, and this one is an overlay in every way
  // except that it is opaque.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /*
   * Keyboard scrolling belongs to whichever scroller holds focus, and the one
   * that had it is now inert behind this page. Focus lands on the scroller
   * rather than on the back button: a click that opened the page should not
   * arm Enter to close it again.
   */
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.focus({ preventScroll: true });
  }, []);

  const updated = project
    ? new Date(project.pushedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className={styles.scroller} ref={scroller} tabIndex={-1}>
      <div className={styles.layout}>
        <header className={styles.header}>
          <button type="button" className={styles.back} onClick={onClose}>
            <span aria-hidden="true">←</span> Personal Work
          </button>

          <h1 className={styles.title}>{project?.title ?? slug}</h1>
          {project?.tagline && <p className={styles.tagline}>{project.tagline}</p>}
        </header>

        {!project && pending && <div className={styles.skeleton} />}

        {!project && !pending && (
          <p className={styles.notice}>
            No published project is named &ldquo;{slug}&rdquo;. It may have been unlisted since
            this link was made.
          </p>
        )}

        {project && (
          <div className={styles.columns}>
            <div className={styles.main}>
              {project.media.length > 0 && (
                // Keyed by project: a different set of assets starts at its
                // own first frame rather than at the index left behind.
                <Slideshow key={project.slug} media={project.media} title={project.title} />
              )}

              {article.status === "loading" && <div className={styles.skeletonText} />}

              {article.status === "error" && <p className={styles.notice}>{article.message}</p>}

              {article.status === "ready" && article.data.html && (
                /*
                 * The server renders this markdown with raw HTML escaped rather
                 * than passed through (see server/src/github/article.ts), so
                 * the only markup here is the renderer's own. That is the whole
                 * reason this is safe without a sanitiser in the browser.
                 */
                <div
                  className={styles.prose}
                  dangerouslySetInnerHTML={{ __html: article.data.html }}
                />
              )}

              {article.status === "ready" && !article.data.html && (
                <div className={styles.prose}>
                  {project.summary ? (
                    <p>{project.summary}</p>
                  ) : (
                    // Visitor-facing, so it says what is missing rather than
                    // which file would supply it.
                    <p className={styles.notice}>No write-up for this one yet.</p>
                  )}
                </div>
              )}
            </div>

            <aside className={styles.sidebar} aria-label={`About ${project.title}`}>
              <h2 className={styles.sidebarTitle}>About</h2>

              {project.summary && article.status === "ready" && article.data.html && (
                <p className={styles.summary}>{project.summary}</p>
              )}

              <dl className={styles.facts}>
                {project.status && (
                  <div className={styles.fact}>
                    <dt>Status</dt>
                    <dd>{project.status}</dd>
                  </div>
                )}
                {project.year && (
                  <div className={styles.fact}>
                    <dt>Year</dt>
                    <dd>{project.year}</dd>
                  </div>
                )}
                {project.language && (
                  <div className={styles.fact}>
                    <dt>Language</dt>
                    <dd>
                      <span className={styles.languageDot} />
                      {project.language}
                    </dd>
                  </div>
                )}
                {project.stars > 0 && (
                  <div className={styles.fact}>
                    <dt>Stars</dt>
                    <dd>★ {project.stars}</dd>
                  </div>
                )}
                <div className={styles.fact}>
                  <dt>Updated</dt>
                  <dd>{updated}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Repository</dt>
                  <dd>{project.isPrivate ? "Private" : "Public"}</dd>
                </div>
              </dl>

              {project.tags.length > 0 && (
                <ul className={styles.tags}>
                  {project.tags.map((tag) => (
                    <li key={tag} className={styles.tag}>
                      {tag}
                    </li>
                  ))}
                </ul>
              )}

              {(project.homepage || project.htmlUrl || project.links.length > 0) && (
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
                    <a
                      className={styles.link}
                      href={project.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source
                    </a>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
