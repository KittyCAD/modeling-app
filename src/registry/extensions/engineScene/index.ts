import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { ExperimentalFeaturesMenu } from '@src/components/ExperimentalFeaturesMenu'
import { SelectionReferencesPopover } from '@src/components/SelectionReferencesPopover'
import { SelectionStatusBarItem } from '@src/components/SelectionStatusBarItem'
import { UnitsMenu } from '@src/components/UnitsMenu'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { SelectionFilterControls } from '@src/registry/extensions/engineScene/SelectionFilterControls'
import { createElement } from 'react'
import executionIndicator from './executionIndicator'

const EngineSceneUnitsMenu = () => createElement(UnitsMenu)
const EngineSceneExperimentalFeaturesMenu = () =>
  createElement(ExperimentalFeaturesMenu)
const EngineSceneSelectionStatusBarItem = ({ label }: { label: string }) =>
  createElement(SelectionStatusBarItem, {
    label,
    popoverSections: [
      {
        id: 'selection-references',
        component: SelectionReferencesPopover,
      },
    ],
  })

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
            component: SelectionFilterControls,
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
