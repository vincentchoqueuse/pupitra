// Svelte action for the "click outside closes it" pattern used across the
// chrome (drawer, mobile sidebar overlay, inspector, header popovers, the
// Prompt Bar pill popover). Listens for pointerdown on window — not
// mousedown/click — matching the convention already hand-rolled in
// Header.svelte/PromptBar.svelte: pointerdown fires at gesture START, so a
// drag that BEGINS inside the node (e.g. dragging a range slider in a
// popover) is never treated as "outside" just because the pointer later
// leaves the node's bounds while dragging.
//
// Escape-to-close stays a separate, per-component concern and is not folded
// in here: consumers already own their own Escape handling (or, for the
// drawer, deliberately don't yet — out of scope for this fix).

/**
 * @param {HTMLElement} node
 * @param {{ enabled?: boolean, handler: (event: PointerEvent) => void }} params
 *   `enabled` lets a consumer whose node stays mounted while logically
 *   closed (e.g. the drawer, always in the DOM behind a CSS transform) gate
 *   the action without unmounting it.
 */
export function clickOutside(node, { enabled = true, handler }) {
  function onPointerDown(e) {
    if (enabled && !node.contains(e.target)) handler(e);
  }

  window.addEventListener('pointerdown', onPointerDown);

  return {
    update(params) {
      enabled = params.enabled ?? true;
      handler = params.handler;
    },
    destroy() {
      window.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
