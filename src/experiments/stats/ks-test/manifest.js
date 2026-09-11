import { float, int, select } from '../../../core/fields.js';
import { view, histogram, line, density, vline } from '../../../core/views.js';

/** @type {import('../../../core/types').ExperimentManifest} */
export default {
  id: 'ks-test',
  order: 7,
  random: true,
  title: 'The Kolmogorov–Smirnov test',
  subtitle: 'Does this sample come from that distribution?',
  tags: ['goodness of fit', 'hypothesis test', 'CDF', 'p-value', 'Kolmogorov'],

  doc: `A sample and a candidate distribution: the histogram view shows the
question the eye answers badly — bars shiver around a density at any N, and
"close enough" is not a criterion. The test moves to the cumulative view,
where both objects are honest: the empirical CDF is a staircase climbing
exactly 1/N per draw, the hypothesized F is a curve, and the criterion is
D, the LARGEST vertical gap between them — marked in yellow at the abscissa
where it happens.

A number needs a scale, and the third view is that scale: the distribution
of D over Monte Carlo samples drawn WHEN H₀ IS TRUE, with the Kolmogorov
limit law on top (√N·D converges to it; the drawn curve uses Stephens'
finite-N scale √N + 0.12 + 0.11/√N, accurate to a few 1e-3 from N ≈ 20).
The yellow line is the D of the sample on screen, and the p-value is the
fraction of the null histogram to its right — the statline carries it twice,
counted by Monte Carlo and read off the limit law, and the two agree.

The remarkable theorem is that this scale is UNIVERSAL: D depends on the
sample only through U = F(X), which is uniform under H₀, so the null
distribution of D is the same for every continuous law — the check harness
asserts that identity to machine precision, and the law pill demonstrates
it: switch the distribution and the null histogram does not move.

The δ pill shifts the data away from H₀. At δ = 0.4 and N = 100 the gap is
plain (D ≈ 0.19, p ≈ 0.0005); at δ = 0.2 the same test reads p ≈ 0.2 at
N = 50 and p ≈ 0.002 at N = 500 — a small lie is invisible until the sample
is large, which is what statistical power means. For a location shift of
the Gaussian the population gap even has a closed form, D∞ = 2Φ(δ/2) − 1,
verified in the checks.`,

  params: {
    law: select('distribution', {
      description: 'the hypothesized law H₀ (canonical parameters)',
      options: [
        { value: 'gaussian', label: 'Gaussian' },
        { value: 'exponential', label: 'exponential(1)' },
        { value: 'uniform', label: 'uniform [0, 1]' },
      ],
      default: 'gaussian',
    }),
    delta: float('δ', {
      description: 'shift of the sample away from H₀ (0 = H₀ true)',
      min: -1,
      max: 1,
      step: 0.05,
      default: 0,
      precision: 2,
    }),
    N: int('N', { description: 'sample size', min: 10, max: 1000, step: 10, default: 100 }),
    M: int('M', {
      description: 'Monte Carlo samples under H₀',
      min: 200,
      max: 10000,
      step: 100,
      default: 2000,
    }),
    // no seed here: injected by the core
  },

  validate: [{ when: (q) => q.M * q.N > 2.5e6, message: 'M×N too large to stay responsive' }],

  groups: [
    { title: 'Hypothesis', params: ['law', 'delta'] },
    { title: 'Sampling', params: ['N', 'M'] },
  ],

  views: [
    view(
      'sample',
      'Sample vs H₀ density',
      histogram('sample', {
        color: '#0072BD',
        label: 'the sample',
        overlays: [density('pdfCurve', { color: '#D95319', width: 2.5, label: 'H₀ density' })],
        axes: { x: 'x', y: 'density' },
      })
    ),
    view(
      'cdf',
      'Cumulative distribution',
      line('cdfCurve', {
        color: '#D95319',
        width: 2.5,
        label: 'theory',
        overlays: [
          line('ecdf', { color: '#0072BD', width: 2, label: 'sampled' }),
          line('gap', { color: '#EDB120', width: 3, label: 'the gap D' }),
        ],
        axes: { x: 'x', y: { label: 'F(x)', domain: [0, 1.05] } },
      })
    ),
    view(
      'null',
      'Distribution of D under H₀',
      histogram('nullD', {
        color: '#0072BD',
        label: 'D under H₀',
        overlays: [
          density('nullDensity', { color: '#D95319', width: 2.5, label: 'Kolmogorov limit' }),
          vline('Dobs', { color: '#EDB120', dashed: true, label: 'D of the sample' }),
        ],
        axes: { x: 'D', y: 'density' },
      })
    ),
  ],
};
