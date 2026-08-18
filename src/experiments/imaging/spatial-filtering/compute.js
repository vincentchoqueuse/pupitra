// 2D convolution: one operation, four kernels — two that smooth (their
// coefficients sum to 1, so a flat region survives unchanged) and two that
// find edges (their coefficients sum to 0, so a flat region maps to
// exactly zero). The Siemens star's alternating wedges compress toward the
// center, so a fixed kernel wipes out fine structure there first while
// leaving the coarse outer wedges untouched — the same kernel, read as
// "how small a feature survives".
//
// PURE and stateless — runs in a worker. Fully deterministic: no generator,
// hence no 'random: true' in the manifest and no seed in the signature.
import { toBmpDataUri, normalize01 } from '../_lib/images.js';

const N_IMG = 128; // square image size
const SPOKES = 32; // alternating wedges around the star (16 cycles)

/** The Siemens star: SPOKES alternating black/white wedges filling the
 *  square. Its point is entirely geometric — a wedge of fixed ANGULAR width
 *  covers fewer and fewer pixels as the radius shrinks, so spatial
 *  frequency rises toward the center without a single extra parameter. */
export function siemensStar(n) {
  const img = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    for (let j = 0; j < n; j++) {
      const x = (2 * (j + 0.5)) / n - 1;
      const theta = Math.atan2(y, x); // (-π, π]
      const wedge = Math.floor(((theta + Math.PI) / (2 * Math.PI)) * SPOKES);
      img[i * n + j] = wedge % 2 === 0 ? 1 : 0;
    }
  }
  return img;
}

/** A box (mean) kernel, k × k, normalized to sum to 1. */
export function boxKernel(k) {
  return new Float64Array(k * k).fill(1 / (k * k));
}

/** A discretized, normalized Gaussian, k × k, σ = k / 6 — the usual rule of
 *  thumb that keeps the kernel's half-width at about 3σ. */
export function gaussianKernel(k) {
  const sigma = k / 6;
  const half = (k - 1) / 2;
  const out = new Float64Array(k * k);
  let sum = 0;
  for (let di = -half; di <= half; di++) {
    for (let dj = -half; dj <= half; dj++) {
      const v = Math.exp(-(di * di + dj * dj) / (2 * sigma * sigma));
      out[(di + half) * k + (dj + half)] = v;
      sum += v;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

// Sobel and Laplacian are fixed 3×3 kernels from the literature (Gonzalez &
// Woods) — not parameterized by N, and their coefficients sum to exactly 0:
// an edge detector is built to null out a flat region, not preserve it.
export const SOBEL_X = Float64Array.from([-1, 0, 1, -2, 0, 2, -1, 0, 1]);
export const SOBEL_Y = Float64Array.from([-1, -2, -1, 0, 0, 0, 1, 2, 1]);
export const LAPLACIAN = Float64Array.from([0, 1, 0, 1, -4, 1, 0, 1, 0]);

/** Plain 2D convolution, border pixels replicated (clamped) rather than
 *  zero-padded, so a smoothing kernel doesn't darken the frame it can't
 *  reach past. */
export function convolve2d(img, n, kernel, k) {
  const half = (k - 1) / 2;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let di = -half; di <= half; di++) {
        const ii = Math.min(n - 1, Math.max(0, i + di));
        for (let dj = -half; dj <= half; dj++) {
          const jj = Math.min(n - 1, Math.max(0, j + dj));
          sum += img[ii * n + jj] * kernel[(di + half) * k + (dj + half)];
        }
      }
      out[i * n + j] = sum;
    }
  }
  return out;
}

/** sqrt(Gx² + Gy²), pointwise — the Sobel edge-magnitude response, which is
 *  not itself a single linear kernel (two convolutions, combined). */
function sobelMagnitude(img, n) {
  const gx = convolve2d(img, n, SOBEL_X, 3);
  const gy = convolve2d(img, n, SOBEL_Y, 3);
  const out = new Float64Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(gx[i], gy[i]);
  return out;
}

const sumArr = (a) => {
  let s = 0;
  for (const v of a) s += v;
  return s;
};

/** @param {{kernel: 'box'|'gaussian'|'sobel'|'laplacian', N: number}} params */
export function compute({ kernel, N }) {
  const src = siemensStar(N_IMG);

  let raw, kernelSum;
  if (kernel === 'box') {
    const kmat = boxKernel(N);
    raw = convolve2d(src, N_IMG, kmat, N);
    kernelSum = sumArr(kmat);
  } else if (kernel === 'gaussian') {
    const kmat = gaussianKernel(N);
    raw = convolve2d(src, N_IMG, kmat, N);
    kernelSum = sumArr(kmat);
  } else if (kernel === 'sobel') {
    raw = sobelMagnitude(src, N_IMG);
    kernelSum = sumArr(SOBEL_X) + sumArr(SOBEL_Y);
  } else {
    raw = convolve2d(src, N_IMG, LAPLACIAN, 3);
    kernelSum = sumArr(LAPLACIAN);
  }

  // Smoothing kernels stay inside [0, 1] by construction (nonnegative
  // coefficients summing to 1, applied to a [0, 1] image); edge kernels do
  // not, and are stretched to fill the display range. The row profile below
  // always reads the RAW values, never the display-stretched ones — the
  // plot should show what the operation actually produced, not what the
  // 8-bit encoder needed.
  const isSmoothing = kernel === 'box' || kernel === 'gaussian';
  const display = isSmoothing ? raw : normalize01(raw);

  const row = Math.floor(N_IMG / 2);
  const xAxis = Float64Array.from({ length: N_IMG }, (_, i) => i);
  const originalRow = src.slice(row * N_IMG, (row + 1) * N_IMG);
  const filteredRow = raw.slice(row * N_IMG, (row + 1) * N_IMG);

  return {
    observables: {
      original: { value: toBmpDataUri(src, N_IMG), meta: { label: 'original' } },
      filtered: { value: toBmpDataUri(display, N_IMG), meta: { label: 'filtered' } },
      originalRow: { x: xAxis, y: originalRow },
      filteredRow: { x: xAxis, y: filteredRow },
      kernelSum: { value: kernelSum, meta: { label: 'Σ kernel', precision: 0 } },
    },
  };
}

export { N_IMG, SPOKES };
