import { type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { CareerProduct } from "server";

import { REVEAL_DELAY_MS } from "./ActivityTimeline";
import styles from "./CardHand.module.css";
import { CardDetails, CardFront, CardSurface, hasBack } from "./ProductCard";
import { usePageLayer } from "./Section";

type CardHandProps = {
  /** Who the cards belong to, for the hand's accessible name. */
  label: string;
  products: CareerProduct[];
  /** In the player's hand. False deals every card off the bottom of the screen. */
  shown: boolean;
  /** Pointed at, here or on the timeline: straightens and lifts. */
  active: string | null;
  /** Clicked: out of the hand, centred under the timeline and flipped. */
  selected: string | null;
  /**
   * Where the played card lands: `shift` is how far down from the top of its
   * slot, in px; `grow` is how much bigger it gets (1–1.5).
   */
  play: { shift: number; grow: number };
  onActive: (id: string | null) => void;
  onSelect: (id: string | null) => void;
};

type SlotState = "rest" | "raised" | "left" | "right" | "selected";

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
 * An employer's products, held like a hand of cards along the bottom of the
 * screen: fanned on an arc, covers showing. Pointing at one (or at its row on
 * the timeline) straightens and lifts it and parts the others around it;
 * clicking one plays it — out of the hand to just under the timeline, turned
 * over to show what I built on it.
 *
 * Pinned to the page layer, not the document: scrolling moves the page under
 * the hand, and which hand is shown is the caller's call.
 */
export function CardHand({ label, products, shown, active, selected, play, onActive, onSelect }: CardHandProps) {
  const layer = usePageLayer();

  if (!layer || products.length === 0) {
    return null;
  }

  // The card the others make room for: the pointed-at one, unless it is the
  // one already out of the hand.
  const raised = products.findIndex((product) => product.id === active && product.id !== selected);

  const stateOf = (index: number, id: string): SlotState => {
    if (id === selected) return "selected";
    if (index === raised) return "raised";
    if (raised === -1) return "rest";
    return index < raised ? "left" : "right";
  };

  return createPortal(
    <div
      className={styles.hand}
      role="list"
      aria-label={`${label}: products`}
      data-shown={shown ? "true" : undefined}
      style={
        {
          "--n": products.length,
          "--deal-delay": `${REVEAL_DELAY_MS}ms`,
          "--focus-shift": `${play.shift}px`,
          "--grow": play.grow.toFixed(3),
        } as CSSProperties
      }
    >
      <div className={styles.row}>
        {products.map((product, index) => {
          const state = stateOf(index, product.id);
          const flippable = hasBack(product);

          return (
            <div
              key={product.id}
              role="listitem"
              className={styles.slot}
              data-card-slot=""
              data-state={state}
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
                        data-active={state === "raised" || state === "selected" ? "true" : undefined}
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
    </div>,
    layer,
  );
}
