import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { CareerProduct } from "server";

import { apiUrl } from "../lib/api";
import { cx } from "../lib/cx";
import { activeRange } from "./ActivityTimeline";
import styles from "./ProductCard.module.css";

/** Whether the product has anything for the back of its card: its description or its details. */
export function hasBack(product: CareerProduct): boolean {
  return Boolean(product.description) || product.highlights.length > 0 || product.stats.length > 0;
}

/**
 * Built on the Personal Work card: a 16:9 cover (the product's logo on the
 * raised surface), then title and dates, and the product's description. The
 * front of a card in the hand leaves the description off; the back of a played
 * card has it, with the details under it.
 */
export function CardFront({ product, description = true }: { product: CareerProduct; description?: boolean }) {
  const range = activeRange(product);

  return (
    <>
      <div className={styles.cover}>
        {product.logoUrl ? (
          <img className={styles.logo} src={apiUrl(product.logoUrl)} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.initials} aria-hidden="true">
            {product.name
              .split(/\s+/)
              .map((word) => word[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
        )}
      </div>

      <div className={styles.titleRow}>
        <h4 className={styles.title}>{product.name}</h4>
        {range && <span className={styles.range}>{range}</span>}
      </div>

      {description && product.description && <p className={styles.tagline}>{product.description}</p>}
    </>
  );
}

/** What I built on it: the highlights, and the stat chips at the foot. */
export function CardDetails({ product }: { product: CareerProduct }) {
  return (
    <>
      {product.highlights.length > 0 && (
        <ul className={styles.highlights}>
          {product.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      )}

      {product.stats.length > 0 && (
        <ul className={styles.tags}>
          {product.stats.map((stat) => (
            <li key={stat} className={styles.tag}>
              {stat}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type CardSurfaceProps = {
  product: CareerProduct;
  /** Opaque, for cards that overlap each other. */
  solid?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">;

/** The card itself: the Personal Work card's surface, border and hover, in the product's colour. */
export function CardSurface({ product, solid, className, children, style, ...rest }: CardSurfaceProps) {
  return (
    <article
      {...rest}
      className={cx(styles.card, solid && styles.solid, className)}
      style={{ "--accent": product.color, ...style } as CSSProperties}
    >
      {children}
    </article>
  );
}
