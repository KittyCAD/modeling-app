import { useEffect, useRef } from 'react'
import { resolveArguments } from '@src/components/ModelingDialog/arguments'
import type { KclManager } from '@src/lang/KclManager'
import {
  runModelingCodemod,
  type ModelingCodemod,
} from '@src/lang/modifyAst/modelingCodemod'
import { recast } from '@src/lang/wasm'
import type { AppLayoutSystem } from '@src/lib/app'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import type {
  CodeChangesPreviewController,
  CodeChangesPreviewPublisher,
} from '@src/lib/codeChangesPreview'
import {
  DefaultLayoutPaneID,
  getOpenPanes,
  togglePaneLayoutNode,
} from '@src/lib/layout'
import { isErr } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

export function useCodePreview({
  context,
  values,
  incomplete,
  kclManager,
  layout,
  preview,
}: {
  context: CommandBarContext
  values: Record<string, unknown>
  incomplete: boolean
  kclManager: KclManager
  layout: AppLayoutSystem
  preview: CodeChangesPreviewController | undefined
}) {
  const owner = useRef({}).current
  const publisher = useRef<CodeChangesPreviewPublisher | undefined>(undefined)
  const sourcePath = kclManager.path
  const initialPath = useRef(sourcePath).current
  const sourceCode = kclManager.codeSignal.value
  const sourceAst = kclManager.astSignal.value
  const sourceNeedsExecution = kclManager.hasEditsSinceLastExecutionSignal.value
  const command = context.selectedCommand
  // Arguments are resolved below against the selected command's schema.
  const codemod =
    command && Object.hasOwn(modelingCommandCodemods, command.name)
      ? (modelingCommandCodemods[
          command.name as keyof typeof modelingCommandCodemods
        ] as ModelingCodemod<Record<string, unknown>>)
      : undefined
  const open = preview?.current.value?.owner === owner

  useEffect(() => () => preview?.clear(owner), [preview, owner])

  useEffect(() => {
    const publish = publisher.current
    if (!open || !command || !codemod || !preview || !publish) return
    if (sourcePath !== initialPath) {
      preview.clear(owner)
      return
    }
    const pending = {
      owner,
      title: `${command.displayName || command.name} - Code changes`,
    }
    const error = sourceNeedsExecution
      ? 'Execute the current code to preview changes.'
      : incomplete
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
      kclManager.code === sourceCode

    // Coalesce typing; discard results when arguments, source, or owner change.
    const timeout = setTimeout(() => {
      void (async () => {
        const wasmInstance = await kclManager.wasmInstancePromise
        if (!isCurrent()) return
        const resolved = await resolveArguments(
          context,
          values,
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
  }, [
    open,
    command,
    codemod,
    context,
    values,
    incomplete,
    sourcePath,
    initialPath,
    sourceCode,
    sourceAst,
    sourceNeedsExecution,
    kclManager,
    preview,
    owner,
  ])

  function toggle() {
    if (!preview) return
    if (open) {
      preview.clear(owner)
      return
    }
    publisher.current = preview.open(kclManager, {
      owner,
      title: 'Code changes',
      status: 'loading',
    })
    if (!publisher.current) return
    const rootLayout = layout.get()
    if (!getOpenPanes({ rootLayout }).includes(DefaultLayoutPaneID.Code)) {
      layout.set(
        togglePaneLayoutNode({
          rootLayout: structuredClone(rootLayout),
          targetNodeId: DefaultLayoutPaneID.Code,
          shouldExpand: true,
        })
      )
    }
  }

  return { open, toggle, available: Boolean(preview && codemod) }
}
