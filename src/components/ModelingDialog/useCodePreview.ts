import { useEffect, useRef } from 'react'
import {
  hasValue,
  resolveArguments,
} from '@src/components/ModelingDialog/arguments'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  clearCodeChangesPreview,
  codeChangesPreviewSignal,
} from '@src/lib/codeChangesPreview'
import {
  DefaultLayoutPaneID,
  getOpenPanes,
  togglePaneLayoutNode,
} from '@src/lib/layout'
import { isErr } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'

export function useCodePreview(
  context: CommandBarContext,
  values: Record<string, unknown>,
  activeName: string | undefined,
  selectionRanges: Selections,
  incomplete: boolean
) {
  const { layout } = useApp()
  const { kclManager } = useSingletons()
  const owner = useRef({}).current
  const sourcePath = kclManager.path
  const initialPath = useRef(sourcePath).current
  const sourceCode = kclManager.codeSignal.value
  const sourceAst = kclManager.astSignal.value
  const sourceNeedsExecution = kclManager.hasEditsSinceLastExecutionSignal.value
  const command = context.selectedCommand
  const open = codeChangesPreviewSignal.value?.owner === owner

  useEffect(() => () => clearCodeChangesPreview(owner), [owner])

  useEffect(() => {
    if (!open || !command?.codePreview) return
    if (sourcePath !== initialPath) {
      clearCodeChangesPreview(owner)
      return
    }
    const pending = {
      owner,
      title: `${command.displayName || command.name} - Code changes`,
      files: [],
    }
    codeChangesPreviewSignal.value = {
      ...pending,
      status: incomplete || sourceNeedsExecution ? 'error' : 'loading',
      error: sourceNeedsExecution
        ? 'Execute the current code to preview changes.'
        : incomplete
          ? 'Complete the arguments to preview changes.'
          : undefined,
    }
    if (incomplete || sourceNeedsExecution) return

    let cancelled = false
    const isCurrent = () =>
      !cancelled &&
      codeChangesPreviewSignal.peek()?.owner === owner &&
      kclManager.path === sourcePath &&
      kclManager.code === sourceCode

    // Coalesce typing; discard results when arguments, source, or owner change.
    const timeout = setTimeout(() => {
      void (async () => {
        const draft = activeName
          ? {
              ...values,
              [activeName]: hasValue(selectionRanges)
                ? selectionRanges
                : undefined,
            }
          : values
        const resolved = await resolveArguments(
          context,
          draft,
          kclManager.rustContext,
          sourceAst,
          kclManager.artifactGraph
        )
        if (!isCurrent()) return
        const result = isErr(resolved)
          ? resolved
          : await command.codePreview?.(
              { ...context, argumentsToSubmit: resolved },
              command.machineActor
            )
        if (!isCurrent() || !result) return
        codeChangesPreviewSignal.value = isErr(result)
          ? { ...pending, status: 'error', error: result.message }
          : {
              ...pending,
              status: 'ready',
              files: [
                {
                  path: sourcePath,
                  beforeText: result.currentCode,
                  afterText: result.proposedCode,
                  language: 'kcl',
                },
              ],
            }
      })().catch((error: unknown) => {
        if (isCurrent()) {
          codeChangesPreviewSignal.value = {
            ...pending,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to preview changes.',
          }
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
    context,
    values,
    activeName,
    selectionRanges,
    incomplete,
    sourcePath,
    initialPath,
    sourceCode,
    sourceAst,
    sourceNeedsExecution,
    kclManager,
    owner,
  ])

  function toggle() {
    if (open) {
      clearCodeChangesPreview(owner)
      return
    }
    codeChangesPreviewSignal.value = {
      owner,
      title: 'Code changes',
      status: 'loading',
      files: [],
    }
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

  return { open, toggle, available: Boolean(command?.codePreview) }
}
