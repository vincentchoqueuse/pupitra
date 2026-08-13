<script>
  // Right slide-in parameter drawer, generated from the schema: groups,
  // visibleIf, validate (invalid state = computation blocked, message shown),
  // derived, unit/precision/description rendering. Never a modal — the plot
  // stays visible.
  import { app, manifest, setDrawer, validationMessage } from '../core/store.svelte.js';
  import { STR } from '../core/strings.js';
  import { clickOutside } from '../core/click-outside.js';
  import ParamControl from './ParamControl.svelte';
  import Icon from './Icon.svelte';

  const m = $derived(manifest());
  const invalid = $derived(validationMessage());
  const derivedEntries = $derived(Object.entries(m?.derived ?? {}));

  // visibleIf: {param: value} or {param: [values]} — evaluated by the UI,
  // never in views.
  function isVisible(spec) {
    if (!spec.visibleIf) return true;
    return Object.entries(spec.visibleIf).every(([k, v]) =>
      Array.isArray(v) ? v.includes(app.params[k]) : app.params[k] === v
    );
  }
</script>

<aside
  class="drawer"
  class:open={app.drawer}
  aria-hidden={!app.drawer}
  use:clickOutside={{ enabled: app.drawer, handler: () => setDrawer(false) }}
>
  {#if m}
    <h2>
      <span class="ttl"><Icon name="settings" size={15} /> {STR.PARAMETERS}</span>
      <button class="icon-btn" onclick={() => setDrawer(false)} title={STR.CLOSE}>
        <Icon name="x" size={14} />
      </button>
    </h2>

    {#if invalid}
      <div class="invalid">⚠ {invalid}</div>
    {/if}

    {#each m.groups as group, gi (gi)}
      {#if group.title}
        <h3>{group.title}</h3>
      {/if}
      {#each group.params as key (key)}
        {#if m.params[key] && isVisible(m.params[key])}
          <ParamControl {key} spec={m.params[key]} />
        {/if}
      {/each}
    {/each}

    <!-- only a random experiment has one: the registry injects the seed on
         the strength of `random: true` and nowhere else -->
    {#if m.params.seed}
      <h3>{STR.SEED}</h3>
      <ParamControl key="seed" spec={m.params.seed} />
    {/if}

    {#if derivedEntries.length}
      <h3>{STR.DERIVED}</h3>
      {#each derivedEntries as [key, d] (key)}
        <div class="derived-row">
          <span>{d.label}</span>
          <span>{d.calc(app.params)}</span>
        </div>
      {/each}
    {/if}
  {/if}
</aside>
