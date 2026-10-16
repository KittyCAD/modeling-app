import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useSelectionReferences } from '@src/hooks/useSelectionReferences'
import type { KclManager } from '@src/lang/KclManager'
import { entityReferenceKey } from '@src/lang/queryAst'
import {
  getSelectionTypeDisplayText,
  isEnginePrimitiveSelection,
  selectionMatchesReference,
} from '@src/lib/selections'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { capitaliseFC } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type SelectionRow = {
  key: string
  group: keyof Selections
  index: number
  selection: Selections
}

export function DialogSelectionList({
  kclManager,
  wasmPromise,
  selectionRanges,
  onChange,
}: {
  kclManager: KclManager
  wasmPromise: Promise<ModuleType>
  selectionRanges: Selections
  onChange?: (selection: Selections) => void
}) {
  const state = useSelectionReferences({
    kclManager,
    wasmPromise,
    selectionRanges,
  })

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

  return (
    <div className="flex flex-col px-1 divide-y divide-chalkboard-30 dark:divide-chalkboard-80">
      {state.status === 'error' && (
        <div
          role="alert"
          className="p-2 text-xs text-destroy-80 dark:text-destroy-40"
        >
          {state.message}
        </div>
      )}
      {rows.map((row) => {
        const selectedItem = row.selection[row.group][0]
        const reference = state.references.find((reference) =>
          selectionMatchesReference(selectedItem, reference)
        )
        const label =
          reference?.label ??
          capitaliseFC(
            getSelectionTypeDisplayText(
              kclManager.ast,
              row.selection,
              kclManager.artifactGraph
            )?.replace(/^1 /, '') ?? 'Selection'
          )
        return (
          <div
            key={row.key}
            className={`flex items-center gap-2 rounded-sm px-2 text-xs ${onChange ? 'py-0' : 'py-1'}`}
          >
            <div className="min-w-0 flex-1 truncate text-chalkboard-80 dark:text-chalkboard-30">
              <span>{label}</span>
              <Tooltip
                position="left"
                contentClassName="max-w-72 text-xs text-left"
              >
                <code className="block whitespace-normal break-all font-mono">
                  {reference?.code ?? 'KCL reference unavailable.'}
                </code>
              </Tooltip>
            </div>
            {onChange && (
              <button
                type="button"
                className="relative p-0.5 rounded-sm text-2 hover:bg-destroy-80 hover:!text-white focus:bg-destroy-80 focus:!text-white !border-none"
                aria-label={`Remove ${label} from selection`}
                onClick={() =>
                  onChange({
                    ...selectionRanges,
                    [row.group]: selectionRanges[row.group].filter(
                      (_, index) => index !== row.index
                    ),
                  })
                }
              >
                <CustomIcon name="trash" className="h-4 w-4" />
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
