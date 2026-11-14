import type { EditorView as NativeEditorView } from '@codemirror/view'
import { type Signal, signal } from '@preact/signals-core'
import { CodeMirrorView } from '@src/lib/editors/CodeMirrorView'
import { watchEditorCapabilities } from '@src/lib/editors/capabilities'
import { createEditorClassification } from '@src/lib/editors/classification'
import { createCodeSurface } from '@src/lib/editors/codeSurface'
import {
  createOpenEditorCommand,
  NEW_EDITOR_COMMAND,
} from '@src/lib/editors/commands'
import { createEditorContextBoundary } from '@src/lib/editors/contextBoundary'
import { defaultEditorExtensions } from '@src/lib/editors/defaults'
import { createEditorDocument } from '@src/lib/editors/document'
import { createEditorHistory } from '@src/lib/editors/history'
import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import { createEditorModes } from '@src/lib/editors/modes'
import {
  observations as editorsObservations,
  codeEditorsExtensionFacet,
  type Editor,
  type EditorsService,
  type EditorViewInstance,
  type EditorViewState,
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { observations as nextProjectSessionObservations } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr } from '@src/lib/trap'
import {
  GLOBAL_COMMAND_SCOPES,
  provideCommand,
} from '@src/registry/contracts/commands'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { keymapEventOwnersFacet } from '@src/registry/contracts/keymap'
import {
  factory as defineFactory,
  contribute,
  type InputOf,
  provide,
  type Factory,
} from 'plankton'
import { createElement } from 'react'

/** All resources for an editor share one owner, including while contributed code initializes it. */
interface EditorRecord {
  editor: Editor
  language: ReturnType<typeof createEditorClassification>
  source: Signal<string | undefined>
  dispose: () => void
}

/** The service owns buffers; capability and mode lifecycles are scoped to each record. */
const extension: Factory = defineFactory({
  dependencies: {
    editors: editorsObservations,
    nextProjectSession: nextProjectSessionObservations,
    fileOperations: fileOperationsObservations,
  },
  key: 'editors',
  create: ({
    editors: editorsInputs,
    nextProjectSession: nextProjectSessionInputs,
    fileOperations: fileOperationsInputs,
  }) => {
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
      binding: {
        type: 'unbound',
      },
    })
    const capabilities = editorsInputs.editorCapabilityFacet
    const views = editorsInputs.editorViewsFacet
    const codeExtensions = editorsInputs.codeEditorsExtensionFacet
    const languages = editorsInputs.editorLanguagesFacet
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
        const blocked = contextBoundary.checkCanManageEditors()
        if (blocked) return blocked
        if (!records.has(editor.id)) return new Error('The editor is closed')
        const resources = createEditorCleanup()
        const instance: EditorViewInstance = {
          id: Symbol('editor-view'),
          editor,
          element: signal<HTMLElement | undefined>(undefined),
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
          return new Error('The editor closed during view initialization')
        return instance
      },
      closeView: (id) => {
        const blocked = contextBoundary.checkCanManageEditors()
        if (blocked) return blocked
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
      createEditor: (contents = '') => service.openEditor(undefined, contents),
      openEditor: (src, contents) => {
        const blocked = contextBoundary.checkCanManageEditors()
        if (blocked) return blocked
        if (disposed) return new Error('The editors service is closed')
        // A later project selection must not adopt resources being constructed for this opening.
        const lifetime =
          nextProjectSessionInputs.projectSessionService.current.value?.currentSession.peek()
            ?.signal
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
          lifetime?.addEventListener('abort', close, {
            once: true,
          })
          resources.onDispose(() =>
            lifetime?.removeEventListener('abort', close)
          )
          resources.onDispose(
            watchEditorCapabilities(editor, capabilities, contextBoundary)
          )
          if (resources.closed || lifetime?.aborted || disposed) {
            closeEditor(editor.id)
            resources.dispose()
            return new Error('The editor closed during initialization')
          }
          // Subscribers may react to publication; always append to the current collection.
          editors.value = [...editors.peek(), editor]
          return editor
        } catch (cause) {
          closeEditor(editor.id)
          resources.dispose()
          return isErr(cause) ? cause : new Error(String(cause))
        }
      },
      setSource: (id, src) => {
        const blocked = contextBoundary.checkCanManageEditors()
        if (blocked) return blocked
        const record = records.get(id)
        if (!record) return
        record.source.value = src
        for (const presentation of presentationRecords.values())
          if (presentation.instance.editor === record.editor)
            presentation.modes.refresh()
      },
      setLanguage: (id, languageId) => {
        const blocked = contextBoundary.checkCanManageEditors()
        if (blocked) return blocked
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
        const blocked = contextBoundary.checkCanManageEditors()
        if (blocked) return blocked
        presentationRecords.get(id)?.modes.select(viewId)
      },
      closeEditor: (id) => {
        const blocked = contextBoundary.checkCanManageEditors()
        if (blocked) return blocked
        closeEditor(id)
      },
    }
    const history = createEditorHistory(presentations)
    const _editorViewsContribution: InputOf<typeof editorViewsFacet> =
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
          createElement(CodeMirrorView, {
            view: context,
            active,
          }),
      })
    const _keymapEventOwnersContribution: InputOf<
      typeof keymapEventOwnersFacet
    > = {
      id: 'editors.history',
      scope: 'editors.history.focused',
      owns: history.ownsKeyEvent,
    } satisfies InputOf<typeof keymapEventOwnersFacet>
    const _codeEditorsExtensionContribution: InputOf<
      typeof codeEditorsExtensionFacet
    > = {
      id: 'editors.defaults',
      matches: '*',
      extensions: defaultEditorExtensions,
    } satisfies InputOf<typeof codeEditorsExtensionFacet>
    return {
      items: [
        contribute(editorViewsFacet, () => _editorViewsContribution),
        contribute(
          keymapEventOwnersFacet,
          () => _keymapEventOwnersContribution
        ),
        contribute(
          codeEditorsExtensionFacet,
          () => _codeEditorsExtensionContribution
        ),
        provideCommand({
          ...NEW_EDITOR_COMMAND,
          displayName: 'New editor',
          description: 'Create an empty, unsaved buffer.',
          scopes: GLOBAL_COMMAND_SCOPES,
          icon: 'code',
          needsReview: false,
          onSubmit: () => {
            const editor = service.createEditor()
            if (isErr(editor)) return editor
            const view = service.createView(editor, 'editors.code')
            if (isErr(view)) {
              service.closeEditor(editor.id)
              return view
            }
            return editor
          },
        }),
        provideCommand(
          createOpenEditorCommand(
            service,
            () => nextProjectSessionInputs.projectSessionService.current.value,
            () => fileOperationsInputs.fileOperationsService.required()
          )
        ),
        provide(editorsService, service),
      ],
      dispose: () => {
        if (disposed) return
        disposed = true
        history.dispose()
        for (const id of [...records.keys()]) closeEditor(id)
      },
    }
  },
})
export default withProjectShellFeature(extension, 'editors')
