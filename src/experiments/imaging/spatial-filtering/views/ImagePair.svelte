<!--
  CUSTOM view — justification: a raster image is none of the catalogue's
  generic types (same justification as ml/svd-compression's Images.svelte).
  This file is thin on purpose: the reusable "images side by side" pattern
  now lives in ui/plots/ImageTiles.svelte; all that's left here is naming
  this experiment's two observables as tiles.
-->
<script>
  import ImageTiles from '../../../../ui/plots/ImageTiles.svelte';

  let { observables: obs, pres = false, frame } = $props();

  const tiles = $derived([
    { uri: obs.original?.value, label: 'original' },
    { uri: obs.filtered?.value, label: 'filtered' },
  ]);
</script>

<ImageTiles {tiles} {pres} {frame} />
