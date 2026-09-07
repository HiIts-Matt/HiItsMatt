import { ContributionGraph } from "../components/ContributionGraph";
import { LanguageBar } from "../components/LanguageBar";
import { RepoCarousel } from "../components/RepoCarousel";
import { SectionTitle } from "../components/SectionTitle";
import { useResource } from "../hooks/useResource";
import { api, unwrap } from "../lib/api";
import styles from "./Overview.module.css";

export function Overview() {
  const profile = useResource("profile", () =>
    unwrap(api.github.profile.$get(), "Could not load the GitHub profile"),
  );
  const languages = useResource("languages", () =>
    unwrap(api.github.languages.$get(), "Could not load the language breakdown"),
  );
  const contributions = useResource("contributions", () =>
    unwrap(api.github.contributions.$get(), "Could not load the contribution graph"),
  );

  return (
    <div className={styles.layout}>
      <SectionTitle id="overview" className={styles.header} />

      <div className={styles.columns}>
        <article className={styles.card}>
          {profile.status === "loading" && (
            <>
              <div className={styles.skeleton} style={{ height: "76px", borderRadius: "12px" }} />
              <div className={styles.skeleton} />
              <div className={styles.skeleton} style={{ width: "70%" }} />
            </>
          )}

          {profile.status === "error" && <p className={styles.notice}>{profile.message}</p>}

          {profile.status === "ready" && (
            <>
              <div className={styles.identity}>
                <img
                  className={styles.avatar}
                  src={profile.data.avatarUrl}
                  alt=""
                  width={96}
                  height={96}
                  loading="lazy"
                  decoding="async"
                />
                <div>
                  <h3 className={styles.name}>{profile.data.name ?? profile.data.login}</h3>
                  <p className={styles.login}>@{profile.data.login}</p>
                </div>
              </div>

              {profile.data.bio && <p className={styles.bio}>{profile.data.bio}</p>}

              <div className={styles.meta}>
                {profile.data.location && <span className={styles.chip}>{profile.data.location}</span>}
                {profile.data.company && <span className={styles.chip}>{profile.data.company}</span>}
                <span className={styles.chip}>
                  On GitHub since {new Date(profile.data.createdAt).getFullYear()}
                </span>
              </div>

              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{profile.data.publicRepos}</span>
                  <span className={styles.statLabel}>Repos</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{profile.data.followers}</span>
                  <span className={styles.statLabel}>Followers</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>
                    {contributions.status === "ready"
                      ? contributions.data.total.toLocaleString()
                      : "—"}
                  </span>
                  <span className={styles.statLabel}>Commits/yr</span>
                </div>
              </div>

              <a
                className={styles.profileLink}
                href={profile.data.htmlUrl}
                target="_blank"
                rel="noreferrer"
              >
                View profile on GitHub
              </a>
            </>
          )}
        </article>

        <div className={styles.stack}>
          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Languages by volume</h3>
            {languages.status === "loading" && <div className={styles.skeleton} />}
            {languages.status === "error" && <p className={styles.notice}>{languages.message}</p>}
            {languages.status === "ready" && <LanguageBar languages={languages.data.languages} />}
          </article>

          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Contributions</h3>
            {contributions.status === "loading" && <div className={styles.skeleton} />}
            {contributions.status === "error" && (
              <p className={styles.notice}>{contributions.message}</p>
            )}
            {contributions.status === "ready" && (
              <ContributionGraph
                weeks={contributions.data.weeks}
                total={contributions.data.total}
              />
            )}
          </article>
        </div>
      </div>

      {/* The automatic index of everything public, directly under the profile it
          belongs to. Curated work lives one section further down. */}
      <section className={styles.belt} aria-label="Public repositories">
        <div className={styles.beltHeader}>
          <h3 className={styles.cardTitle}>Every public repository</h3>
          <p className={styles.beltHint}>Hover to pause</p>
        </div>

        <RepoCarousel />
      </section>
    </div>
  );
}
