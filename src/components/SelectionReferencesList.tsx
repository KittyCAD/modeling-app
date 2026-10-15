import { use } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import toast from 'react-hot-toast'

import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { ToolbarDropdownPanel } from '@src/components/ToolbarDropdownPanel'
import type { KclManager } from '@src/lang/KclManager'
import { entityReferenceKey } from '@src/lang/queryAst'
import {
  type SelectionReference,
  getSelectionReferences,
  getSelectionTypeDisplayText,
  isDefaultPlaneSelection,
  isEnginePrimitiveSelection,
  removeReferenceFromSelections,
} from '@src/lib/selections'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { reportRejection } from '@src/lib/trap'
import { capitaliseFC } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type SelectionReferenceState =
  | { status: 'idle' | 'loading'; references: SelectionReference[] }
  | { status: 'ready'; references: SelectionReference[] }
  | { status: 'error'; references: SelectionReference[]; message: string }

type SelectionRow = {
  key: string
  group: keyof Selections
  index: number
  selection: Selections
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.success('Copied KCL reference.')
  } catch {
    toast.error('Failed to copy KCL reference.')
  }
}

export function SelectionReferencesList({
  kclManager,
  wasmPromise,
  selectionRanges,
  onChange,
  onReorder,
  variant = 'statusBar',
}: {
  kclManager: KclManager
  wasmPromise: Promise<ModuleType>
  selectionRanges: Selections
  onChange?: (selection: Selections) => void
  onReorder?: (selection: Selections) => void
  variant?: 'statusBar' | 'dialog'
}) {
  useSignals()
  const wasmInstance = use(wasmPromise)
  const sceneGeneration = kclManager.engineSceneGenerationSignal.value
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const [dragged, setDragged] = useState<string>()
  const [dropTarget, setDropTarget] = useState<string>()
  const [state, setState] = useState<SelectionReferenceState>({
    status: 'idle',
    references: [],
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', references: [] })

    getSelectionReferences({
      graphSelections: selectionRanges.graphSelections,
      defaultPlaneSelections: selectionRanges.otherSelections.filter(
        isDefaultPlaneSelection
      ),
      enginePrimitives: selectionRanges.otherSelections.filter(
        isEnginePrimitiveSelection
      ),
      artifactGraph: kclManager.artifactGraph,
      engineCommandManager: kclManager.engineCommandManager,
      kclManager,
      wasmInstance,
    })
      .then((references) => {
        if (cancelled) {
          return
        }
        setState({ status: 'ready', references })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setState({
          status: 'error',
          references: [],
          message:
            error instanceof Error
              ? error.message
              : 'Unable to resolve selection references.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [selectionRanges, kclManager, wasmInstance, sceneGeneration])

  // Match codemod order: graph selections first, then engine-only selections.
  const rows: SelectionRow[] = [
    ...selectionRanges.graphSelections.map((selection, index): SelectionRow => {
      const key =
        (selection.entityRef && entityReferenceKey(selection.entityRef)) ??
        selection.artifact?.id ??
        selection.engineEntityId ??
        JSON.stringify(selection.codeRef?.range) ??
        index
      return {
        key: `graph:${key}:${selection.patternIndex ?? ''}`,
        group: 'graphSelections',
        index,
        selection: { graphSelections: [selection], otherSelections: [] },
      }
    }),
    ...selectionRanges.otherSelections.map((selection, index): SelectionRow => {
      const key =
        typeof selection === 'string'
          ? selection
          : isEnginePrimitiveSelection(selection)
            ? selection.entityId
            : selection.id
      return {
        key: `other:${key}`,
        group: 'otherSelections',
        index,
        selection: { graphSelections: [], otherSelections: [selection] },
      }
    }),
  ]

  function move(row: SelectionRow, to: number) {
    if (
      !onReorder ||
      to < 0 ||
      to >= selectionRanges[row.group].length ||
      to === row.index
    )
      return
    onReorder(
      row.group === 'graphSelections'
        ? {
            ...selectionRanges,
            graphSelections: moveItem(
              selectionRanges.graphSelections,
              row.index,
              to
            ),
          }
        : {
            ...selectionRanges,
            otherSelections: moveItem(
              selectionRanges.otherSelections,
              row.index,
              to
            ),
          }
    )
    requestAnimationFrame(() => handles.current.get(row.key)?.focus())
  }

  return (
    <div className="flex flex-col gap-1 p-1 divide-y divide-chalkboard-30 dark:divide-chalkboard-80">
      {state.status === 'loading' && (
        <div className="p-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
          Resolving selection references...
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="p-2 text-xs text-destroy-80 dark:text-destroy-40"
        >
          {state.message}
        </div>
      )}
      {state.status === 'ready' && rows.length === 0 && (
        <div className="p-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
          No selection references for the current selection.
        </div>
      )}
      {rows.map((row) => {
        const reference = state.references.find(
          (reference) =>
            removeReferenceFromSelections(row.selection, reference)[row.group]
              .length === 0
        )
        const primitive = row.selection.otherSelections.find(
          isEnginePrimitiveSelection
        )
        const label =
          reference?.label ??
          (primitive && variant === 'statusBar'
            ? `Unresolved ${primitive.primitiveType}`
            : capitaliseFC(
                getSelectionTypeDisplayText(
                  kclManager.ast,
                  row.selection,
                  kclManager.artifactGraph
                )?.replace(/^1 /, '') ?? 'Selection'
              ))
        const code = reference?.code
        const reorderable =
          variant === 'dialog' &&
          onReorder &&
          selectionRanges[row.group].length > 1
        const source = rows.find((item) => item.key === dragged)
        return (
          <div
            key={row.key}
            className={`flex items-center gap-2 rounded-sm px-2 py-1 text-xs ${dropTarget === row.key ? 'ring-1 ring-primary' : ''}`}
            onDragOver={(event) => {
              if (
                !reorderable ||
                source?.group !== row.group ||
                source.key === row.key
              )
                return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropTarget(row.key)
            }}
            onDragLeave={() => setDropTarget(undefined)}
            onDrop={(event) => {
              if (!reorderable || source?.group !== row.group) return
              event.preventDefault()
              move(source, row.index)
              setDragged(undefined)
              setDropTarget(undefined)
            }}
          >
            {reorderable && (
              <button
                type="button"
                draggable
                ref={(button) => {
                  if (button) handles.current.set(row.key, button)
                  else handles.current.delete(row.key)
                }}
                aria-label={`Reorder ${label} ${row.index + 1}`}
                aria-keyshortcuts="ArrowUp ArrowDown"
                className="relative cursor-grab rounded-sm p-0.5 text-2 !border-none active:cursor-grabbing"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', row.key)
                  setDragged(row.key)
                }}
                onDragEnd={() => {
                  setDragged(undefined)
                  setDropTarget(undefined)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
                    return
                  event.preventDefault()
                  event.stopPropagation()
                  move(row, row.index + (event.key === 'ArrowUp' ? -1 : 1))
                }}
              >
                <CustomIcon name="sixDots" className="h-4 w-4" />
                <Tooltip position="left">
                  Drag or use Up/Down to reorder.
                </Tooltip>
              </button>
            )}
            <span
              className={`min-w-0 flex-1 truncate ${primitive && !reference && variant === 'statusBar' ? 'text-destroy-80 dark:text-destroy-40' : 'text-chalkboard-80 dark:text-chalkboard-30'}`}
            >
              {label}
            </span>
            {variant === 'dialog' ? (
              <SelectionReferenceDetails label={label} code={code} />
            ) : (
              code && (
                <button
                  type="button"
                  className="relative rounded-sm p-0.5 text-2 border-none dark:border-none hover:bg-2 focus:bg-2"
                  aria-label={`Copy ${label} KCL reference`}
                  onClick={() => {
                    copyCode(code).catch(reportRejection)
                  }}
                >
                  <CustomIcon name="clipboard" className="h-4 w-4" />
                  <Tooltip
                    position="left"
                    contentClassName="max-w-72 text-xs text-left"
                  >
                    <div className="mb-1">Copy KCL reference</div>
                    <code className="block whitespace-normal break-all font-mono">
                      {code}
                    </code>
                  </Tooltip>
                </button>
              )
            )}
            {onChange && (
              <button
                type="button"
                className="relative p-0.5 rounded-sm text-2 hover:bg-destroy-80 focus:bg-destroy-80 !border-none"
                aria-label={`Remove ${reference || variant === 'dialog' ? label : label.toLowerCase()} from selection`}
                onClick={() =>
                  onChange?.(
                    reference
                      ? removeReferenceFromSelections(
                          selectionRanges,
                          reference
                        )
                      : {
                          ...selectionRanges,
                          [row.group]: selectionRanges[row.group].filter(
                            (_, index) => index !== row.index
                          ),
                        }
                  )
                }
              >
                <CustomIcon name="close" className="h-4 w-4" />
                <Tooltip
                  position="left"
                  contentClassName="max-w-64 text-xs text-left"
                >
                  Remove this item from the selection.
                </Tooltip>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SelectionReferenceDetails({
  label,
  code,
}: {
  label: string
  code?: string
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  return (
    <Popover className="relative flex">
      {({ open }) => (
        <>
          <Popover.Button
            ref={buttonRef}
            aria-label={`${label} selection details`}
            className="relative rounded-sm p-0.5 text-2 !border-none hover:bg-2 focus:bg-2"
          >
            <CustomIcon name="questionMark" className="h-4 w-4" />
          </Popover.Button>
          <ToolbarDropdownPanel buttonRef={buttonRef} open={open}>
            <li className="flex w-56 items-center gap-2 px-3 text-xs">
              {code ? (
                <>
                  <code className="min-w-0 flex-1 break-all" title={code}>
                    {code}
                  </code>
                  <button
                    type="button"
                    aria-label={`Copy ${label} KCL reference`}
                    className="shrink-0 rounded-sm p-0.5 text-2 !border-none hover:bg-2 focus:bg-2"
                    onClick={() => {
                      copyCode(code).catch(reportRejection)
                    }}
                  >
                    <CustomIcon name="clipboard" className="h-4 w-4" />
                  </button>
                </>
              ) : (
                'KCL reference unavailable.'
              )}
            </li>
          </ToolbarDropdownPanel>
        </>
      )}
    </Popover>
  )
}
