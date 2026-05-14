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
import { scenePostprocessorsValueSpec } from './scenePostprocessors'
import {
  type EngineSceneViewExtension,
  type SceneControlsViewExtension,
  sceneControlsViewExtensionsValueSpec,
  viewExtensionsValueSpec,
} from './viewExtensions'
import { xRayOverrideTransparencyPostprocessor } from './xRayPostprocessor'

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

const LazyEngineSceneControls = lazy(async () => {
  const { EngineSceneControls } = await import('./SceneControls')
  return { default: EngineSceneControls }
})

const EngineSceneControlsView = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(LazyEngineSceneControls)
  )

const LazyXRaySceneControl = lazy(async () => {
  const { EngineSceneXRayControl } = await import('./xRay')
  return { default: EngineSceneXRayControl }
})

const XRaySceneControlView = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(LazyXRaySceneControl)
  )

const engineSceneControlsViewExtension: EngineSceneViewExtension = {
  id: 'engine-scene.scene-controls',
  order: 100,
  Component: EngineSceneControlsView,
}

const xRaySceneControlViewExtension: SceneControlsViewExtension = {
  id: 'engine-scene.x-ray.control',
  order: 100,
  Component: XRaySceneControlView,
}

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
            scopes: ['file'],
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
              scopes: ['file'],
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
          },
        }),
        provide(statusBarLocalItemsValueSpec, selectionStatusBarItem),
        provide(statusBarLocalItemsValueSpec, unitsStatusBarItem),
        provide(
          statusBarLocalItemsValueSpec,
          experimentalFeaturesStatusBarItem
        ),
        provide(statusBarLocalItemsValueSpec, executionStatusBarItem),
        provide(viewExtensionsValueSpec, engineSceneControlsViewExtension),
        provide(
          sceneControlsViewExtensionsValueSpec,
          xRaySceneControlViewExtension
        ),
        provide(
          scenePostprocessorsValueSpec,
          xRayOverrideTransparencyPostprocessor
        ),
      ],
    }),
  }
}, 'engine-scene-extension')

export default engineSceneExtension
