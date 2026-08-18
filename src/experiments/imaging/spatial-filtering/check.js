import {
  compute,
  siemensStar,
  boxKernel,
  gaussianKernel,
  convolve2d,
  SOBEL_X,
  SOBEL_Y,
  LAPLACIAN,
  N_IMG,
} from './compute.js';
import { standardChecks, maxAbsDiff } from '../../../core/checks.js';

/** The k × k window of `img` (size n × n) centered on its middle pixel. */
function centerPatch(img, n, k) {
  const c = Math.floor(n / 2);
  const half = (k - 1) / 2;
  const out = new Float64Array(k * k);
  let idx = 0;
  for (let di = -half; di <= half; di++)
    for (let dj = -half; dj <= half; dj++) out[idx++] = img[(c + di) * n + (c + dj)];
  return out;
}

export const checks = [
  {
    name: 'Sobel and Laplacian match the literature coefficients exactly',
    category: 'numeric',
    run() {
      // Hardcoded independently of compute.js's own constants (Gonzalez &
      // Woods' standard 3×3 operators) — this proves the KERNEL
      // definitions, not just that compute.js agrees with itself.
      const wantSobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
      const wantSobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
      const wantLaplacian = [0, 1, 0, 1, -4, 1, 0, 1, 0];
      const bad = [];
      if (maxAbsDiff(SOBEL_X, wantSobelX) > 0) bad.push('Sobel Gx');
      if (maxAbsDiff(SOBEL_Y, wantSobelY) > 0) bad.push('Sobel Gy');
      if (maxAbsDiff(LAPLACIAN, wantLaplacian) > 0) bad.push('Laplacian');
      return {
        ok: bad.length === 0,
        detail: bad.length ? bad.join(' · ') : '21 coefficients, exact match',
      };
    },
  },
  {
    name: 'impulse response: a single bright pixel returns the kernel itself, exactly',
    category: 'numeric',
    run() {
      // A convolution's own defining property, independent of what the
      // kernel's numbers happen to be: box, Gaussian, Laplacian and
      // Sobel's magnitude must all reproduce their kernel exactly at an
      // impulse. n = 9 keeps every patch read back here fully interior
      // (away from the border-clamping this convolution applies), so
      // clamping cannot be the reason this passes.
      const n = 9;
      const impulse = new Float64Array(n * n);
      impulse[Math.floor(n / 2) * n + Math.floor(n / 2)] = 1;
      const bad = [];

      const box3 = boxKernel(3);
      const gotBox = centerPatch(convolve2d(impulse, n, box3, 3), n, 3);
      const dBox = maxAbsDiff(gotBox, box3);
      if (dBox > 1e-14) bad.push(`box: ${dBox.toExponential(1)}`);

      const gauss5 = gaussianKernel(5);
      const gotGauss = centerPatch(convolve2d(impulse, n, gauss5, 5), n, 5);
      const dGauss = maxAbsDiff(gotGauss, gauss5);
      if (dGauss > 1e-14) bad.push(`gaussian: ${dGauss.toExponential(1)}`);

      const gotLap = centerPatch(convolve2d(impulse, n, LAPLACIAN, 3), n, 3);
      const dLap = maxAbsDiff(gotLap, LAPLACIAN);
      if (dLap > 1e-14) bad.push(`laplacian: ${dLap.toExponential(1)}`);

      // Sobel: the impulse response of sqrt(Gx² + Gy²) is |Gx| and |Gy|
      // combined pointwise — the magnitude of the fixed kernels' own
      // coefficients, not either kernel alone.
      const gx = convolve2d(impulse, n, SOBEL_X, 3);
      const gy = convolve2d(impulse, n, SOBEL_Y, 3);
      const mag = new Float64Array(n * n);
      for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(gx[i], gy[i]);
      const wantSobel = new Float64Array(9);
      for (let i = 0; i < 9; i++) wantSobel[i] = Math.hypot(SOBEL_X[i], SOBEL_Y[i]);
      const dSobel = maxAbsDiff(centerPatch(mag, n, 3), wantSobel);
      if (dSobel > 1e-14) bad.push(`sobel: ${dSobel.toExponential(1)}`);

      return {
        ok: bad.length === 0,
        detail: bad.length
          ? bad.join(' · ')
          : `box, Gaussian, Sobel, Laplacian all exact to 1e-14 (worst ${Math.max(dBox, dGauss, dLap, dSobel).toExponential(1)})`,
      };
    },
  },
  {
    name: 'a flat region: smoothing kernels leave it exactly unchanged, edge kernels give exactly zero',
    category: 'numeric',
    run() {
      const n = 9;
      const flat = new Float64Array(n * n).fill(0.7);
      const zero = new Float64Array(n * n);
      const bad = [];

      const dBox = maxAbsDiff(convolve2d(flat, n, boxKernel(5), 5), flat);
      if (dBox > 1e-13) bad.push(`box: ${dBox.toExponential(1)}`);

      const dGauss = maxAbsDiff(convolve2d(flat, n, gaussianKernel(5), 5), flat);
      if (dGauss > 1e-12) bad.push(`gaussian: ${dGauss.toExponential(1)}`);

      const dLap = maxAbsDiff(convolve2d(flat, n, LAPLACIAN, 3), zero);
      if (dLap > 1e-12) bad.push(`laplacian: ${dLap.toExponential(1)}`);

      const dGx = maxAbsDiff(convolve2d(flat, n, SOBEL_X, 3), zero);
      const dGy = maxAbsDiff(convolve2d(flat, n, SOBEL_Y, 3), zero);
      if (Math.max(dGx, dGy) > 1e-12) bad.push(`sobel: ${Math.max(dGx, dGy).toExponential(1)}`);

      return {
        ok: bad.length === 0,
        detail: bad.length
          ? bad.join(' · ')
          : 'box & Gaussian preserve 0.7 exactly, Sobel & Laplacian give exactly 0',
      };
    },
  },
  {
    name: 'the star: 32 alternating wedges, sampled well inside nine of them',
    category: 'numeric',
    run() {
      // Sampled at each wedge's ANGULAR CENTER, at r = 0.85 — safely away
      // from both the outer edge and the center's angular undersampling —
      // so this cannot be flaky the way counting crossings around a
      // rasterized ring would be near a boundary pixel.
      const n = N_IMG;
      const img = siemensStar(n);
      const at = (theta, r) => {
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        const j = Math.floor(((x + 1) * n) / 2);
        const i = Math.floor(((1 - y) * n) / 2);
        return img[i * n + j];
      };
      const wedgeCenter = (k) => -Math.PI + (k + 0.5) * ((2 * Math.PI) / 32);
      const bad = [];
      for (const k of [0, 1, 8, 9, 16, 17, 24, 25, 31]) {
        const want = k % 2 === 0 ? 1 : 0;
        const got = at(wedgeCenter(k), 0.85);
        if (got !== want) bad.push(`wedge ${k}: ${got} instead of ${want}`);
      }
      return {
        ok: bad.length === 0,
        detail: bad.length ? bad.join(' · ') : '9 wedges sampled at their center, alternating exactly',
      };
    },
  },
  {
    name: 'Σ kernel: 1 for the smoothing kernels, 0 for the edge kernels — via compute() and independently',
    category: 'numeric',
    run() {
      const sum = (a) => Array.from(a).reduce((s, v) => s + v, 0);
      const bad = [];
      for (const [kernel, N, want] of [
        ['box', 5, 1],
        ['gaussian', 7, 1],
        ['sobel', 5, 0],
        ['laplacian', 5, 0],
      ]) {
        const { observables: o } = compute({ kernel, N });
        if (Math.abs(o.kernelSum.value - want) > 1e-12) bad.push(`${kernel} via compute(): ${o.kernelSum.value}`);
      }
      // and independently, straight off the exported kernel builders —
      // compute() and this check reach the same numbers by different paths.
      if (Math.abs(sum(boxKernel(5)) - 1) > 1e-12) bad.push('boxKernel(5) itself');
      if (Math.abs(sum(gaussianKernel(7)) - 1) > 1e-9) bad.push('gaussianKernel(7) itself');
      if (sum(SOBEL_X) !== 0 || sum(SOBEL_Y) !== 0) bad.push('Sobel coefficients');
      if (sum(LAPLACIAN) !== 0) bad.push('Laplacian coefficients');
      return {
        ok: bad.length === 0,
        detail: bad.length ? bad.join(' · ') : '4 kernels, via compute() and via their own builders, all exact',
      };
    },
  },
  standardChecks.determinism(compute, { kernel: 'gaussian', N: 5 }, 'filteredRow'),
];
