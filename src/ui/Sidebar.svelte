<script>
  import { untrack } from 'svelte';
  import { app, toggleSidebar } from '../core/store.svelte.js';
  import { subjects } from '../core/registry.js';
  import { STR } from '../core/strings.js';
  import { writePref } from '../core/prefs.js';
  import { clickOutside } from '../core/click-outside.js';
  import { PALETTES, pal, setDataPalette } from '../core/palette.svelte.js';
  import Icon from './Icon.svelte';
  import AppIcon from './AppIcon.svelte';

  function toggleBold() {
    app.ui.bold = !app.ui.bold;
    writePref('bold', app.ui.bold ? '1' : '0');
  }

  let collapsed = $state({});

  // Only the active experiment's subject is unfolded by default (the tree
  // gets lost otherwise); navigating into a folded subject unfolds it.
  // Manual toggles are otherwise preserved (untrack: no loop on collapsed).
  let prevKey;
  $effect(() => {
    const key = app.expKey;
    if (!key || key === prevKey) return;
    const subj = key.split('/')[0];
    untrack(() => {
      if (prevKey === undefined) {
        for (const s of subjects) collapsed[s.id] = s.id !== subj;
      } else if (collapsed[subj]) {
        collapsed[subj] = false;
      }
      prevKey = key;
    });
  });

  function toggleSubject(id) {
    collapsed[id] = !collapsed[id];
  }

  function toggleTheme() {
    app.ui.theme = app.ui.theme === 'light' ? 'dark' : 'light';
    writePref('theme', app.ui.theme);
  }

</script>

<!-- the three utility buttons, shared between the expanded footer and the
     collapsed rail (same actions, different button class) -->
{#snippet utils(cls)}
  <button class={cls} onclick={toggleTheme} title={STR.THEME}>
    <Icon name={app.ui.theme === 'light' ? 'moon' : 'sun'} size={15} />
  </button>
  <!-- The source, where a reader looks for it: with the application's own
       switches rather than among the header's sharing buttons, which are about
       THIS scene. -->
  <a class={cls} href={STR.REPO_URL} target="_blank" rel="noopener" title={STR.GITHUB}>
    <Icon name="github" size={15} />
  </a>
  <button
    class={cls}
    class:on={app.ui.settings}
    onclick={() => {
      app.ui.settings = !app.ui.settings;
      if (app.ui.settings && !app.ui.sidebar) toggleSidebar();
    }}
    title={STR.SETTINGS}
  >
    <Icon name="settings" size={15} />
  </button>
  <button
    class={cls}
    class:on={app.ui.inspector}
    onclick={() => (app.ui.inspector = !app.ui.inspector)}
    title={STR.INSPECTOR}
  >
    <Icon name="braces" size={15} />
  </button>
{/snippet}

<aside
  class="sidebar"
  class:collapsed={!app.ui.sidebar}
  use:clickOutside={{ enabled: app.ui.narrow && app.ui.sidebar, handler: toggleSidebar }}
>
  {#if app.ui.sidebar}
    <div class="side-top">
      <!-- the brand is the way home: it opens the catalogue page (#/) -->
      <a class="brand" href="#/"><AppIcon size={24} /> {STR.APP_NAME}</a>
      <button class="side-toggle" onclick={toggleSidebar} title="{STR.COLLAPSE_SIDEBAR} (⌘B)">
        <Icon name="panel-left" size={16} />
      </button>
    </div>
    <button class="search-btn" onclick={() => (app.ui.palette = true)}>
      <span class="lbl"><Icon name="search" size={15} /> {STR.SEARCH}</span>
      <kbd>⌘K</kbd>
    </button>
    <nav>
      {#each subjects as subject (subject.id)}
        <button class="subject-title" onclick={() => toggleSubject(subject.id)}>
          <span class="label">
            <!-- the classic tree glyph: a shut folder when the subject is
                 folded, an open one when it is not. It says the same thing as
                 the +/− on the right, but it says it without a hover — which
                 is what a listener scanning the sidebar from the back of the
                 room actually gets. -->
            <Icon name={collapsed[subject.id] ? 'folder' : 'folder-open'} size={14} stroke={1.8} />
            {subject.title}
            <!-- how many experiments the module holds — the one thing a folded
                 folder cannot say for itself, and the number a listener uses to
                 decide whether opening it is worth the click. -->
            <span class="count">({subject.experiments.length})</span>
          </span>
          <span class="chev">
            <Icon name={collapsed[subject.id] ? 'plus' : 'minus'} size={13} stroke={2.5} />
          </span>
        </button>
        {#if !collapsed[subject.id]}
          {#each subject.experiments as exp (exp.key)}
            <a
              class="exp-link"
              class:active={app.expKey === exp.key}
              href={`#/${exp.key}`}
              title={exp.subtitle}
            >
              {exp.title}
            </a>
          {/each}
        {/if}
      {/each}
    </nav>
    {#if app.ui.settings}
      <!-- cosmetic preferences panel (localStorage only — never in the URL) -->
      <div class="settings-panel">
        <div class="set-row">
          <span class="set-label">{STR.THEME}</span>
          <div class="set-chips">
            <button
              class:active={app.ui.theme === 'light'}
              onclick={() => app.ui.theme !== 'light' && toggleTheme()}
            >
              light
            </button>
            <button
              class:active={app.ui.theme === 'dark'}
              onclick={() => app.ui.theme !== 'dark' && toggleTheme()}
            >
              dark
            </button>
          </div>
        </div>
        <div class="set-row">
          <span class="set-label">{STR.DATA_PALETTE}</span>
          <div class="set-chips">
            {#each Object.entries(PALETTES) as [id, p] (id)}
              <button class:active={pal.id === id} onclick={() => setDataPalette(id)}>
                <span class="dots">
                  {#each p.colors.slice(0, 3) as c (c)}
                    <span class="dot" style="background: {c}"></span>
                  {/each}
                </span>
                {p.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="set-row">
          <span class="set-label">{STR.THICK_STROKES}</span>
          <div class="set-chips">
            <button class:active={!app.ui.bold} onclick={() => app.ui.bold && toggleBold()}>off</button>
            <button class:active={app.ui.bold} onclick={() => !app.ui.bold && toggleBold()}>on</button>
          </div>
        </div>
      </div>
    {/if}
    <footer>
      {@render utils('')}
    </footer>
  {:else}
    <!-- collapsed rail, ChatGPT style: logo (→ expand icon on hover) + icon
         shortcuts; the experiment tree only exists expanded -->
    <div class="rail">
      <button class="rail-btn rail-brand" onclick={toggleSidebar} title="{STR.COLLAPSE_SIDEBAR} (⌘B)">
        <span class="logo"><AppIcon size={24} /></span>
        <span class="expand"><Icon name="panel-left" size={16} /></span>
      </button>
      <button class="rail-btn" onclick={() => (app.ui.palette = true)} title="{STR.SEARCH} (⌘K)">
        <Icon name="search" size={15} />
      </button>
      <div class="rail-spacer"></div>
      {@render utils('rail-btn')}
    </div>
  {/if}
</aside>
