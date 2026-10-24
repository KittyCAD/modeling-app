import { batch, computed, effect, signal } from '@preact/signals-core'
import { resolveArguments } from '@src/components/ModelingDialog/arguments'
import type { KclManager } from '@src/lang/KclManager'
import {
  runModelingCodemod,
  type ModelingCodemod,
} from '@src/lang/modifyAst/modelingCodemod'
import { recast } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import type { CodeChangesPreviewPublisher } from '@src/lib/codeChangesPreview'
import { isErr } from '@src/lib/trap'
import type {
  CommandBarActorType,
  CommandBarContext,
} from '@src/machines/commandBarMachine'
import type { CodeChangesPreviewService } from '@src/registry/contracts/codeChangesPreview'

export type ModelingPreviewDraft = {
  context: CommandBarContext
  values: Record<string, unknown>
  incomplete: boolean
}

/** One dialog session. Source/draft changes cancel work; disposal ends the preview. */
export function createModelingCodePreview({
  kclManager,
  preview,
  commandBar,
}: {
  kclManager: KclManager
  preview: CodeChangesPreviewService
  commandBar: CommandBarActorType
}) {
  const owner = {}
  const initialPath = kclManager.path
  const command = commandBar.getSnapshot().context.selectedCommand
  const active = signal(true)
  const draft = signal<ModelingPreviewDraft | undefined>(undefined)
  let publisher: CodeChangesPreviewPublisher | undefined
  // Arguments are resolved below against the selected command's schema.
  const codemod =
    command && Object.hasOwn(modelingCommandCodemods, command.name)
      ? (modelingCommandCodemods[
          command.name as keyof typeof modelingCommandCodemods
        ] as ModelingCodemod<Record<string, unknown>>)
      : undefined
  const available = computed(
    () => active.value && kclManager.path === initialPath && Boolean(codemod)
  )
  const open = computed(() => preview.current.value?.owner === owner)
  const subscription = commandBar.subscribe((snapshot) => {
    if (
      snapshot.matches('Closed') ||
      snapshot.context.selectedCommand !== command
    ) {
      active.value = false
      preview.clear(owner)
    }
  })

  const stop = effect(() => {
    if (!open.value) return
    const currentDraft = draft.value
    if (!available.value || !command || !codemod || !currentDraft) {
      preview.clear(owner)
      return
    }
    const publish = publisher
    if (!publish) return
    const sourcePath = kclManager.path
    const sourceCode = kclManager.codeSignal.value
    const sourceAst = kclManager.astSignal.value
    const pending = {
      owner,
      title: `${command.displayName || command.name} - Code changes`,
    }
    const error = kclManager.hasEditsSinceLastExecutionSignal.value
      ? 'Execute the current code to preview changes.'
      : currentDraft.incomplete
        ? 'Complete the arguments to preview changes.'
        : undefined
    publish(
      error
        ? { ...pending, status: 'error', error }
        : { ...pending, status: 'loading' }
    )
    if (error) return

    let cancelled = false
    const isCurrent = () =>
      !cancelled &&
      preview.current.peek()?.owner === owner &&
      kclManager.path === sourcePath &&
      kclManager.code === sourceCode &&
      kclManager.astSignal.peek() === sourceAst

    const timeout = setTimeout(() => {
      void (async () => {
        const wasmInstance = await kclManager.wasmInstancePromise
        if (!isCurrent()) return
        const resolved = await resolveArguments(
          currentDraft.context,
          currentDraft.values,
          kclManager.rustContext,
          sourceAst,
          kclManager.artifactGraph
        )
        if (!isCurrent()) return
        const result = isErr(resolved)
          ? resolved
          : await runModelingCodemod({
              codemod,
              commandArgs: resolved,
              kclManager,
              wasmInstance,
              sourceSnapshot: { ast: sourceAst, code: sourceCode },
            })
        if (!isCurrent()) return
        const code = isErr(result)
          ? result
          : recast(result.modifiedAst, wasmInstance)
        publish(
          isErr(code)
            ? { ...pending, status: 'error', error: code.message }
            : {
                ...pending,
                status: 'ready',
                beforeText: sourceCode,
                afterText: code,
              }
        )
      })().catch((error: unknown) => {
        if (isCurrent()) {
          publish({
            ...pending,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to preview changes.',
          })
        }
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  })

  return {
    open,
    available,
    update(next: ModelingPreviewDraft) {
      draft.value = next
    },
    toggle() {
      if (open.peek()) {
        preview.clear(owner)
      } else if (available.peek()) {
        batch(() => {
          publisher = preview.open(kclManager, {
            owner,
            title: 'Code changes',
            status: 'loading',
          })
        })
      }
    },
    dispose() {
      active.value = false
      stop()
      subscription.unsubscribe()
      preview.clear(owner)
    },
  }
}
