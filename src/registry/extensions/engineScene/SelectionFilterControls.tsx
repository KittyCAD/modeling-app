import { Popover } from '@headlessui/react'
import type { EntityType } from '@kittycad/lib'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { defaultSelectionFilter } from '@src/lib/selectionFilterUtils'
import { reportRejection } from '@src/lib/trap'
import { useCallback } from 'react'

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

function getOptionFilter(option: { filter?: EntityType[] }): EntityType[] {
  return option.filter ?? defaultSelectionFilter
}

function filtersMatch(left: EntityType[], right: EntityType[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  const leftValues = new Set(left)
  return right.every((value) => leftValues.has(value))
}

function getActiveSelectionFilterOption(filter: EntityType[]) {
  return selectionFilterOptions.find((option) =>
    filtersMatch(filter, getOptionFilter(option))
  )
}

export function SelectionFilterControls() {
  useSignals()
  const { state } = useModelingContext()
  const { kclManager, wasmInstance } = state.context
  const activeOption = getActiveSelectionFilterOption(
    kclManager.selectionFilter.value
  )
  const activeLabel = activeOption?.label ?? 'Custom'

  const handleSelectionFilterChange = useCallback(
    (mode: SelectionFilterMode) => {
      const option = selectionFilterOptions.find(({ value }) => value === mode)
      if (!option) {
        return
      }

      if (option.filter) {
        kclManager.setSelectionFilter(option.filter, wasmInstance)
      } else {
        kclManager.setSelectionFilterToDefault(wasmInstance)
      }
      kclManager.clearSelection().catch(reportRejection)
    },
    [kclManager, wasmInstance]
  )

  return (
    <Popover className="relative">
      {(popover) => (
        <>
          <Popover.Button
            className={`${defaultStatusBarItemClassNames} gap-2`}
            data-testid="selection-filter-status"
            title="Selection filter"
          >
            <Tooltip hoverOnly={true} position="top">
              Selection filter
            </Tooltip>
            <span>{activeLabel}</span>
            <CustomIcon
              name="caretDown"
              className="h-3 w-3 ui-open:rotate-180"
            />
          </Popover.Button>
          <Popover.Panel className="absolute bottom-full right-0 z-50 mb-1 min-w-28 rounded border b-3 bg-default p-1 shadow-lg">
            <div className="flex flex-col">
              {selectionFilterOptions.map((option) => {
                const isActive = option.value === activeOption?.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    title={option.title}
                    onClick={() => {
                      handleSelectionFilterChange(option.value)
                      popover.close()
                    }}
                    className={`m-0 rounded border-none px-2 py-1 text-left text-xs ${
                      isActive
                        ? '!bg-primary text-6'
                        : 'bg-transparent text-2 hover:bg-2'
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}
