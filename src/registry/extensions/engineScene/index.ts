import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { Suspense, createElement, lazy } from 'react'
import { EngineExecutionStatusTooltip } from './EngineExecutionStatusTooltip'
import { ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID } from './constants'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'

const EngineSceneModelingArea = lazy(async () => {
  const { ModelingArea } = await import('./ModelingArea')
  return { default: ModelingArea }
})

const EngineSceneModelingAreaComponent = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(EngineSceneModelingArea)
  )

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

const EngineSceneUnitsMenu = () =>
  createElement(Suspense, { fallback: null }, createElement(UnitsMenu))

const EngineSceneExperimentalFeaturesMenu = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(ExperimentalFeaturesMenu)
  )

/**
 * Engine scene extension.
 *
 * Future home for the whole engine scene layout and modeling state machine
 * behavior. For now it contributes the execution spinner status item and the
 * setting that controls whether users see it.
 */
const engineSceneExtension = defineRegistryItemFactory((ctx) => {
  const executionService = ctx.services.signal(executingEditorService)
  const selectionStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value
        ? {
            id: 'selection',
            'data-testid': 'selection-status',
            element: 'text' as const,
            label: executionService.value.selectionStatusLabel.value,
            order: 10,
            toolTip: {
              children: 'Currently selected geometry',
            },
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
          }
        : null
    )
  )
  const executionStatusBarItem = computed(() =>
    nullableStatusBarItem(
      (() => {
        const service = executionService.value

        return service?.isExecuting.value
          ? {
              id: ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID,
              'data-testid': 'engine-executing-status',
              element: 'text' as const,
              icon: 'loading' as const,
              label: 'Engine executing',
              hideLabel: true,
              order: 0,
              toolTip: {
                children: createElement(EngineExecutionStatusTooltip, {
                  executionElapsedMs: service.executionElapsedMs,
                  getPendingCommandCount: () =>
                    executionService.value?.getPendingCommandCount() ?? 0,
                }),
              },
            }
          : null
      })()
    )
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'engine-scene-extension',
      provides: [
        provide(settingsValueSpec, {
          modeling: {
            showExecutingSpinner: defineBooleanExtensionSetting({
              defaultValue: false,
              title: 'Show executing spinner',
              description:
                'Whether to show a status bar spinner while the engine is processing commands.',
              commandConfig: {
                inputType: 'boolean',
              },
              userToml: {
                sectionKey: 'modeling',
                tomlKey: 'show_executing_spinner',
              },
              projectToml: {
                sectionKey: 'modeling',
                tomlKey: 'show_executing_spinner',
              },
            }),
            openCascadeAnimateToSketchPlane: defineBooleanExtensionSetting({
              defaultValue: true,
              title: 'OpenCascade animate to sketch plane',
              description:
                'Whether OpenCascade rotates the camera normal to the selected sketch plane when entering sketch mode.',
              isEnabled: (settings) =>
                settings.modeling.engine.current === 'open_cascade',
              commandConfig: {
                inputType: 'boolean',
              },
              userToml: {
                sectionKey: 'modeling',
                tomlKey: 'open_cascade_animate_to_sketch_plane',
              },
              projectToml: {
                sectionKey: 'modeling',
                tomlKey: 'open_cascade_animate_to_sketch_plane',
              },
            }),
          },
        }),
        provide(layoutAreaLibraryValueSpec, {
          modeling: {
            hide: () => false,
            Component: EngineSceneModelingAreaComponent,
          },
        }),
        provide(statusBarLocalItemsValueSpec, selectionStatusBarItem),
        provide(statusBarLocalItemsValueSpec, unitsStatusBarItem),
        provide(
          statusBarLocalItemsValueSpec,
          experimentalFeaturesStatusBarItem
        ),
        provide(statusBarLocalItemsValueSpec, executionStatusBarItem),
      ],
    }),
  }
}, 'engine-scene-extension')

export default engineSceneExtension
