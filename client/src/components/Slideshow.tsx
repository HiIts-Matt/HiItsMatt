import { useEffect, useState } from "react";
import type { ProjectMedia } from "server";

import { apiUrl } from "../lib/api";
import { cx } from "../lib/cx";
import styles from "./Slideshow.module.css";

type SlideshowProps = {
  /** Manifest order, cover first. Empty sets are the caller's to skip. */
  media: readonly ProjectMedia[];
  /** Names the region, and stands in for a missing alt text. */
  title: string;
};

/**
 * The browsable head of a project's page: one frame at a time, with a strip of
 * thumbnails under it.
 *
 * `contain`, not `cover`: a card crops its cover to a fixed frame because a row
 * of cards has to line up, but this is the place the asset is actually looked
 * at, so the whole of it is shown whatever its shape.
 *
 * Videos are never autoplayed. A case study opens with the visitor reading, and
 * a clip that starts talking over that is an interruption; the player is there
 * when they want it.
 */
export function Slideshow({ media, title }: SlideshowProps) {
  const [index, setIndex] = useState(0);
  const count = media.length;
  const position = Math.min(index, count - 1);
  const current = media[position];

  /*
   * Left and right are free: the pager reads the vertical keys and the page
   * scroller takes the rest, so nothing else on screen wants these two. A
   * focused video keeps them, though — there they seek.
   */
  useEffect(() => {
    if (count < 2) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, video, [contenteditable]")) return;

      event.preventDefault();
      setIndex((at) => (at + step + count) % count);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [count]);

  if (!current) return null;

  const step = (by: number) => setIndex((at) => (at + by + count) % count);

  return (
    <section className={styles.show} aria-label={`${title} media`}>
      <div className={styles.frame}>
        {current.kind === "video" ? (
          <video
            // A new element per slide: reusing one player would carry the
            // previous clip's playback position and buffered data into it.
            key={current.url}
            className={styles.asset}
            src={apiUrl(current.url)}
            poster={current.posterUrl ? apiUrl(current.posterUrl) : undefined}
            controls
            playsInline
            preload="metadata"
            aria-label={current.alt ?? `${title} clip ${position + 1}`}
          />
        ) : (
          <img
            key={current.url}
            className={styles.asset}
            src={apiUrl(current.url)}
            alt={current.alt ?? `${title} screenshot ${position + 1}`}
            // The first frame is the page's lead image and is worth the eager
            // fetch; the rest arrive as they are browsed to.
            loading={position === 0 ? "eager" : "lazy"}
            decoding="async"
          />
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              className={cx(styles.arrow, styles.prev)}
              onClick={() => step(-1)}
              aria-label="Previous image"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className={cx(styles.arrow, styles.next)}
              onClick={() => step(1)}
              aria-label="Next image"
            >
              <span aria-hidden="true">›</span>
            </button>
            <span className={styles.counter} aria-hidden="true">
              {position + 1} / {count}
            </span>
          </>
        )}
      </div>

      {/* Reserved whether or not this slide has a caption: without it the body
          below jumps up and down as the visitor steps through. */}
      <p className={styles.caption}>{current.caption ?? "\u00a0"}</p>

      {count > 1 && (
        <ul className={styles.thumbs}>
          {media.map((item, at) => {
            const thumb = item.kind === "image" ? item.url : item.posterUrl;

            return (
              <li key={item.url}>
                <button
                  type="button"
                  className={cx(styles.thumb, at === position && styles.thumbCurrent)}
                  aria-label={`Show ${at + 1} of ${count}`}
                  aria-current={at === position ? "true" : undefined}
                  onClick={() => setIndex(at)}
                >
                  {thumb ? (
                    <img
                      className={styles.thumbImage}
                      src={apiUrl(thumb)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    // A clip whose manifest names no poster: GitHub will not
                    // render a frame for us, so the strip says what it is.
                    <span className={styles.thumbGlyph} aria-hidden="true">
                      ▶
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
