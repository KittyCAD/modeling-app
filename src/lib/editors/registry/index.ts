import { Compartment, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import {
  computed,
  signal,
  type Signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'
import { createOpenEditorCommand } from '@src/lib/editors/commands'
import { CodeMirrorView } from '@src/lib/editors/CodeMirrorView'
import { defaultEditorExtensions } from '@src/lib/editors/defaults'
import { provideCommand } from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { keymapEventOwnersValueSpec } from '@src/registry/contracts/keymap'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import {
  editorCapabilityValueSpec,
  editorViewValueSpec,
  editorsService,
  type Editor,
  type EditorsService,
  type EditorCapability,
  type EditorViewState,
} from '@src/lib/editors/registry/contract'

/** Owns views and their live capability bindings, without file reads or execution. */
const extension = defineRegistryItemFactory(({ valueSpecs, services }) => {
  const editors = signal<readonly Editor[]>([])
  const editorCapabilities = valueSpecs.signal(editorCapabilityValueSpec)
  const editorViews = valueSpecs.signal(editorViewValueSpec)
  const presentations = new WeakMap<
    Editor,
    {
      choice: Signal<string | undefined>
      state: ReadonlySignal<EditorViewState>
    }
  >()
  const presentationFor = (editor: Editor) => {
    let presentation = presentations.get(editor)
    if (!presentation) {
      const choice = signal<string | undefined>(undefined)
      const state = computed(() => {
        const available = editorViews.value
          .filter((view) =>
            matchesEditor(view.matches, editorMatchContext(editor))
          )
          .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        return {
          available,
          selected:
            available.find((view) => view.id === choice.value) ?? available[0],
        }
      })
      presentation = { choice, state }
      presentations.set(editor, presentation)
    }
    return presentation
  }
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
      const text = signal(contents)
      let publishingContents = false
      let closed = false
      let reconfigureQueued = false
      const capabilities = new Compartment()
      const view = new EditorView({
        doc: contents,
        extensions: [
          capabilities.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            publishingContents = true
            try {
              text.value = update.state.doc.toString()
            } finally {
              publishingContents = false
            }
          }),
        ],
      })
      text.value = view.state.doc.toString()
      const editor: Editor = {
        id: Symbol(src),
        src: source,
        type: editorType,
        contents: text,
        view,
      }
      // Construct editor-specific extensions once per contribution, preserving
      // their identity when a rename or registry update changes other matches.
      const instances = new WeakMap<EditorCapability, Extension>()
      const matchingCapabilities = computed(() =>
        editorCapabilities.value
          .filter((capability) =>
            matchesEditor(capability.matches, editorMatchContext(editor))
          )
          .map((capability) => {
            let instance = instances.get(capability)
            if (!instance) {
              instance =
                typeof capability.capabilities === 'function'
                  ? capability.capabilities(editor)
                  : capability.capabilities
              instances.set(capability, instance)
            }
            return instance
          })
      )
      let extensions = matchingCapabilities.value
      view.dispatch({ effects: capabilities.reconfigure(extensions) })
      const applyCapabilities = (next: Extension[]) => {
        if (
          next.length === extensions.length &&
          next.every((extension, index) => extension === extensions[index])
        ) {
          return
        }
        extensions = next
        view.dispatch({ effects: capabilities.reconfigure(extensions) })
      }
      const unsubscribe = matchingCapabilities.subscribe((next) => {
        if (!publishingContents) {
          applyCapabilities(next)
          return
        }
        // CodeMirror forbids dispatching another update from its update listener.
        // Coalesce content-driven reconfiguration, retaining only the latest matches.
        if (reconfigureQueued) return
        reconfigureQueued = true
        queueMicrotask(() => {
          reconfigureQueued = false
          if (!closed) applyCapabilities(matchingCapabilities.peek())
        })
      })
      const id = editor.id
      // Capture the creating opening; a later project selection must not adopt this view.
      const lifetime = services
        .optional(projectSessionService)
        ?.currentSession.peek()?.signal
      const close = () => service.closeEditor(id)
      lifetime?.addEventListener('abort', close, { once: true })
      subscriptions.set(id, () => {
        closed = true
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
    viewState: (editor) => presentationFor(editor).state,
    setView: (id, viewId) => {
      const editor = editors.peek().find((editor) => editor.id === id)
      if (!editor) return
      const presentation = presentationFor(editor)
      if (
        presentation.state.peek().available.some((view) => view.id === viewId)
      )
        presentation.choice.value = viewId
    },
    closeEditor: (id) => {
      const current = editors.peek()
      const editor = current.find((editor) => editor.id === id)
      if (!editor) return
      subscriptions.get(id)?.()
      subscriptions.delete(id)
      sources.delete(id)
      presentations.delete(editor)
      editor.view.destroy()
      editors.value = current.filter((editor) => editor.id !== id)
    },
  }
  return {
    id: 'editors',
    uses: [],
    provides: [
      provide(editorViewValueSpec, {
        id: 'editors.code',
        label: 'Code',
        matches: '*',
        priority: -100,
        Component: CodeMirrorView,
      }),
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
        matches: '*',
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
        presentations.delete(editor)
      }
      subscriptions.clear()
      sources.clear()
      editors.value = []
    },
  }
}, 'editors')

export default withProjectShellFeature(extension, 'editors')
