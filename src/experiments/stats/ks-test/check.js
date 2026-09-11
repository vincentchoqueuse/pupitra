import { compute, ksStatistic, kolmogorovQ, kolmogorovDensity, stephens, LAWS } from './compute.js';
import { standardChecks } from '../../../core/checks.js';
import { mulberry32, gaussFrom } from '../../../core/rng.js';
import { normalCdf, trapz } from '../../../core/numeric.js';

const P = { law: 'gaussian', delta: 0, N: 100, M: 2000, seed: 34 };

export const checks = [
  {
    name: 'the statistic by hand: D([0.1, 0.5, 0.9] vs uniform) = 7/30 exactly',
    category: 'numeric',
    run() {
      // i=1: max(1/3−0.1, 0.1−0) · i=2: max(2/3−0.5, 0.5−1/3) · i=3: max(1−0.9, 0.9−2/3)
      const D = ksStatistic(Float64Array.of(0.1, 0.5, 0.9), (x) => x).D;
      return { ok: Math.abs(D - 7 / 30) < 1e-15, detail: `D=${D} vs ${7 / 30}` };
    },
  },
  {
    name: 'DISTRIBUTION-FREE: D(x; Φ) equals D(Φ(x); uniform) — the theorem is an identity',
    category: 'numeric',
    run() {
      // On a SHIFTED sample, so H₀ is false and the identity is not trivial.
      const rand = mulberry32(7);
      const gauss = gaussFrom(rand);
      const x = Float64Array.from({ length: 200 }, () => gauss() + 0.3).sort();
      const direct = ksStatistic(x, LAWS.gaussian.cdf).D;
      const u = Float64Array.from(x, (v) => normalCdf(v)).sort();
      const transformed = ksStatistic(u, LAWS.uniform.cdf).D;
      const gap = Math.abs(direct - transformed);
      return { ok: gap < 1e-14, detail: `|Δ|=${gap.toExponential(1)}` };
    },
  },
  {
    name: 'the empirical CDF is an exact staircase: 0 to 1, every tread at k/N',
    category: 'numeric',
    run() {
      const o = compute(P).observables;
      const { x, y } = o.ecdf;
      let ok = y[0] === 0 && y[y.length - 1] === 1 && y.length === 2 * P.N + 2;
      let worst = 0;
      for (let i = 0; i < y.length; i++) {
        if (i > 0 && (y[i] < y[i - 1] || x[i] < x[i - 1])) ok = false;
        worst = Math.max(worst, Math.abs(y[i] * P.N - Math.round(y[i] * P.N)));
      }
      return { ok: ok && worst < 1e-9, detail: `${y.length} points, tread residual ${worst.toExponential(1)}` };
    },
  },
  {
    name: 'the yellow segment IS the statistic: its length is D, its foot on the CDF',
    category: 'numeric',
    run() {
      const o = compute({ ...P, delta: 0.4 }).observables;
      const len = Math.abs(o.gap.y[1] - o.gap.y[0]);
      const eLen = Math.abs(len - o.Dobs.value);
      const eFoot = Math.abs(o.gap.y[0] - LAWS.gaussian.cdf(o.gap.x[0]));
      const eVert = Math.abs(o.gap.x[0] - o.gap.x[1]);
      return {
        ok: eLen < 1e-15 && eFoot < 1e-15 && eVert === 0,
        detail: `|len−D|=${eLen.toExponential(1)}, foot on F to ${eFoot.toExponential(1)}`,
      };
    },
  },
  {
    name: 'Kolmogorov law at its pinned points: Q(1.35810) = 0.05, median at 0.82757355',
    category: 'numeric',
    run() {
      const e1 = Math.abs(kolmogorovQ(1.3581) - 0.05);
      const e2 = Math.abs(kolmogorovQ(0.82757355) - 0.5);
      return { ok: e1 < 1e-6 && e2 < 1e-7, detail: `|Δ|=${e1.toExponential(1)}, ${e2.toExponential(1)}` };
    },
  },
  {
    name: 'the drawn density is dK/dx and integrates to one',
    category: 'numeric',
    run() {
      let worst = 0;
      for (let x = 0.05; x < 2.5; x += 0.05) {
        const h = 1e-5;
        const diff = (kolmogorovQ(x - h) - kolmogorovQ(x + h)) / (2 * h);
        worst = Math.max(worst, Math.abs(diff - kolmogorovDensity(x)));
      }
      const n = 20000;
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = (4 * i) / (n - 1);
        ys[i] = kolmogorovDensity(xs[i]);
      }
      const integral = trapz(xs, ys);
      return {
        ok: worst < 1e-8 && Math.abs(integral - 1) < 1e-9,
        detail: `|f−dK/dx|=${worst.toExponential(1)}, ∫f=${integral.toFixed(10)}`,
      };
    },
  },
  {
    name: 'duality: p < 0.05 exactly when c·D crosses the 5 % point, and the verdict says so',
    category: 'numeric',
    run() {
      // The 5 % point of the limit law, by bisection of Q.
      let lo = 1.0, hi = 2.0;
      for (let k = 0; k < 60; k++) (kolmogorovQ((lo + hi) / 2) > 0.05 ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2));
      const x05 = (lo + hi) / 2;
      let mismatches = 0;
      for (const delta of [0, 0.15, 0.3, 0.5]) {
        for (const seed of [1, 2, 3]) {
          const o = compute({ ...P, delta, seed }).observables;
          const c = stephens(P.N);
          if (o.pAsym.value < 0.05 !== c * o.Dobs.value > x05) mismatches++;
          if ((o.pMc.value < 0.05) !== (o.verdict.value === 'reject H₀')) mismatches++;
        }
      }
      return { ok: mismatches === 0, detail: `${mismatches} mismatches over 12 settings` };
    },
  },
  {
    name: 'Gaussian shift: D approaches its closed form 2Φ(δ/2) − 1',
    category: 'statistical',
    run() {
      // E[D_N] = D∞ + O(1/√N) — the empirical process adds a POSITIVE
      // Brownian-bridge sup on top of the population gap. Tolerance 3/√N
      // covers both the bias and the fluctuation at N = 50000.
      const N = 50000;
      let worst = 0;
      for (const delta of [0.3, 0.5]) {
        const rand = mulberry32(3);
        const gauss = gaussFrom(rand);
        const s = Float64Array.from({ length: N }, () => gauss() + delta).sort();
        const D = ksStatistic(s, LAWS.gaussian.cdf).D;
        worst = Math.max(worst, Math.abs(D - (2 * normalCdf(delta / 2) - 1)));
      }
      return { ok: worst < 3 / Math.sqrt(N), detail: `worst |D−D∞|=${worst.toFixed(4)} < ${(3 / Math.sqrt(N)).toFixed(4)}` };
    },
  },
  {
    name: 'uniform shift: the population gap IS δ',
    category: 'statistical',
    run() {
      const N = 50000;
      const rand = mulberry32(4);
      const s = Float64Array.from({ length: N }, () => rand() + 0.3).sort();
      const gap = Math.abs(ksStatistic(s, LAWS.uniform.cdf).D - 0.3);
      return { ok: gap < 3 / Math.sqrt(N), detail: `|D−δ|=${gap.toFixed(4)}` };
    },
  },
  {
    name: 'UNIVERSALITY: under H₀ the 95 % point holds for all three laws (Stephens scale)',
    category: 'statistical',
    run() {
      // P(D < x05/c) = 0.95 within 4·SE of a Bernoulli(0.05) over M — the same
      // scale whatever the law, which is the distribution-free property read
      // off the Monte Carlo instead of the algebra.
      let lo = 1.0, hi = 2.0;
      for (let k = 0; k < 60; k++) (kolmogorovQ((lo + hi) / 2) > 0.05 ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2));
      const d05 = (lo + hi) / 2 / stephens(P.N);
      const tol = 4 * Math.sqrt(0.05 * 0.95 / P.M);
      const parts = [];
      let ok = true;
      for (const law of ['gaussian', 'exponential', 'uniform']) {
        const o = compute({ ...P, law }).observables;
        let below = 0;
        for (const v of o.nullD) if (v < d05) below++;
        const frac = below / P.M;
        parts.push(`${law} ${frac.toFixed(3)}`);
        if (Math.abs(frac - 0.95) > tol) ok = false;
      }
      return { ok, detail: `${parts.join(' · ')} (tol ${tol.toFixed(3)})` };
    },
  },
  {
    name: 'under H₀ the p-value is uniform: mean 1/2 within 4·SE',
    category: 'statistical',
    run() {
      const M = 4000;
      const o = compute({ ...P, M }).observables;
      const c = stephens(P.N);
      let sum = 0;
      for (const v of o.nullD) sum += kolmogorovQ(c * v);
      const mean = sum / M;
      const tol = (4 * (1 / Math.sqrt(12))) / Math.sqrt(M); // SE of a mean of U(0,1)
      return { ok: Math.abs(mean - 0.5) < tol, detail: `mean=${mean.toFixed(4)} (tol ${tol.toFixed(4)})` };
    },
  },
  {
    name: 'the two series MEET at the switch, and Q is monotone from 0.005 on',
    category: 'numeric',
    run() {
      // Regression guard: the alternating series oscillates below x ≈ 1 and
      // once drew a non-monotone CDF near the origin. The theta branch now
      // owns that region; the two must agree where they hand over, and the
      // assembled function must decrease everywhere.
      const seam = Math.abs(
        1 - (Math.sqrt(2 * Math.PI) / 1.18) * (Math.exp(-(Math.PI ** 2) / (8 * 1.18 ** 2)) + Math.exp((-9 * Math.PI ** 2) / (8 * 1.18 ** 2)) + Math.exp((-25 * Math.PI ** 2) / (8 * 1.18 ** 2)))
          - kolmogorovQ(1.18 + 1e-12)
      );
      let worstRise = 0;
      let prev = kolmogorovQ(0.005);
      for (let x = 0.006; x < 3; x += 0.001) {
        const q = kolmogorovQ(x);
        worstRise = Math.max(worstRise, q - prev);
        prev = q;
      }
      return {
        ok: seam < 1e-10 && worstRise <= 0,
        detail: `seam gap ${seam.toExponential(1)}, worst rise ${worstRise.toExponential(1)}`,
      };
    },
  },
  {
    name: 'the drawn curves are monotone: CDF up, survival down, from the first pixel',
    category: 'numeric',
    run() {
      const o = compute(P).observables;
      let bad = 0;
      for (let i = 1; i < o.nullCdf.x.length; i++) {
        if (o.nullCdf.y[i] < o.nullCdf.y[i - 1]) bad++;
        if (o.survival.y[i] > o.survival.y[i - 1]) bad++;
      }
      return { ok: bad === 0, detail: `${bad} inversions over ${o.nullCdf.x.length} grid points` };
    },
  },
  {
    name: 'the p-value view is exact: survival + CDF = 1, crossing at pAsym, treads at k/M',
    category: 'numeric',
    run() {
      const o = compute(P).observables;
      let comp = 0;
      for (let i = 0; i < o.survival.x.length; i++)
        comp = Math.max(comp, Math.abs(o.survival.y[i] + o.nullCdf.y[i] - 1));
      const cross = Math.abs(o.pAsym.value - kolmogorovQ(stephens(P.N) * o.Dobs.value));
      const y = o.nullEcdf.y;
      let treads = 0;
      let ok = y[0] === 0 && y[y.length - 1] === 1 && y.length === 2 * P.M + 2;
      for (let i = 1; i < y.length; i++) {
        if (y[i] < y[i - 1] || o.nullEcdf.x[i] < o.nullEcdf.x[i - 1]) ok = false;
        treads = Math.max(treads, Math.abs(y[i] * P.M - Math.round(y[i] * P.M)));
      }
      return {
        ok: ok && comp === 0 && cross === 0 && treads < 1e-9,
        detail: `|K+Q−1|=${comp}, |crossing−p|=${cross}, tread residual ${treads.toExponential(1)}`,
      };
    },
  },
  {
    name: 'META-TEST: the M simulated D pass their own KS test against the limit law',
    category: 'statistical',
    run() {
      // The null D's are themselves a sample with a hypothesized CDF K(c·d):
      // run the experiment's own test on them. Under H₀-of-the-meta-test the
      // p is uniform, so a fixed seed lands anywhere in (0, 1); the check
      // asks it to clear 0.001 — a true mismatch of law drives it to 0.
      const o = compute({ ...P, M: 4000 }).observables;
      const cN = stephens(P.N);
      const sorted = Float64Array.from(o.nullD).sort();
      const Dmeta = ksStatistic(sorted, (d) => 1 - kolmogorovQ(cN * d)).D;
      const pMeta = kolmogorovQ(stephens(4000) * Dmeta);
      return { ok: pMeta > 0.001, detail: `D_meta=${Dmeta.toFixed(4)}, p_meta=${pMeta.toFixed(3)}` };
    },
  },
  standardChecks.determinism(compute, P, 'ecdf'),
  standardChecks.determinism(compute, P, 'nullD'),
];
