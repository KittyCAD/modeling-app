import { signal, type ReadonlySignal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'

/** A view contributes command definitions; the shared command service owns discovery and invocation. */
export interface ContextualCommandSource {
  commands: ReadonlySignal<readonly Command[]>
  scopes: ReadonlySignal<readonly string[]>
}
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
