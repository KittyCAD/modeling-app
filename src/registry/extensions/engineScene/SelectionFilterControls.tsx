import { useSignals } from '@preact/signals-react/runtime'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { reportRejection } from '@src/lib/trap'
import { defaultSelectionFilter } from '@src/lib/selectionFilterUtils'
import {
  filtersMatch,
  SelectionFilterControlsView,
} from './SelectionFilterControlsView'
export function SelectionFilterControls() {
  useSignals()
  const { state } = useModelingContext()
  const { kclManager, wasmInstance } = state.context
  return (
    <SelectionFilterControlsView
      filter={kclManager.selectionFilter.value}
      onChange={(filter) => {
        if (filtersMatch(filter, defaultSelectionFilter))
          kclManager.setSelectionFilterToDefault(wasmInstance)
        else kclManager.setSelectionFilter(filter, wasmInstance)
        kclManager.clearSelection().catch(reportRejection)
      }}
    />
  )
}
