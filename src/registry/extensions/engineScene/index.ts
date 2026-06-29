import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { Suspense, createElement, lazy } from 'react'
import executionIndicator from './executionIndicator'

// Registry extension entrypoints are imported eagerly while App is still
// initializing. These status bar components can reach boot.ts, so keep them
// behind lazy imports to avoid an App <-> boot cycle.
const SelectionFilterControls = lazy(async () => {
  const { SelectionFilterControls } = await import('./SelectionFilterControls')
  return { default: SelectionFilterControls }
})

const UnitsMenu = lazy(async () => {
  const { UnitsMenu } = await import('@src/components/UnitsMenu')
  return { default: UnitsMenu }
})

const ExperimentalFeaturesMenu = lazy(async () => {
  const { ExperimentalFeaturesMenu } = await import(
    '@src/components/ExperimentalFeaturesMenu'
  )
  return { default: ExperimentalFeaturesMenu }
})

const SelectionStatusBarItem = lazy(async () => {
  const { SelectionStatusBarItem } = await import(
    '@src/components/SelectionStatusBarItem'
  )
  return { default: SelectionStatusBarItem }
})

const SelectionReferencesPopover = lazy(async () => {
  const { SelectionReferencesPopover } = await import(
    '@src/components/SelectionReferencesPopover'
  )
  return { default: SelectionReferencesPopover }
})

const EngineSceneUnitsMenu = () =>
  createElement(Suspense, { fallback: null }, createElement(UnitsMenu))

const EngineSceneExperimentalFeaturesMenu = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(ExperimentalFeaturesMenu)
  )

const EngineSceneSelectionStatusBarItem = ({ label }: { label: string }) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(SelectionStatusBarItem, {
      label,
      popoverSections: [
        {
          id: 'selection-references',
          component: SelectionReferencesPopover,
        },
      ],
    })
  )

const EngineSceneSelectionFilterControls = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(SelectionFilterControls)
  )

/**
 * Engine scene extension.
 *
 * Future home for the whole engine scene layout and modeling state machine
 * behavior. For now it contributes always-on local status bar items owned by
 * the scene.
 */
const engineSceneExtension = defineRegistryItemFactory((ctx) => {
  const executionService = ctx.services.signal(executingEditorService)
  const selectionStatusBarItem = computed(() => {
    const selectionStatusLabel = executionService.value?.selectionStatusLabel
    return nullableStatusBarItem(
      selectionStatusLabel
        ? {
            id: 'selection',
            component: () =>
              createElement(EngineSceneSelectionStatusBarItem, {
                label: selectionStatusLabel.value,
              }),
            order: 10,
            scopes: ['file'],
          }
        : null
    )
  })
  const selectionFilterStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value
        ? {
            id: 'selection-filter',
            component: EngineSceneSelectionFilterControls,
            order: 11,
            scopes: ['file'],
          }
        : null
    )
  )
  const experimentalFeaturesStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value?.showExperimentalFeaturesStatusBarItem.value
        ? {
            id: 'experimental-features',
            component: EngineSceneExperimentalFeaturesMenu,
            order: 30,
            scopes: ['file'],
          }
        : null
    )
  )
  const unitsStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value
        ? {
            id: 'units',
            component: EngineSceneUnitsMenu,
            order: 20,
            scopes: ['file'],
          }
        : null
    )
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'engine-scene-extension',
      provides: [
        provide(statusBarLocalItemsValueSpec, selectionFilterStatusBarItem),
        provide(statusBarLocalItemsValueSpec, selectionStatusBarItem),
        provide(statusBarLocalItemsValueSpec, unitsStatusBarItem),
        provide(
          statusBarLocalItemsValueSpec,
          experimentalFeaturesStatusBarItem
        ),
      ],
      uses: [executionIndicator],
    }),
  }
}, 'engine-scene-extension')

export default engineSceneExtension
