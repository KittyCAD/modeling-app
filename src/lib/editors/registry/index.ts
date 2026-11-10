import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { signal, type Signal } from '@preact/signals-core'
import { watchEditorCapabilities } from '@src/lib/editors/capabilities'
import { createElement } from 'react'
import type { EditorView as NativeEditorView } from '@codemirror/view'
import { createEditorDocument } from '@src/lib/editors/document'
import { createCodeSurface } from '@src/lib/editors/codeSurface'
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
  type EditorViewInstance,
  codeEditorExtensionValueSpec,
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
  dispose: () => void
}

/** The service owns buffers; capability and mode lifecycles are scoped to each record. */
const extension = defineRegistryItemFactory(({ valueSpecs, services }) => {
  const editors = signal<readonly Editor[]>([])
  const records = new Map<symbol, EditorRecord>()
  const presentations = signal<readonly EditorViewInstance[]>([])
  const presentationRecords = new Map<
    symbol,
    {
      instance: EditorViewInstance
      modes: ReturnType<typeof createEditorModes>
      dispose: () => void
    }
  >()
  const closedViewState = signal<EditorViewState>({
    available: [],
    selected: undefined,
    binding: { type: 'unbound' },
  })
  const capabilities = valueSpecs.signal(editorCapabilityValueSpec)
  const views = valueSpecs.signal(editorViewValueSpec)
  const codeExtensions = valueSpecs.signal(codeEditorExtensionValueSpec)
  const languages = valueSpecs.signal(editorLanguageValueSpec)
  const contextBoundary = createEditorContextBoundary()
  // Internal project/service shutdown must still release resources if triggered from contributed code.
  const closeEditor = (id: symbol) => {
    const record = records.get(id)
    if (!record) return
    records.delete(id)
    for (const [viewId, presentation] of presentationRecords) {
      if (presentation.instance.editor === record.editor) {
        presentationRecords.delete(viewId)
        presentation.dispose()
      }
    }
    presentations.value = presentations
      .peek()
      .filter((instance) => instance.editor !== record.editor)
    editors.value = editors.peek().filter((editor) => editor.id !== id)
    record.dispose()
  }
  let disposed = false
  const service: EditorsService = {
    editors,
    views: presentations,
    createView: (editor, modeId) => {
      contextBoundary.assertCanManageEditors()
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- A closed buffer cannot acquire a presentation.
      if (!records.has(editor.id)) throw new Error('The editor is closed')
      const resources = createEditorCleanup()
      const instance: EditorViewInstance = {
        id: Symbol('editor-view'),
        editor,
        codeView: signal<NativeEditorView | undefined>(undefined),
      }
      const modes = createEditorModes(instance, views, contextBoundary)
      resources.onDispose(modes.dispose)
      presentationRecords.set(instance.id, {
        instance,
        modes,
        dispose: resources.dispose,
      })
      presentations.value = [...presentations.peek(), instance]
      if (modeId) modes.select(modeId)
      else modes.refresh()
      if (resources.closed || editor.signal.aborted)
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- A closed document cannot return a usable presentation.
        throw new Error('The editor closed during view initialization')
      return instance
    },
    closeView: (id) => {
      contextBoundary.assertCanManageEditors()
      const record = presentationRecords.get(id)
      if (!record) return
      presentationRecords.delete(id)
      presentations.value = presentations
        .peek()
        .filter((instance) => instance.id !== id)
      record.dispose()
      if (
        !presentations
          .peek()
          .some((instance) => instance.editor === record.instance.editor)
      )
        closeEditor(record.instance.editor.id)
    },
    createEditor: (contents = '', options) =>
      service.openEditor(undefined, contents, options),
    openEditor: (src, contents, options) => {
      contextBoundary.assertCanManageEditors()
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- This synchronous API cannot produce an editor after shutdown.
      if (disposed) throw new Error('The editors service is closed')
      // A later project selection must not adopt resources being constructed for this opening.
      const lifetime = services
        .optional(projectSessionService)
        ?.currentSession.peek()?.signal
      const resources = createEditorCleanup()
      const source = signal(src)
      const backing = createEditorDocument(contents)
      resources.onDispose(backing.dispose)
      const text = backing.document.contents
      const language = createEditorClassification(source, text, languages)
      const editor: Editor = {
        ...backing.document,
        get state() {
          return backing.document.state
        },
        id: Symbol(src),
        documentType: options?.documentType,
        src: source,
        contents: text,
        classification: language.classification,
      }
      try {
        // Register before contributed code runs, so project shutdown can release partial initialization.
        records.set(editor.id, {
          editor,
          source,
          language,
          dispose: resources.dispose,
        })
        const close = () => closeEditor(editor.id)
        lifetime?.addEventListener('abort', close, { once: true })
        resources.onDispose(() => lifetime?.removeEventListener('abort', close))
        resources.onDispose(
          watchEditorCapabilities(editor, capabilities, contextBoundary)
        )
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
      for (const presentation of presentationRecords.values())
        if (presentation.instance.editor === record.editor)
          presentation.modes.refresh()
    },
    setLanguage: (id, languageId) => {
      contextBoundary.assertCanManageEditors()
      const record = records.get(id)
      if (!record) return new Error('The editor is closed')
      const result = record.language.select(languageId)
      for (const presentation of presentationRecords.values())
        if (presentation.instance.editor === record.editor)
          presentation.modes.refresh()
      return result
    },
    // A departing React panel may render once more after its editor has closed.
    viewState: (instance) =>
      presentationRecords.get(instance.id)?.modes.state ?? closedViewState,
    setView: (id, viewId) => {
      contextBoundary.assertCanManageEditors()
      presentationRecords.get(id)?.modes.select(viewId)
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
        defineEditorView((host) => {
          const view = createCodeSurface(host, codeExtensions, (callback) =>
            contextBoundary.run(callback)
          )
          const signal = host.instance.codeView as Signal<
            NativeEditorView | undefined
          >
          signal.value = view
          host.onDispose(() => {
            signal.value = undefined
          })
          return view
        })({
          id: 'editors.code',
          label: 'Code',
          matches: '*',
          priority: -100,
          Component: ({ context, active }) =>
            createElement(CodeMirrorView, { view: context, active }),
        })
      ),
      // Focused Code surfaces consume document undo shortcuts before the legacy global keymap.
      provide(keymapEventOwnersValueSpec, {
        id: 'editors.history',
        scope: 'editors.history.focused',
        owns: (event) =>
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          ['z', 'y'].includes(event.key.toLowerCase()) &&
          event
            .composedPath()
            .some(
              (target) =>
                target instanceof HTMLElement &&
                target.hasAttribute('data-editor-code')
            ),
      }),
      provide(codeEditorExtensionValueSpec, {
        id: 'editors.defaults',
        matches: '*',
        extensions: defaultEditorExtensions,
      }),
      provideCommand({
        ...NEW_EDITOR_COMMAND,
        displayName: 'New editor',
        description: 'Create an empty, unsaved buffer.',
        scopes: GLOBAL_COMMAND_SCOPES,
        icon: 'code',
        needsReview: false,
        onSubmit: () => {
          const editor = service.createEditor()
          service.createView(editor, 'editors.code')
          return editor
        },
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

export { extension as editorsExtension }

export default withProjectShellFeature(extension, 'editors')
