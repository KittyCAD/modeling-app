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
    <fieldset className="pointer-events-auto m-0 grid grid-cols-4 overflow-hidden rounded border border-chalkboard-20/60 bg-chalkboard-10/70 p-0 text-chalkboard-100 shadow-sm backdrop-blur-sm dark:border-chalkboard-80/60 dark:bg-chalkboard-100/70 dark:text-chalkboard-10">
      <legend className="sr-only">Selection filter</legend>
      {selectionFilterOptions.map((option) => {
        const isActive = selectionFilterMode === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            title={option.title}
            onClick={() => handleSelectionFilterChange(option.value)}
            className={`m-0 h-6 border-0 border-r border-solid border-chalkboard-20/50 px-1.5 text-[10px] leading-none last:border-r-0 dark:border-chalkboard-80/60 ${
              isActive
                ? 'bg-primary text-chalkboard-10'
                : 'bg-transparent text-chalkboard-90 hover:bg-chalkboard-20/70 dark:text-chalkboard-20 dark:hover:bg-chalkboard-80/70'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}
