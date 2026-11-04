import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal, type Signal } from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'
import { createOpenEditorCommand } from '@src/lib/editors/commands'
import { defaultEditorExtensions } from '@src/lib/editors/defaults'
import { provideCommand } from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { keymapEventOwnersValueSpec } from '@src/registry/contracts/keymap'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import {
  editorCapabilityValueSpec,
  editorsService,
  type Editor,
  type EditorsService,
} from '@src/lib/editors/registry/contract'

/** Owns views and their live capability bindings, without file reads or execution. */
export default defineRegistryItemFactory(({ valueSpecs, services }) => {
  if (!IS_STAGING_OR_DEBUG) return { id: 'editors' }
  const editors = signal<readonly Editor[]>([])
  const editorCapabilities = valueSpecs.signal(editorCapabilityValueSpec)
  const subscriptions = new Map<symbol, () => void>()
  const sources = new Map<symbol, Signal<string>>()
  const service: EditorsService = {
    editors,
    openEditor: (src, contents) => {
      const current = editors.peek()
      const source = signal(src)
      const editorType = computed(() =>
        fsZds.extname(source.value).toLowerCase()
      )
      const matchingCapabilities = computed(() =>
        editorCapabilities.value
          .filter(
            (capability) =>
              capability.editorType === '*' ||
              capability.editorType.toLowerCase() === editorType.value
          )
          .map(({ capabilities }) => capabilities)
      )
      const capabilities = new Compartment()
      let extensions = matchingCapabilities.value
      const view = new EditorView({
        doc: contents,
        extensions: [capabilities.of(extensions)],
      })
      const editor: Editor = {
        id: Symbol(src),
        src: source,
        type: editorType,
        view,
      }
      const unsubscribe = matchingCapabilities.subscribe((next) => {
        if (
          next.length === extensions.length &&
          next.every((extension, index) => extension === extensions[index])
        ) {
          return
        }
        extensions = next
        view.dispatch({ effects: capabilities.reconfigure(extensions) })
      })
      const id = editor.id
      // Capture the creating opening; a later project selection must not adopt this view.
      const lifetime = services
        .optional(projectSessionService)
        ?.currentSession.peek()?.signal
      const close = () => service.closeEditor(id)
      lifetime?.addEventListener('abort', close, { once: true })
      subscriptions.set(id, () => {
        lifetime?.removeEventListener('abort', close)
        unsubscribe()
      })
      sources.set(editor.id, source)
      editors.value = [...current, editor]
      return editor
    },
    setSource: (id, src) => {
      const source = sources.get(id)
      if (source) source.value = src
    },
    closeEditor: (id) => {
      const current = editors.peek()
      const editor = current.find((editor) => editor.id === id)
      if (!editor) return
      subscriptions.get(id)?.()
      subscriptions.delete(id)
      sources.delete(id)
      editor.view.destroy()
      editors.value = current.filter((editor) => editor.id !== id)
    },
  }
  return {
    id: 'editors',
    uses: [],
    provides: [
      // History belongs to this view, rather than the legacy executing editor.
      // Other shortcuts remain available to the application's global keymap.
      provide(keymapEventOwnersValueSpec, {
        id: 'editors.history',
        scope: 'editors.history.focused',
        owns: (event) =>
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          ['z', 'y'].includes(event.key.toLowerCase()) &&
          editors
            .peek()
            .some((editor) => event.composedPath().includes(editor.view.dom)),
      }),
      provide(editorCapabilityValueSpec, {
        id: 'editors.defaults',
        editorType: '*',
        capabilities: defaultEditorExtensions(),
      }),
      provideCommand(
        createOpenEditorCommand(
          service,
          () => services.optional(projectSessionService),
          () => services.get(fileOperationsService)
        )
      ),
    ],
    providesServices: [provideService(editorsService, service)],
    dispose: () => {
      for (const editor of editors.peek()) {
        subscriptions.get(editor.id)?.()
        editor.view.destroy()
      }
      subscriptions.clear()
      sources.clear()
      editors.value = []
    },
  }
}, 'editors')
