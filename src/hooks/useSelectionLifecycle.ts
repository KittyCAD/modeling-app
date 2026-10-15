import { useEffect, useRef } from 'react'
import type { KclManager } from '@src/lang/KclManager'
import type { CommandArgument } from '@src/lib/commandTypes'
import { reportRejection } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

/** Set up scene picking for a selection field and restore it on exit. */
export function useSelectionLifecycle({
  arg,
  kclManager,
  wasmPromise,
  selection,
  showPlanes = true,
}: {
  arg?: CommandArgument<unknown>
  kclManager: KclManager
  wasmPromise: Promise<ModuleType>
  selection?: Selections
  showPlanes?: boolean
}) {
  const latest = useRef({ selection, showPlanes })
  latest.current = { selection, showPlanes }

  useEffect(() => {
    if (!arg || arg.inputType !== 'selection') return
    if (arg.selectionTypes.includes('plane') && latest.current.showPlanes)
      void kclManager.showPlanes().catch(reportRejection)

    let cancelled = false
    void wasmPromise
      .then((wasm) => {
        if (!cancelled && arg.selectionFilter)
          kclManager.setSelectionFilter(
            arg.selectionFilter,
            wasm,
            latest.current.selection
          )
      })
      .catch(reportRejection)

    return () => {
      cancelled = true
      if (!kclManager._isAstEmpty(kclManager.ast))
        void kclManager.hidePlanes().catch(reportRejection)
      void wasmPromise
        .then((wasm) =>
          kclManager.setSelectionFilterToDefault(wasm, latest.current.selection)
        )
        .catch(reportRejection)
    }
  }, [arg, kclManager, wasmPromise])
}
