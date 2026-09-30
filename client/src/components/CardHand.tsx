import { type CSSProperties, type PointerEvent, type Ref } from "react";
import type { CareerProduct } from "server";

import { REVEAL_DELAY_MS } from "./ActivityTimeline";
import styles from "./CardHand.module.css";
import { CardDetails, CardFront, CardSurface, hasBack } from "./ProductCard";

type CardHandProps = {
  /** Who the cards belong to, for the hand's accessible name. */
  label: string;
  products: CareerProduct[];
  /** In the player's hand. False keeps every card out of it, waiting to be dealt. */
  shown: boolean;
  /** Pointed at, here or on the timeline: straightens and lifts. */
  active: string | null;
  /** Clicked: out of the hand, centred at its top and flipped. */
  selected: string | null;
  /** How much bigger the played card gets (1–1.5); the hand grows to hold it. */
  grow: number;
  onActive: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  ref?: Ref<HTMLDivElement>;
};

/**
 * `left`/`right` part around the raised card while the hand is held;
 * `before`/`after` stack either side of a played card, clear of it.
 */
type SlotState = "rest" | "raised" | "left" | "right" | "selected" | "before" | "after";

/**
 * Follows the pointer across a raised card: a few degrees of tilt towards it,
 * as if the card were being held up to look at. Written straight to the
 * element — it changes every pointer move, which is no reason to re-render.
 */
function tiltTowards(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget;
  const box = element.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width - 0.5;
  const y = (event.clientY - box.top) / box.height - 0.5;
  element.style.setProperty("--ry", `${(x * 12).toFixed(2)}deg`);
  element.style.setProperty("--rx", `${(-y * 10).toFixed(2)}deg`);
}

function untilt(event: PointerEvent<HTMLElement>) {
  event.currentTarget.style.removeProperty("--ry");
  event.currentTarget.style.removeProperty("--rx");
}

/**
 * An employer's products, held like a hand of cards under its timeline:
 * fanned on an arc, covers showing. Pointing at one (or at its row on the
 * timeline) straightens and lifts it and parts the others around it; clicking
 * one plays it — out of the hand, grown and turned over to show what I built
 * on it, right under the graph it is read against — and the rest move aside
 * to either side of it, where they can still be pointed at and played.
 *
 * An ordinary block in the page: it scrolls with everything else, and is as
 * tall as the fan (or the played card) needs.
 */
export function CardHand({ label, products, shown, active, selected, grow, onActive, onSelect, ref }: CardHandProps) {
  if (products.length === 0) {
    return null;
  }

  const played = products.findIndex((product) => product.id === selected);
  // The card the others make room for: the pointed-at one, unless a card is
  // out of the hand — then the others are already clear of it and it only lifts.
  const raised = played === -1 ? products.findIndex((product) => product.id === active) : -1;

  const stateOf = (index: number): SlotState => {
    if (played !== -1) {
      if (index === played) return "selected";
      return index < played ? "before" : "after";
    }
    if (index === raised) return "raised";
    if (raised === -1) return "rest";
    return index < raised ? "left" : "right";
  };

  return (
    <div
      ref={ref}
      className={styles.hand}
      role="list"
      aria-label={`${label}: products`}
      data-shown={shown ? "true" : undefined}
      data-played={selected ? "true" : undefined}
      style={
        {
          "--n": products.length,
          "--played": Math.max(played, 0),
          "--deal-delay": `${REVEAL_DELAY_MS}ms`,
          "--grow": grow.toFixed(3),
        } as CSSProperties
      }
    >
      {products.map((product, index) => {
        const state = stateOf(index);
        const flippable = hasBack(product);
        // Pointed at while another card is out of the hand.
        const lifted = played !== -1 && state !== "selected" && product.id === active;

        return (
          <div
            key={product.id}
            role="listitem"
            className={styles.slot}
            data-card-slot=""
            data-state={state}
            data-lifted={lifted ? "true" : undefined}
            data-flipped={state === "selected" && flippable ? "true" : undefined}
            style={{ "--i": index } as CSSProperties}
          >
            <div
              className={styles.pose}
              onPointerEnter={() => onActive(product.id)}
              onPointerLeave={() => onActive(null)}
              onClick={() => onSelect(product.id === selected ? null : product.id)}
              // A played card is being read: a wheel over it scrolls the card
              // (or nothing), never the pager — which listens on the window
              // and would otherwise turn the page whenever the page itself
              // happens to be scrolled to an end.
              onWheel={state === "selected" ? (event) => event.stopPropagation() : undefined}
            >
              <div className={styles.float}>
                <div className={styles.tilt} onPointerMove={tiltTowards} onPointerLeave={untilt}>
                  <div className={styles.flipper}>
                    <CardSurface
                      product={product}
                      solid
                      className={styles.front}
                      data-active={state === "raised" || state === "selected" || lifted ? "true" : undefined}
                      tabIndex={shown ? 0 : -1}
                      aria-label={`${product.name}${flippable ? ", show details" : ""}`}
                      aria-expanded={flippable ? state === "selected" : undefined}
                      onFocus={() => onActive(product.id)}
                      onBlur={() => onActive(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(product.id === selected ? null : product.id);
                        }
                      }}
                    >
                      <CardFront product={product} description={false} />
                    </CardSurface>

                    {flippable && (
                      <CardSurface
                        product={product}
                        solid
                        className={styles.back}
                        data-active="true"
                        aria-hidden={state === "selected" ? undefined : "true"}
                      >
                        <CardFront product={product} />
                        <CardDetails product={product} />
                      </CardSurface>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
