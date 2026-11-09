import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import {
  computed,
  effect,
  signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import { editorsExtension } from '@src/lib/editors/registry'
import {
  editorViewValueSpec,
  editorsService,
  type EditorViewContribution,
} from '@src/lib/editors/registry/contract'
import { executorsExtension } from '@src/lib/executors/registry'
import {
  executorCapabilityValueSpec,
  executorsService,
  type ExecutorCapability,
} from '@src/lib/executors/registry/contract'
import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import type {
  ActiveEditorDialog,
  EditorDialogsService,
} from '@src/lib/editorDialogs/registry/contract'

/** Child registries share contributed modes and computations, while keeping editor IO capabilities local. */
export function createEditorDialogs(
  views: ReadonlySignal<readonly EditorViewContribution[]>,
  capabilities: ReadonlySignal<readonly ExecutorCapability[]>
): EditorDialogsService {
  const active = signal<ActiveEditorDialog | undefined>(undefined)
  let disposeActive = () => {}
  const close = () => {
    active.value = undefined
    disposeActive()
    disposeActive = () => {}
  }
  return {
    active,
    close,
    executorFor: (editor) =>
      active.peek()?.editor === editor ? active.peek()?.executor : undefined,
    open: (options) => {
      close()
      const resources = createEditorCleanup()
      const registry = new Registry()
      resources.onDispose(() => registry[Symbol.dispose]())
      try {
        registry.configure([editorsExtension, executorsExtension])
        const editors = registry.get(editorsService)
        const editor = editors.createEditor(options.contents, {
          documentType: options.documentType,
        })
        const unbind = options.bind?.(editor)
        if (unbind) resources.onDispose(unbind)
        const executor = registry.get(executorsService).createExecutor(editor)
        const submitting = signal(false)
        const submissionError = signal<Error | undefined>(undefined)
        resources.onDispose(
          editor.contents.subscribe(() => {
            submissionError.value = undefined
          })
        )
        const opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : undefined
        const result = computed(() => {
          const output = executor.output.value
          return !output.running && output.contents === editor.contents.value
            ? output.get(options.capability)
            : undefined
        })
        const error = computed(
          () =>
            submissionError.value ??
            executor.output.value.errors[options.capability.id]
        )
        const dialog: ActiveEditorDialog = {
          id: crypto.randomUUID(),
          title: options.title,
          editor,
          editors,
          executor,
          error,
          submitting,
          canSubmit: computed(() => Boolean(result.value) && !submitting.value),
          cancel: close,
          submit: async () => {
            const data = result.peek()
            if (!data || submitting.peek() || active.peek() !== dialog) return
            const document = editor.view.state.doc
            submitting.value = true
            submissionError.value = undefined
            try {
              const prepared = await options.prepareSubmit(data)
              if (active.peek() !== dialog) return
              if (editor.view.state.doc !== document) {
                submissionError.value = new Error(
                  'The draft changed during review. Submit again to review its current contents.'
                )
                return
              }
              if (prepared instanceof Error) {
                submissionError.value = prepared
                return
              }
              const error = prepared.commit()
              if (error) submissionError.value = error
              else close()
            } catch (cause) {
              if (active.peek() === dialog)
                submissionError.value =
                  cause instanceof Error ? cause : new Error(String(cause))
            } finally {
              submitting.value = false
            }
          },
        }
        active.value = dialog
        disposeActive = () => {
          resources.dispose()
          if (opener?.isConnected) opener.focus()
        }
        // Binding context and the executor exist before a Form provider can run.
        resources.onDispose(
          effect(() => {
            const modes = views.value.filter(
              (view) => view.id !== 'editors.code'
            )
            registry.configure([
              editorsExtension,
              executorsExtension,
              defineRegistryItem({
                provides: [
                  ...modes.map((view) => provide(editorViewValueSpec, view)),
                  ...capabilities.value.map((capability) =>
                    provide(executorCapabilityValueSpec, capability)
                  ),
                ],
              }),
            ])
          })
        )
        return dialog
      } catch (cause) {
        if (active.peek()?.editor) active.value = undefined
        resources.dispose()
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Construction must fail atomically after releasing its temporary registry.
        throw cause
      }
    },
  }
}
