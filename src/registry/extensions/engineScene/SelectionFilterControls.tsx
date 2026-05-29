import type { EntityType } from '@kittycad/lib'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useCallback, useState } from 'react'

type SelectionFilterMode = 'default' | 'faces' | 'edges' | 'bodies'

const selectionFilterOptions: Array<{
  value: SelectionFilterMode
  label: string
  title: string
  filter?: EntityType[]
}> = [
  {
    value: 'default',
    label: 'All',
    title: 'Default selection filter',
  },
  {
    value: 'faces',
    label: 'Faces',
    title: 'Select faces',
    filter: ['face', 'object'],
  },
  {
    value: 'edges',
    label: 'Edges',
    title: 'Select edges',
    filter: ['edge', 'curve', 'segment'],
  },
  {
    value: 'bodies',
    label: 'Bodies',
    title: 'Select solid bodies',
    filter: ['solid3d'],
  },
]

export function SelectionFilterControls() {
  const { state } = useModelingContext()
  const { kclManager, wasmInstance } = state.context
  const [selectionFilterMode, setSelectionFilterMode] =
    useState<SelectionFilterMode>('default')

  const handleSelectionFilterChange = useCallback(
    (mode: SelectionFilterMode) => {
      const option = selectionFilterOptions.find(({ value }) => value === mode)
      if (!option) {
        return
      }

      setSelectionFilterMode(mode)
      if (option.filter) {
        kclManager.setSelectionFilter(option.filter, wasmInstance)
      } else {
        kclManager.setSelectionFilterToDefault(wasmInstance)
      }
    },
    [kclManager, wasmInstance]
  )

  if (!state.matches('idle')) {
    return null
  }

  return (
    <fieldset className="pointer-events-auto m-0 rounded-lg border b-4 p-0 text-1 flex">
      <legend className="text-xs px-1 text-3">Selection filter</legend>
      {selectionFilterOptions.map((option) => {
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selectionFilterMode === option.value}
            title={option.title}
            onClick={() => handleSelectionFilterChange(option.value)}
            className="aria-pressed:bg-3 bg-transparent border-none text-xs py-0.5 px-2 rounded-none first-of-type:rounded-l last-of-type:rounded-r hover:bg-2 focus:bg-2"
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}
