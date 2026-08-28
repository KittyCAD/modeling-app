import { type ReadonlySignal, effect } from '@preact/signals'
import type { SceneMode } from '@src/contracts/sceneModes'

export interface ModeKeymapScopeDependencies {
  active: ReadonlySignal<SceneMode | null>
  applyScope: (scopeId: string) => void
  removeScope: (scopeId: string) => void
}

/**
 * Hold the active mode's keymap scope, and only that one.
 *
 * This is the whole of "modal keys": `e` extrudes in Modeling because the
 * binding is scoped to Modeling's scope, and that scope is applied exactly while
 * the mode is active. Neither the keymap nor the binding learns what a mode is.
 *
 * Removing the previous scope before applying the next is the part that matters.
 * Scopes stack, so a switcher that only applied would leave every mode ever
 * visited live at once — and the first key bound in two modes would resolve to
 * whichever scope happened to outrank the other.
 */
export function syncModeKeymapScope(
  dependencies: ModeKeymapScopeDependencies
): () => void {
  const { active, applyScope, removeScope } = dependencies

  let held: string | null = null

  const stop = effect(() => {
    const wanted = active.value?.keymapScope ?? null
    if (wanted === held) return

    if (held) removeScope(held)
    held = wanted
    if (wanted) applyScope(wanted)
  })

  return () => {
    stop()
    // The scope belongs to the mode being active, and nothing is active once
    // this is disposed.
    if (held) removeScope(held)
    held = null
  }
}
