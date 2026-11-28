import { signal, type ReadonlySignal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'

/** A view's command definitions and the scopes to apply while it is active. */
export interface ContextualCommandSource {
  commands: ReadonlySignal<readonly Command[]>
  scopes: ReadonlySignal<readonly string[]>
}
/**
 * Choose the view whose commands the shared command palette and keymap use.
 * The commands extension combines the active source with commandsFacet; the
 * active source wins when command IDs match. It also applies that source's scopes.
 * Callers activate a source on focus and retain it while the palette is open.
 *
 * The modeling-machine migration needs this because createMachineCommands builds
 * definitions around a particular actor and its current state. Two Modeling views
 * can offer "Extrude" under the same command ID while targeting different actors.
 * Activating one view's definitions lets those existing commands work with one
 * shared command palette, without creating a command-palette actor per view.
 *
 * Future tool extensions can register commands once through provideCommand and
 * keybindings through provideKeymapItem, then resolve the intended view when a
 * command runs. Availability can follow that view's state through command scopes
 * and disabled checks. The camera commands in lib/kcl/registry/cameraCommands.ts
 * use this approach and retain the originating view while the palette is open.
 * Once the remaining commands use it, this service and the commands extension's
 * handling of contextual definitions and scopes can be removed.
 */
export function createContextualCommands() {
  const active = signal<ContextualCommandSource | undefined>(undefined)
  let disposed = false
  return {
    active,
    clear: () => {
      active.value = undefined
    },
    register(source: ContextualCommandSource) {
      let closed = false
      const deactivate = () => {
        if (active.peek() === source) active.value = undefined
      }
      return {
        activate: () => {
          if (!closed && !disposed) active.value = source
        },
        deactivate,
        dispose: () => {
          closed = true
          deactivate()
        },
      }
    },
    dispose: () => {
      disposed = true
      active.value = undefined
    },
  }
}
export type ContextualCommandsService = Pick<
  ReturnType<typeof createContextualCommands>,
  'register' | 'clear'
>
