import { ShaderGradient, ShaderGradientCanvas } from "@shadergradient/react";
import { useFrame } from "@react-three/fiber";
import { memo, useRef } from "react";

import { GRADIENT_URL } from "./gradient";
import styles from "./GradientBackdrop.module.css";

type GradientBackdropProps = {
  animate: boolean;
  /** Fired once the shader is painting stable frames, not merely mounted. */
  onReady: () => void;
};

/**
 * The first frames after mount show shader compilation and the environment map
 * still streaming in, which reads as a flicker. Counting real frames is the
 * only honest "it looks right now" signal — a fixed timeout would either cut it
 * short on a slow machine or stall a fast one.
 */
const STABLE_FRAMES = 20;

function ReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const fired = useRef(false);

  useFrame(() => {
    if (fired.current) return;
    frames.current += 1;
    if (frames.current < STABLE_FRAMES) return;
    fired.current = true;
    onReady();
  });

  return null;
}

/**
 * Default-exported so the intro can `lazy()` it: this module pulls in three.js
 * and @react-three/fiber, which must stay out of the initial bundle. Memoised
 * because every re-render of `Canvas` reconfigures the renderer.
 */
function GradientBackdrop({ animate, onReady }: GradientBackdropProps) {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={styles.stage}>
        <ShaderGradientCanvas
          style={{ position: "absolute", inset: 0 }}
          pointerEvents="none"
          // Uncapped device pixel ratio makes the shader fill-rate bound on
          // retina displays for no visible gain on a soft gradient.
          pixelDensity={1}
          // Defaults to true, which unmounts the entire Canvas once the intro
          // leaves the viewport and forces a full WebGL re-init — shader
          // recompile, environment map refetch, visible flicker — on the way
          // back. Keeping it mounted is what makes returning to the top instant.
          lazyLoad={false}
        >
          <ShaderGradient
            control="query"
            urlString={animate ? GRADIENT_URL : GRADIENT_URL.replace("animate=on", "animate=off")}
          />
          <ReadySignal onReady={onReady} />
        </ShaderGradientCanvas>
      </div>
    </div>
  );
}

export default memo(GradientBackdrop);
