<script>
  // The Prompt Bar — where a chatbot puts its input box, and now nothing but
  // that: the active scene's priority params as pills. Clicking one opens a
  // NON-modal popover above it (the plot stays fully visible while dragging).
  // The actions moved to the view bar, on the tabs line: a lecture spends its
  // time on these pills, and they deserve the whole width.
  import { app, manifest, visiblePills, maskedSet } from '../core/store.svelte.js';
  import { STR } from '../core/strings.js';
  import { formatValue } from '../core/scales.js';
  import { clickOutside } from '../core/click-outside.js';
  import ParamControl from './ParamControl.svelte';
  import Icon from './Icon.svelte';

  const m = $derived(manifest());
  const pills = $derived(visiblePills());
  const masked = $derived(maskedSet());

  let openKey = $state(null);

  function pillText(key) {
    const spec = m.params[key];
    if (masked.has(key)) return `${spec.name} = ?`;
    if (spec.type === 'select') {
      const opt = spec.options.find((o) => o.value === app.params[key]);
      return `${spec.name} = ${opt?.label ?? app.params[key]}`;
    }
    const precision = spec.precision ?? (spec.type === 'int' ? 0 : undefined);
    const unit = spec.unit ? ` ${spec.unit}` : '';
    return `${spec.name} = ${formatValue(app.params[key], precision)}${unit}`;
  }

  function toggle(key) {
    if (masked.has(key)) return; // black box: no editing until revealed
    openKey = openKey === key ? null : key;
  }

  function onWindowKeydown(e) {
    if (e.key === 'Escape' && openKey) openKey = null;
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if m && pills.length > 0}
  <div
    class="promptbar"
    use:clickOutside={{ enabled: !!openKey, handler: () => (openKey = null) }}
  >
    <div class="pills">
      {#each pills as key (key)}
        <span class="pill-wrap">
          <button
            class="pill"
            class:open={openKey === key}
            onclick={() => toggle(key)}
            title={masked.has(key) ? STR.MASKED_HINT : (m.params[key].description ?? '')}
          >
            <span class="dim"><Icon name="sliders" size={13} /></span>
            {pillText(key)}
          </button>
          {#if openKey === key}
            <div class="popover" role="dialog">
              <ParamControl {key} spec={m.params[key]} />
            </div>
          {/if}
        </span>
      {/each}
    </div>
  </div>
{/if}
