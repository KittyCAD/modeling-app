import { use, useEffect, useState } from 'react'
import type { KclManager } from '@src/lang/KclManager'
import {
  type SelectionReference,
  getSelectionReferences,
  isDefaultPlaneSelection,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

type SelectionReferenceState =
  | { status: 'idle' | 'loading'; references: SelectionReference[] }
  | { status: 'ready'; references: SelectionReference[] }
  | { status: 'error'; references: SelectionReference[]; message: string }

export function useSelectionReferences({
  kclManager,
  wasmPromise,
  selectionRanges,
}: {
  kclManager: KclManager
  wasmPromise: Promise<ModuleType>
  selectionRanges: Selections
}) {
  const wasmInstance = use(wasmPromise)
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
  }, [selectionRanges, kclManager, wasmInstance])

  return state
}
