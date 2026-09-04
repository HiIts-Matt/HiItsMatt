import { useState } from "react";
import type { CSSProperties } from "react";
import type { Repo } from "server";

import { useResource } from "../hooks/useResource";
import { api, unwrap } from "../lib/api";
import styles from "./Projects.module.css";

/** Seconds each card spends crossing the viewport. */
const SECONDS_PER_CARD = 7;

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

export function Projects() {
  const repos = useResource("repos", () =>
    unwrap(api.github.repos.$get(), "Could not load repositories"),
  );

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>03 — Projects</p>
        <h2 className={styles.heading}>
          Public repositories
        </h2>
      </header>

      {repos.status === "error" && <p className={styles.notice}>{repos.message}</p>}

      {repos.status === "loading" && (
        <div className={styles.viewport}>
          <div className={styles.track} style={{ animation: "none" }}>
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className={styles.skeletonCard} />
            ))}
          </div>
        </div>
      )}

      {repos.status === "ready" && repos.data.repos.length > 0 && (
        <div className={styles.viewport}>
          <div
            className={styles.track}
            style={
              { "--duration": `${repos.data.repos.length * SECONDS_PER_CARD}s` } as CSSProperties
            }
          >
            {repos.data.repos.map((repo) => (
              <RepoCard key={repo.fullName} repo={repo} hidden={false} />
            ))}
            {repos.data.repos.map((repo) => (
              <RepoCard key={`clone-${repo.fullName}`} repo={repo} hidden />
            ))}
          </div>
        </div>
      )}

      {repos.status === "ready" && repos.data.repos.length === 0 && (
        <p className={styles.notice}>No public repositories found for this account.</p>
      )}
    </div>
  );
}
