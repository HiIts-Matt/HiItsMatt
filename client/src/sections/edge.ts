/**
 * Geometry for the edge the intro's background ends on.
 *
 * Nothing here draws the gradient: the edge is the boundary of a hole punched
 * in the ink band that covers the shader canvas below the intro's last screen,
 * so what shows through is the same canvas, the same frame, one continuous
 * surface. This module only answers "what shape is that hole".
 *
 * The shape is a full-width chevron with every point displaced from that base
 * curve by a smooth Gaussian process. Displacement is along the curve's
 * *normal*, not its tangent: sliding a point along the tangent moves it to
 * where the curve already goes and leaves the silhouette identical, so a normal
 * offset is what "offset from the chevron" has to mean to be visible. Because
 * the normal tilts with the chevron's legs, the wobble leans with the shape
 * instead of standing up as a vertical comb.
 *
 * The shape does not animate. It is where the background stops, and the
 * transition is the intro page carrying it up off the screen — the band hangs
 * below that page's box, so the edge is uncovered as the page leaves.
 * Recomputed on resize and at no other time.
 *
 * All coordinates are in the band's own space: x from the left edge of the
 * layer, y from the bottom of the intro's screen downwards, in CSS pixels.
 */

/**
 * Every number that decides how the edge looks. Tune these rather than the code
 * below; `seed` alone walks through entirely different noise patterns at the
 * same character.
 *
 * In a dev build any of them can be overridden from the query string —
 * `?wobble=0.14&seed=12&coarseCells=4&band=260` — so a pattern can be hunted
 * down without an edit-and-save cycle. Once a set looks right, paste the values
 * here.
 */
export const EDGE = {
  /** Which Gaussian field to draw. Any integer; each is a different edge. */
  seed: 1,

  /** Apex depth, as a share of the band. */
  apex: 0.92,

  /** Noise amplitude, as a share of the band. */
  wobble: 0.08,

  /**
   * Softening half-width of the apex, in the chevron's own -1..1 parameter.
   * Larger is a rounder point; 0 would be a true `abs()`, whose infinite
   * curvature spike makes the normals on either side disagree and tears the
   * displaced edge across a single sample.
   */
  apexSoft: 0.045,

  /** Lattice cells across the width, per octave: coarse swells, finer ripple. */
  coarseCells: 7,
  fineCells: 19,

  /** Weight of the fine octave relative to the coarse one. */
  fineWeight: 0.42,

  /** Samples per pixel of width. Dense enough to read as a curve, no denser. */
  density: 1 / 9,
} satisfies Record<string, number>;

export type EdgeTuning = typeof EDGE;

if (import.meta.env.DEV) {
  const overrides = new URLSearchParams(window.location.search);
  for (const key of Object.keys(EDGE) as (keyof EdgeTuning)[]) {
    const raw = overrides.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) EDGE[key] = value;
  }

  /*
   * Depth lives in CSS because the shader canvas and the band itself are sized
   * from it: `?band=260`, in pixels.
   */
  const band = Number(overrides.get("band"));
  if (Number.isFinite(band) && band > 0) {
    document.documentElement.style.setProperty("--edge-band", `${band}px`);
  }
}

const LATTICE_SIZE = 256;

/**
 * Standard normal samples on a fixed lattice. Interpolating these smoothly is a
 * Gaussian process rather than merely "some noise": each lattice value is drawn
 * from N(0,1) by Box-Muller, so amplitudes are normally distributed and the
 * occasional deep excursion arrives on its own instead of being authored.
 *
 * Cached per seed, because the seed is a tuning knob and the field has to stay
 * identical across recomputes — a resize must not reshuffle the edge.
 */
const lattices = new Map<number, Float64Array>();

function lattice(seed: number): Float64Array {
  const cached = lattices.get(seed);
  if (cached) return cached;

  let state = (Math.trunc(seed) * 0x9e3779b9) >>> 0 || 0x9e3779b9;
  const uniform = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state >>> 8) / 0x1000000;
  };

  const values = new Float64Array(LATTICE_SIZE);
  for (let index = 0; index < LATTICE_SIZE; index++) {
    const uniform1 = Math.max(uniform(), 1e-7);
    values[index] = Math.sqrt(-2 * Math.log(uniform1)) * Math.cos(2 * Math.PI * uniform());
  }

  lattices.set(seed, values);
  return values;
}

/** One octave, sampled in lattice units with a C¹ smoothstep between cells. */
function octave(field: Float64Array, position: number): number {
  const cell = Math.floor(position);
  const t = position - cell;
  const from = field[((cell % LATTICE_SIZE) + LATTICE_SIZE) % LATTICE_SIZE];
  const to = field[(((cell + 1) % LATTICE_SIZE) + LATTICE_SIZE) % LATTICE_SIZE];
  return from + (to - from) * (t * t * (3 - 2 * t));
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Path data for the hole, in the band's pixel space. */
export function edgeOutline(width: number, band: number): string {
  if (width <= 0 || band <= 0) return "";

  const apex = band * EDGE.apex;
  const wobble = band * EDGE.wobble;
  const field = lattice(EDGE.seed);

  // Normalises the softened V so its legs still reach exactly zero at the
  // corners, whatever the softening.
  const norm = Math.sqrt(1 + EDGE.apexSoft * EDGE.apexSoft) - EDGE.apexSoft;
  const samples = Math.max(40, Math.min(220, Math.round(width * EDGE.density)));

  // The hole's top edge spans the full width of the band, flush with the
  // section above it, so the seam at the bottom of the intro's screen cannot
  // show.
  let d = `M0 0H${round(width)}`;

  for (let index = samples; index >= 0; index--) {
    const along = index / samples;

    // The chevron's own parameter: -1 at the left corner, 0 at the apex, 1 at
    // the right. Full width, so it is just `along` remapped.
    const u = 2 * along - 1;
    const radius = Math.sqrt(u * u + EDGE.apexSoft * EDGE.apexSoft);
    const base = apex * (1 - (radius - EDGE.apexSoft) / norm);

    // dy/dx, from the analytic derivative of the softened V.
    const slope = ((-apex / norm) * (u / radius) * 2) / width;
    const unit = 1 / Math.hypot(1, slope);

    const noise =
      (octave(field, along * EDGE.coarseCells) +
        EDGE.fineWeight * octave(field, along * EDGE.fineCells + 57)) /
      (1 + EDGE.fineWeight);

    /*
     * Taper the noise to nothing at the two corners. That is where the hole
     * meets the band's own edges, and an excursion there either pushes the
     * boundary above the ink — where the path doubles back on itself — or
     * leaves a notch hanging off the side of the band.
     */
    const offset = noise * wobble * Math.min(1, Math.sin(Math.PI * along) * 1.8);

    const x = along * width - slope * unit * offset;
    const y = Math.max(0, Math.min(band - 0.5, base + unit * offset));
    d += `L${round(x)} ${round(y)}`;
  }

  return `${d}Z`;
}
