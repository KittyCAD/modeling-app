import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { signal, type Signal } from '@preact/signals-core'
import { watchEditorCapabilities } from '@src/lib/editors/capabilities'
import { CodeMirrorView } from '@src/lib/editors/CodeMirrorView'
import {
  createOpenEditorCommand,
  NEW_EDITOR_COMMAND,
} from '@src/lib/editors/commands'
import { defaultEditorExtensions } from '@src/lib/editors/defaults'
import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import { createEditorModes } from '@src/lib/editors/modes'
import {
  type Editor,
  type EditorsService,
  type EditorViewState,
  editorCapabilityValueSpec,
  editorLanguageValueSpec,
  editorsService,
  editorViewValueSpec,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { createEditorClassification } from '@src/lib/editors/classification'
import { createEditorContextBoundary } from '@src/lib/editors/contextBoundary'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import {
  GLOBAL_COMMAND_SCOPES,
  provideCommand,
} from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { keymapEventOwnersValueSpec } from '@src/registry/contracts/keymap'

/** All resources for an editor share one owner, including while contributed code initializes it. */
interface EditorRecord {
  editor: Editor
  language: ReturnType<typeof createEditorClassification>
  source: Signal<string | undefined>
  modes: ReturnType<typeof createEditorModes>
  dispose: () => void
}

/** The service owns buffers; capability and mode lifecycles are scoped to each record. */
const extension = defineRegistryItemFactory(({ valueSpecs, services }) => {
  const editors = signal<readonly Editor[]>([])
  const records = new Map<symbol, EditorRecord>()
  const closedViewState = signal<EditorViewState>({
    available: [],
    selected: undefined,
    binding: { type: 'unbound' },
  })
  const capabilities = valueSpecs.signal(editorCapabilityValueSpec)
  const views = valueSpecs.signal(editorViewValueSpec)
  const languages = valueSpecs.signal(editorLanguageValueSpec)
  const contextBoundary = createEditorContextBoundary()
  // Internal project/service shutdown must still release resources if triggered from contributed code.
  const closeEditor = (id: symbol) => {
    const record = records.get(id)
    if (!record) return
    records.delete(id)
    editors.value = editors.peek().filter((editor) => editor.id !== id)
    record.dispose()
  }
  let disposed = false
  const service: EditorsService = {
    editors,
    createEditor: (contents = '') => service.openEditor(undefined, contents),
    openEditor: (src, contents) => {
      contextBoundary.assertCanManageEditors()
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- This synchronous API cannot produce an editor after shutdown.
      if (disposed) throw new Error('The editors service is closed')
      // A later project selection must not adopt resources being constructed for this opening.
      const lifetime = services
        .optional(projectSessionService)
        ?.currentSession.peek()?.signal
      const resources = createEditorCleanup()
      const source = signal(src)
      const text = signal(contents)
      let publishingContents = false
      const compartment = new Compartment()
      const view = new EditorView({
        doc: contents,
        extensions: [
          compartment.of([]),
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
      resources.onDispose(() => view.destroy())
      text.value = view.state.doc.toString()
      const language = createEditorClassification(source, text, languages)
      const editor: Editor = {
        id: Symbol(src),
        src: source,
        contents: text,
        view,
        classification: language.classification,
      }
      try {
        const modes = createEditorModes(editor, views, contextBoundary)
        resources.onDispose(modes.dispose)
        // Register before contributed code runs, so project shutdown can release partial initialization.
        records.set(editor.id, {
          editor,
          source,
          language,
          modes,
          dispose: resources.dispose,
        })
        const close = () => closeEditor(editor.id)
        lifetime?.addEventListener('abort', close, { once: true })
        resources.onDispose(() => lifetime?.removeEventListener('abort', close))
        resources.onDispose(
          watchEditorCapabilities(
            editor,
            capabilities,
            compartment,
            () => publishingContents
          )
        )
        modes.refresh()
        if (resources.closed || lifetime?.aborted || disposed)
          // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Do not return a destroyed editor from the synchronous creation API.
          throw new Error('The editor closed during initialization')
        // Subscribers may react to publication; always append to the current collection.
        editors.value = [...editors.peek(), editor]
        return editor
      } catch (cause) {
        closeEditor(editor.id)
        resources.dispose()
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Preserve the capability failure after rolling back synchronous construction.
        throw cause
      }
    },
    setSource: (id, src) => {
      contextBoundary.assertCanManageEditors()
      const record = records.get(id)
      if (!record) return
      record.source.value = src
      record.modes.refresh()
    },
    setLanguage: (id, languageId) => {
      contextBoundary.assertCanManageEditors()
      const record = records.get(id)
      if (!record) return new Error('The editor is closed')
      const result = record.language.select(languageId)
      record.modes.refresh()
      return result
    },
    // A departing React panel may render once more after its editor has closed.
    viewState: (editor) =>
      records.get(editor.id)?.modes.state ?? closedViewState,
    setView: (id, viewId) => {
      contextBoundary.assertCanManageEditors()
      records.get(id)?.modes.select(viewId)
    },
    closeEditor: (id) => {
      contextBoundary.assertCanManageEditors()
      closeEditor(id)
    },
  }
  return {
    id: 'editors',
    provides: [
      provide(
        editorViewValueSpec,
        defineEditorView({
          id: 'editors.code',
          label: 'Code',
          matches: '*',
          priority: -100,
          Component: CodeMirrorView,
        })
      ),
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
        capabilities: defaultEditorExtensions,
      }),
      provideCommand({
        ...NEW_EDITOR_COMMAND,
        displayName: 'New editor',
        description: 'Create an empty, unsaved buffer.',
        scopes: GLOBAL_COMMAND_SCOPES,
        icon: 'code',
        needsReview: false,
        onSubmit: () => service.createEditor(),
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
      if (disposed) return
      disposed = true
      for (const id of [...records.keys()]) closeEditor(id)
    },
  }
}, 'editors')

export default withProjectShellFeature(extension, 'editors')
