<script>
  import {
    app,
    manifest,
    activeScene,
    applyPreset,
    currentHash,
    toggleSidebar,
  } from '../core/store.svelte.js';
  import { subjects } from '../core/registry.js';
  import { STR } from '../core/strings.js';
  import { patchHashQuery } from '../core/router.js';
  import { clickOutside } from '../core/click-outside.js';
  import Icon from './Icon.svelte';
  import QrCode from './QrCode.svelte';


  const m = $derived(manifest());
  const scene = $derived(activeScene());
  const subjectTitle = $derived(
    subjects.find((s) => s.id === m?.subject)?.title ?? m?.subject ?? ''
  );
  const sceneIndex = $derived(m?.presets.findIndex((p) => p.id === app.preset) ?? -1);

  let menuOpen = $state(false);
  let qrOpen = $state(false);
  let copied = $state(false);

  // live through replaceState updates (no hashchange event while dragging)
  const hash = $derived(m ? currentHash() : '#/');
  const href = $derived(
    typeof location === 'undefined' ? hash : location.origin + location.pathname + hash
  );

  function pick(id) {
    applyPreset(id);
    menuOpen = false;
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {}
  }

  // THE EMBED MINT. The scene on screen, struck as a ready-to-paste iframe:
  // this is the gesture that turns the full app into the studio and the
  // embeds into the distribution — compose here, paste in the course page.
  // lazy-loading baked in, so the cheap path is the default path.
  let copiedEmbed = $state(false);
  async function copyEmbed() {
    // drawer dropped from the mint: the frame renders no drawer, so the flag
    // would be dead weight in every course page the snippet lands in
    const h = patchHashQuery(currentHash(), { embed: '1', drawer: null });
    const src = location.origin + location.pathname + h;
    // title attribute: what a screen reader announces for the frame — we
    // write the snippet colleagues will paste, so the accessible path is the
    // default path, like the lazy attribute
    const snippet = `<iframe src="${src}" title="pupitra — ${m?.title ?? 'interactive figure'}" loading="lazy" style="width:100%; height:620px; border:none"></iframe>`;
    try {
      await navigator.clipboard.writeText(snippet);
      copiedEmbed = true;
      setTimeout(() => (copiedEmbed = false), 1200);
    } catch {}
  }

  function onWindowKeydown(e) {
    if (e.key === 'Escape') {
      menuOpen = false;
      qrOpen = false;
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<header class="header">
  <div class="left">
    {#if !app.ui.sidebar}
      <!-- mobile only (CSS): on desktop the collapsed rail carries the toggle -->
      <button class="icon-btn side-open" onclick={toggleSidebar} title="{STR.COLLAPSE_SIDEBAR} (⌘B)">
        <Icon name="panel-left" size={15} />
      </button>
    {/if}
    <span class="crumb">
      {#if m}
        {subjectTitle} / <strong>{m.title}</strong>
      {:else}
        <strong>{STR.CATALOGUE}</strong>
      {/if}
    </span>
  </div>

  <div class="right">
    <div
      class="preset-picker"
      use:clickOutside={{ enabled: menuOpen, handler: () => (menuOpen = false) }}
    >
      {#if m?.presets.length}
        <!-- The scene's rank is DERIVED, here and in the list below, and never
             written into the title. It used to be typed into the title itself
             ("Scene 3 · …") in half the catalogue, which duplicated what this
             span already draws and went stale the moment a scene was inserted
             — twice, in one afternoon. The position is the engine's to know. -->
        <button onclick={() => (menuOpen = !menuOpen)} aria-haspopup="listbox">
          {#if sceneIndex >= 0}
            <span class="idx">{sceneIndex + 1}/{m.presets.length}</span>
          {/if}
          <span>{scene?.title ?? STR.SCENE}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {#if menuOpen}
          <div class="menu" role="listbox">
            {#each m.presets as p, i (p.id)}
              <button class:active={p.id === app.preset} onclick={() => pick(p.id)}>
                <span class="idx">{i + 1}</span>
                <span>{p.title}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
    <button class="icon-btn copy-btn" onclick={copyUrl} title={STR.COPY_LINK}>
      <Icon name={copied ? 'check' : 'link'} size={15} />
    </button>
    <!-- QR of the scene URL — stays available in presentation mode, where a
         lecture hall scans it from the projector -->
    <div
      class="qr-anchor"
      use:clickOutside={{ enabled: qrOpen, handler: () => (qrOpen = false) }}
    >
      <button class="icon-btn" class:on={qrOpen} onclick={() => (qrOpen = !qrOpen)} title={STR.QR_CODE}>
        <Icon name="qr-code" size={15} />
      </button>
      {#if qrOpen}
        <div class="qr-popover" role="dialog" aria-label={STR.QR_CODE}>
          <QrCode text={href} size={236} />
          <span class="qr-url mono">{hash}</span>
        </div>
      {/if}
    </div>

    <!-- the embed mint took the fullscreen button's slot: striking an embed
         is a minting gesture that deserves a button, while presentation mode
         is a lecture gesture that lives on its key (L) -->
    {#if m && !app.embed}
      <button class="icon-btn" onclick={copyEmbed} title={STR.EMBED_CODE}>
        <Icon name={copiedEmbed ? 'check' : 'code'} size={15} />
      </button>
    {/if}
  </div>
</header>
