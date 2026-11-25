import { computed, effect, signal, untracked } from '@preact/signals-core'
import type {
  Editor,
  EditorViewInstance,
} from '@src/lib/editors/registry/contract'
import { observations as editorInputs } from '@src/lib/editors/registry/contract'
import { editorViewForTarget } from '@src/lib/editors/focus'
import { factory } from 'plankton'
import {
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
  observations as commandInputs,
  provideCommand,
  provideCommandScope,
} from '@src/registry/contracts/commands'
import { provideKeymapItem } from '@src/registry/contracts/keymap'

export const KCL_RENDER_COMMAND = 'kcl.render'
export const KCL_RENDER_SCOPE = 'kcl.render-focused'

/** Retain the editor that launched the palette; ordinary focus changes select an explicit document target. */
export function createRenderTargets(
  getViews: () => readonly EditorViewInstance[],
  paletteOpen: () => boolean
) {
  const targets = new Map<Editor, Set<() => Promise<void>>>()
  const changed = signal(0)
  const focused = signal<Editor | undefined>(undefined)
  const reconcile = () => {
    if (paletteOpen()) return
    focused.value = editorViewForTarget(
      getViews(),
      document.activeElement
    )?.editor
  }
  document.addEventListener('focusin', reconcile)
  return {
    available: computed(() => {
      void changed.value
      return !!focused.value && targets.has(focused.value)
    }),
    run: () => targets.get(focused.peek()!)?.values().next().value?.(),
    reconcile,
    attach: (editor: Editor, render: () => Promise<void>) => {
      let entries = targets.get(editor)
      if (!entries) {
        entries = new Set()
        targets.set(editor, entries)
      }
      entries.add(render)
      changed.value++
      reconcile()
      return () => {
        entries.delete(render)
        changed.value++
        if (!entries.size) targets.delete(editor)
        if (focused.peek() === editor && !targets.has(editor))
          focused.value = undefined
      }
    },
    dispose: () => {
      document.removeEventListener('focusin', reconcile)
      targets.clear()
      focused.value = undefined
    },
  }
}

export const renderCommands = factory({
  dependencies: { editors: editorInputs, commands: commandInputs },
  create: ({ editors, commands }) => {
    const paletteOpen = computed(
      () =>
        commands.commandScopeService.current.value?.activeScopes.value.includes(
          COMMAND_PALETTE_OPEN_COMMAND_SCOPE
        ) ?? false
    )
    const targets = createRenderTargets(
      () => editors.editorsService.current.value?.views.peek() ?? [],
      () => paletteOpen.peek()
    )
    return {
      exports: { attach: targets.attach },
      items: [
        provideCommandScope({
          id: KCL_RENDER_SCOPE,
          displayName: 'KCL editor focused',
          priority: 1200,
          userEditable: false,
        }),
        provideCommand({
          id: KCL_RENDER_COMMAND,
          name: KCL_RENDER_COMMAND,
          groupId: 'kcl',
          displayName: 'Render code',
          needsReview: false,
          scopes: [KCL_RENDER_SCOPE],
          get disabled() {
            return !targets.available.value
          },
          onSubmit: targets.run,
        }),
        provideKeymapItem({
          id: KCL_RENDER_COMMAND,
          command: KCL_RENDER_COMMAND,
          title: 'Render code',
          source: 'KCL',
          keystrokes: ['mod+enter'],
          when: [KCL_RENDER_SCOPE],
        }),
      ],
      start: () => {
        const stopScope = effect(() => {
          const scopes = commands.commandScopeService.current.value
          if (!scopes || !targets.available.value) return
          untracked(() => scopes.applyScope(KCL_RENDER_SCOPE))
          return () => untracked(() => scopes.removeScope(KCL_RENDER_SCOPE))
        })
        const stopPalette = effect(() => {
          if (!paletteOpen.value) untracked(targets.reconcile)
        })
        return () => {
          stopScope()
          stopPalette()
        }
      },
      dispose: targets.dispose,
    }
  },
})
