import { select, int } from '../../../core/fields.js';
import { custom, view, line } from '../../../core/views.js';

/** @type {import('../../../core/types').ExperimentManifest} */
export default {
  id: 'spatial-filtering',
  order: 1,
  title: 'Spatial filtering',
  subtitle: '2D convolution: locality, and blur vs. edge as the same operation',
  tags: ['convolution', 'kernel', 'blur', 'edge detection', 'Siemens star'],

  doc: `A Siemens star — alternating wedges around a circle — makes locality
visible without a single extra parameter: a wedge of fixed angular width
covers fewer pixels as the radius shrinks, so spatial frequency rises
toward the center by construction. Convolving it with a kernel is one
operation with two very different readings, decided entirely by the
coefficients.

A box or a Gaussian kernel sums to 1 (Σ kernel = 1 on the statline): a flat
region survives exactly unchanged, and the star loses its center first —
the smallest feature a kernel of size N can still resolve is read directly
off the radius where the wedges blur into gray. A larger N erases more of
the star from the center outward.

Sobel and Laplacian sum to exactly 0 (Σ kernel = 0): a flat region maps to
exactly zero instead, which is why an edge detector shows nothing where the
star doesn't change and a bright ring wherever a wedge boundary crosses it.
Same convolution, same code path — only the nine or twenty-five numbers in
the kernel decide which question gets answered.`,

  params: {
    kernel: select('kernel', {
      description: 'convolution kernel',
      options: [
        { value: 'box', label: 'box blur' },
        { value: 'gaussian', label: 'Gaussian blur' },
        { value: 'sobel', label: 'Sobel (edge)' },
        { value: 'laplacian', label: 'Laplacian (edge)' },
      ],
      default: 'gaussian',
    }),
    N: int('N', {
      description: 'kernel size',
      min: 3,
      max: 15,
      step: 2,
      default: 5,
      visibleIf: { kernel: ['box', 'gaussian'] },
    }),
  },

  views: [
    // CUSTOM view: a raster image is none of the catalogue's generic types.
    // Composes the shared ui/plots/ImageTiles.svelte (promoted here from
    // ml/svd-compression's original/compressed/residual layout, per the
    // comment already in that file: "if a second experiment displays an
    // image" — this is that second experiment. ml/svd-compression itself is
    // untouched.
    custom('images', 'Original and filtered', () => import('./views/ImagePair.svelte')),

    view(
      'profile',
      'Row profile',
      line('originalRow', {
        color: '#0072BD',
        label: 'original',
        overlays: [line('filteredRow', { color: '#D95319', width: 2, label: 'filtered' })],
        axes: { x: 'pixel', y: 'intensity' },
      })
    ),
  ],
};
