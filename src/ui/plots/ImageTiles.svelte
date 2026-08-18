<!--
  Generic raster-image comparison strip: N labeled thumbnails side by side.

  Promoted from ml/svd-compression's original/compressed/residual layout —
  the day a second experiment (imaging/spatial-filtering) needed the same
  "images side by side" pattern, per the comment already left in that
  file's view: "Promoted to ui/plots/ if a second experiment displays an
  image." ml/svd-compression itself is untouched here; migrating its own
  view onto this component is a separate, later step, not done as part of
  adding a new experiment.

  It stays PURE SVG: an <image> with a `data:` URI is an SVG node like any
  other, so freeze (F) and export clone it with nothing special. No canvas,
  no DOM manipulation — which is exactly what those two depend on.

  No scientific computation here: the URIs arrive ready-made from the
  observables, and all that is left is pixel placement.
-->
<script>
  import { FRAME, FONT_UI, typeScale } from './frame.js';

  /** @type {{ tiles: {uri: string, label: string}[], pres?: boolean, frame?: object }} */
  let { tiles, pres = false, frame = FRAME } = $props();

  const W = $derived(frame.W);
  const H = $derived(frame.H);
  const kt = $derived(typeScale(pres));

  const n = $derived(tiles.length);
  const gap = 26;
  // Same sizing rule svd-compression's original layout used at n = 3
  // (side = min((W − 4·gap)/3, H − 90)), generalized: n + 1 gap-widths of
  // headroom reserved, n·side + (n−1)·gap centered in the frame.
  const side = $derived(Math.min((W - (n + 1) * gap) / n, H - 90));
  const x0 = $derived((W - (n * side + (n - 1) * gap)) / 2);
  const y0 = $derived((H - side) / 2 - 6);
</script>

<svg class="plot-svg" viewBox="0 0 {W} {H}" role="img">
  {#each tiles as t, i (t.label)}
    {#if t.uri}
      <!-- image-rendering: pixelated — the experiment asks the room to look
           at pixels, and browser smoothing would paper over exactly that -->
      <image
        href={t.uri}
        x={x0 + i * (side + gap)}
        y={y0}
        width={side}
        height={side}
        style="image-rendering: pixelated"
        preserveAspectRatio="none"
      />
      <rect
        x={x0 + i * (side + gap)}
        y={y0}
        width={side}
        height={side}
        fill="none"
        stroke="#e4e4e7"
      />
      <text
        x={x0 + i * (side + gap) + side / 2}
        y={y0 + side + 22 * kt}
        text-anchor="middle"
        font-size={12.5 * kt}
        fill="#52525b"
        font-family={FONT_UI}>{t.label}</text
      >
    {/if}
  {/each}
</svg>
