import { use } from 'react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useSingletons } from '@src/lib/boot'
import {
  type SelectionReference,
  getSelectionReferences,
  isEnginePrimitiveSelection,
  removeReferenceFromSelections,
} from '@src/lib/selections'
import { reportRejection } from '@src/lib/trap'

type SelectionReferenceState =
  | { status: 'idle' | 'loading'; references: SelectionReference[] }
  | { status: 'ready'; references: SelectionReference[] }
  | { status: 'error'; references: SelectionReference[]; message: string }

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.success('Copied KCL reference.')
  } catch {
    toast.error('Failed to copy KCL reference.')
  }
}

export function SelectionReferencesPopover() {
  const { kclManager } = useSingletons()
  const { context, send } = useModelingContext()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const selectionRanges = context.selectionRanges
  const [state, setState] = useState<SelectionReferenceState>({
    status: 'idle',
    references: [],
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', references: [] })

    getSelectionReferences({
      graphSelections: selectionRanges.graphSelections,
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
  }, [selectionRanges, kclManager, wasmInstance])

  if (state.status === 'loading') {
    return (
      <div className="p-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
        Resolving selection references...
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="p-2 text-xs text-destroy-80 dark:text-destroy-40">
        {state.message}
      </div>
    )
  }

  if (state.references.length === 0) {
    return (
      <div className="p-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
        No selection references for the current selection.
      </div>
    )
  }

  const removeReference = (reference: SelectionReference) => {
    send({
      type: 'Set selection',
      data: {
        selectionType: 'completeSelection',
        selection: removeReferenceFromSelections(selectionRanges, reference),
      },
    })
  }

  return (
    <div className="flex flex-col gap-1 p-1 divide-y divide-chalkboard-30 dark:divide-chalkboard-80">
      {state.references.map((reference) => (
        <div
          key={reference.id}
          className="grid grid-cols-[minmax(0,1fr),auto,auto] items-center gap-2 rounded-sm px-2 py-1 text-xs"
        >
          <span className="truncate text-chalkboard-80 dark:text-chalkboard-30">
            {reference.label}
          </span>
          <button
            type="button"
            className="relative rounded-sm p-0.5 text-2 border-none dark:border-none hover:bg-2 focus:bg-2"
            aria-label={`Copy ${reference.label} KCL reference`}
            onClick={() => {
              copyCode(reference.code).catch(reportRejection)
            }}
          >
            <CustomIcon name="clipboard" className="h-4 w-4" />
            <Tooltip
              position="left"
              contentClassName="max-w-72 text-xs text-left"
            >
              <div className="mb-1">Copy KCL reference</div>
              <code className="block whitespace-normal break-all font-mono">
                {reference.code}
              </code>
            </Tooltip>
          </button>
          <button
            type="button"
            className="relative p-0.5 rounded-sm text-2 hover:bg-destroy-80 focus:bg-destroy-80 !border-none"
            aria-label={`Remove ${reference.label} from selection`}
            onClick={() => removeReference(reference)}
          >
            <CustomIcon name="close" className="h-4 w-4" />
            <Tooltip
              position="left"
              contentClassName="max-w-64 text-xs text-left"
            >
              Remove this item from the selection.
            </Tooltip>
          </button>
        </div>
      ))}
    </div>
  )
}
