import { DialogSelectionListView } from '@src/components/ModelingDialog/DialogSelectionListView'
import {
  useSelectionReferences,
  type SelectionReferenceHost,
} from '@src/hooks/useSelectionReferences'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function DialogSelectionList({
  kclManager,
  wasmPromise,
  selectionRanges,
  onChange,
}: {
  kclManager: SelectionReferenceHost | undefined
  wasmPromise: Promise<ModuleType>
  selectionRanges: Selections
  onChange?: (selection: Selections) => void
}) {
  const state = useSelectionReferences({
    kclManager,
    wasmPromise,
    selectionRanges,
  })
  return (
    <DialogSelectionListView
      state={state}
      selectionRanges={selectionRanges}
      onChange={onChange}
    />
  )
}
