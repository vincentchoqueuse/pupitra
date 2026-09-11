// The Kolmogorov–Smirnov goodness-of-fit test.
//
// The science that makes the experiment honest:
//  · D over the ORDER STATISTICS — the sup of |F̂ − F| is attained at a sample
//    point, one side or the other of the 1/N step, so the exact statistic is
//    max over i of max(i/N − F(x₍ᵢ₎), F(x₍ᵢ₎) − (i−1)/N). No grid, no approximation.
//  · The DISTRIBUTION-FREE property is an identity, not folklore: D of the
//    sample against F equals D of the transformed sample U = F(X) against the
//    uniform CDF, exactly — check.js asserts it to machine precision.
//  · The null law: √N·D converges to the Kolmogorov distribution
//    K(x) = 1 − 2·Σ (−1)^{k−1} e^{−2k²x²}. At finite N the classical Stephens
//    scale c(N) = √N + 0.12 + 0.11/√N makes P(c·D > x) ≈ Q(x) accurate to a
//    few 1e-3 from N ≈ 20 on — the documented gap between the drawn curve and
//    the Monte Carlo histogram.
import { mulberry32, gaussFrom } from '../../../core/rng.js';
import { normalPdf, normalCdf } from '../../../core/numeric.js';

/** The hypothesized laws, canonical parameters (the pill picks one). */
export const LAWS = {
  gaussian: {
    range: [-4, 4],
    pdf: (x) => normalPdf(x),
    cdf: (x) => normalCdf(x),
    sample: (rand, gauss) => gauss(),
  },
  exponential: {
    range: [0, 6],
    pdf: (x) => (x < 0 ? 0 : Math.exp(-x)),
    cdf: (x) => (x < 0 ? 0 : 1 - Math.exp(-x)),
    sample: (rand) => -Math.log(1 - rand()),
  },
  uniform: {
    range: [0, 1],
    pdf: (x) => (x >= 0 && x <= 1 ? 1 : 0),
    cdf: (x) => Math.min(1, Math.max(0, x)),
    sample: (rand) => rand(),
  },
};

/** Exact KS statistic of an ASCENDING-SORTED sample against a CDF.
 *  Returns { D, at, lo, hi }: the sup, its abscissa, and the two ordinates
 *  (theory and empirical staircase) whose distance is D. */
export function ksStatistic(sorted, cdf) {
  const N = sorted.length;
  let D = -1;
  let at = sorted[0];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < N; i++) {
    const F = cdf(sorted[i]);
    const above = (i + 1) / N - F; // the staircase just after the jump
    const below = F - i / N; //       and just before it
    if (above > D) {
      D = above;
      at = sorted[i];
      lo = F;
      hi = (i + 1) / N;
    }
    if (below > D) {
      D = below;
      at = sorted[i];
      lo = F;
      hi = i / N;
    }
  }
  return { D, at, lo, hi };
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

// Kolmogorov tail Q(x) = P(sup > x).
// TWO SERIES, ONE FUNCTION. The textbook alternating series
// 2·Σ (−1)^{k−1} e^{−2k²x²} converges fast for large x but is numerically
// USELESS below x ≈ 1: the terms decay so slowly that any truncation leaves
// an oscillating remainder, which drew a visibly non-monotone CDF near the
// origin. Jacobi's theta identity gives the dual expansion
// K(x) = (√(2π)/x)·Σ e^{−(2k−1)²π²/(8x²)}, which converges in three terms
// exactly where the other fails. Switch at 1.18 (Marsaglia's constant); the
// harness checks the two branches meet there and that the result is monotone.
export function kolmogorovQ(x) {
  if (x <= 0) return 1;
  if (x < 1.18) {
    let s = 0;
    for (let k = 1; k <= 20; k++) {
      const term = Math.exp((-(2 * k - 1) * (2 * k - 1) * Math.PI * Math.PI) / (8 * x * x));
      s += term;
      if (term < 1e-18) break;
    }
    return Math.min(1, Math.max(0, 1 - (SQRT_2PI / x) * s));
  }
  let s = 0;
  for (let k = 1; k <= 100; k++) {
    const term = Math.exp(-2 * k * k * x * x);
    s += (k % 2 ? 1 : -1) * term;
    if (term < 1e-16) break;
  }
  return Math.min(1, Math.max(0, 2 * s));
}

/** Kolmogorov density k(x) = dK/dx — same two branches as the CDF. */
export function kolmogorovDensity(x) {
  if (x <= 0) return 0;
  if (x < 1.18) {
    // d/dx of (√(2π)/x)·Σ e^{−a/x²}, a = (2k−1)²π²/8:
    // (√(2π)/x²)·Σ e^{−a/x²}·(2a/x² − 1).
    let s = 0;
    for (let k = 1; k <= 20; k++) {
      const a = ((2 * k - 1) * (2 * k - 1) * Math.PI * Math.PI) / 8;
      const e = Math.exp(-a / (x * x));
      s += e * ((2 * a) / (x * x) - 1);
      if (e < 1e-18) break;
    }
    return Math.max(0, (SQRT_2PI / (x * x)) * s);
  }
  let s = 0;
  for (let k = 1; k <= 100; k++) {
    const term = k * k * Math.exp(-2 * k * k * x * x);
    s += (k % 2 ? 1 : -1) * term;
    if (term < 1e-16) break;
  }
  return Math.max(0, 8 * x * s);
}

/** Stephens' finite-N scale: P(c(N)·D > x) ≈ Q(x) from N ≈ 20 on. */
export const stephens = (N) => Math.sqrt(N) + 0.12 + 0.11 / Math.sqrt(N);

const GRID = 400;

/** PURE, stateless, seeded. The sample stream comes first, the Monte Carlo
 *  null stream after it, so dragging δ moves the SAME draws and never
 *  redraws either the sample or the null distribution. */
export function compute({ law, delta, N, M, seed }) {
  const L = LAWS[law];
  const rand = mulberry32(seed);
  const gauss = gaussFrom(rand);

  // The sample: N draws from the law, shifted by δ (δ = 0 is H₀ true).
  const sample = new Float64Array(N);
  for (let i = 0; i < N; i++) sample[i] = L.sample(rand, gauss) + delta;
  const sorted = Float64Array.from(sample).sort();

  const { D, at, lo, hi } = ksStatistic(sorted, L.cdf);
  const c = stephens(N);
  const pAsym = kolmogorovQ(c * D);

  // Drawing range: the law's own support, stretched to hold the shifted data.
  const x0 = Math.min(L.range[0], L.range[0] + delta) - 0.15;
  const x1 = Math.max(L.range[1], L.range[1] + delta) + 0.15;

  const pdfX = new Float64Array(GRID);
  const pdfY = new Float64Array(GRID);
  const cdfY = new Float64Array(GRID);
  for (let i = 0; i < GRID; i++) {
    const x = x0 + ((x1 - x0) * i) / (GRID - 1);
    pdfX[i] = x;
    pdfY[i] = L.pdf(x);
    cdfY[i] = L.cdf(x);
  }

  // The empirical CDF as an exact staircase: riser and tread at every sample.
  const ex = new Float64Array(2 * N + 2);
  const ey = new Float64Array(2 * N + 2);
  ex[0] = x0;
  ey[0] = 0;
  for (let i = 0; i < N; i++) {
    ex[2 * i + 1] = sorted[i];
    ey[2 * i + 1] = i / N;
    ex[2 * i + 2] = sorted[i];
    ey[2 * i + 2] = (i + 1) / N;
  }
  ex[2 * N + 1] = x1;
  ey[2 * N + 1] = 1;

  // The null distribution of D: M fresh samples OF SIZE N FROM H₀ (no shift).
  const nullD = new Float64Array(M);
  const rep = new Float64Array(N);
  let exceed = 0;
  for (let m = 0; m < M; m++) {
    for (let i = 0; i < N; i++) rep[i] = L.sample(rand, gauss);
    rep.sort();
    nullD[m] = ksStatistic(rep, L.cdf).D;
    if (nullD[m] >= D) exceed++;
  }
  const pMc = exceed / M;

  // The limit law, drawn on the D axis: f_D(d) = c·k(c·d) — and its two
  // integrated readings, CDF K(c·d) and survival Q(c·d). The survival curve
  // IS the p-value as a function of the observed D: the vline at D crosses
  // it exactly at height Q(c·D) = pAsym, which the hline marks.
  const dMax = Math.max(2.2 / c, D * 1.25);
  const nx = new Float64Array(GRID);
  const ny = new Float64Array(GRID);
  const ncdf = new Float64Array(GRID);
  const nsurv = new Float64Array(GRID);
  for (let i = 0; i < GRID; i++) {
    const d = (dMax * i) / (GRID - 1);
    nx[i] = d;
    ny[i] = c * kolmogorovDensity(c * d);
    nsurv[i] = kolmogorovQ(c * d);
    ncdf[i] = 1 - nsurv[i];
  }

  // The Monte Carlo CDF of D, as an exact staircase over the same axis —
  // the experiment's own criterion examined with the experiment's own tools.
  const sortedNull = Float64Array.from(nullD).sort();
  const dx = new Float64Array(2 * M + 2);
  const dy = new Float64Array(2 * M + 2);
  dx[0] = 0;
  dy[0] = 0;
  for (let m = 0; m < M; m++) {
    dx[2 * m + 1] = sortedNull[m];
    dy[2 * m + 1] = m / M;
    dx[2 * m + 2] = sortedNull[m];
    dy[2 * m + 2] = (m + 1) / M;
  }
  dx[2 * M + 1] = dMax;
  dy[2 * M + 1] = 1;

  const verdict = pMc < 0.05 ? 'reject H₀' : 'no evidence against H₀';

  return {
    observables: {
      sample,
      pdfCurve: { x: pdfX, y: pdfY },
      cdfCurve: { x: pdfX, y: cdfY },
      ecdf: { x: ex, y: ey },
      gap: { x: Float64Array.of(at, at), y: Float64Array.of(lo, hi) },
      nullD,
      nullDensity: { x: nx, y: ny },
      nullCdf: { x: nx, y: ncdf },
      survival: { x: nx, y: nsurv },
      nullEcdf: { x: dx, y: dy },
      Dobs: { value: D, meta: { label: 'D', precision: 3 } },
      pMc: { value: pMc, meta: { label: 'p (Monte Carlo)', precision: 3 } },
      pAsym: { value: pAsym, meta: { label: 'p (Kolmogorov)', precision: 3 } },
      verdict: { value: verdict, meta: { label: 'at the 5 % level' } },
    },
  };
}
