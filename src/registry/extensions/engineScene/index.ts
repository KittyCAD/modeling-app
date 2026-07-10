import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { provideCommand } from '@src/registry/contracts/commands'
import {
  type EngineSceneExtensionContext,
  defineEngineSceneStreamClassName,
  defineEngineSceneViewExtension,
  engineSceneStreamClassNamesValueSpec,
  engineSceneViewExtensionsValueSpec,
} from '@src/registry/contracts/engineScene'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  type KeymapItem,
  MODE_MODELING_KEYMAP_SCOPE,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { defineLazyRegistryComponent } from '@src/registry/lazyComponent'
import executionIndicator from './executionIndicator'
import { measurementToolService } from './measurementToolService'
import {
  SketchBackgroundOpacityViewExtension,
  SketchConstraintsToggleViewExtension,
} from './viewExtensionControls'

const ENGINE_SCENE_COMMAND_GROUP_ID = 'engineScene'
const ENGINE_SCENE_KEYMAP_SOURCE = 'Engine scene'

export const ENGINE_SCENE_COMMAND_IDS = Object.freeze({
  openMeasureTool: 'zds.engineScene.openMeasureTool',
} as const)

const openMeasureToolCommand: Command = {
  id: ENGINE_SCENE_COMMAND_IDS.openMeasureTool,
  name: ENGINE_SCENE_COMMAND_IDS.openMeasureTool,
  groupId: ENGINE_SCENE_COMMAND_GROUP_ID,
  displayName: 'Open measure tool',
  description: 'Open the measurement panel for the current modeling selection.',
  icon: 'ruler',
  needsReview: false,
  onSubmit: () => {
    measurementToolService.open()
    return true
  },
}

const openMeasureToolKeymapItem: KeymapItem = {
  id: 'engine-scene.measure.open',
  title: 'Open measure tool',
  source: ENGINE_SCENE_KEYMAP_SOURCE,
  scopes: [MODE_MODELING_KEYMAP_SCOPE],
  keystrokes: ['shift+m'],
  command: ENGINE_SCENE_COMMAND_IDS.openMeasureTool,
}

const loadSelectionFilterControls = async () =>
  (await import('./SelectionFilterControls')).SelectionFilterControls

const loadUnitsMenu = async () =>
  (await import('@src/components/UnitsMenu')).UnitsMenu

const loadExperimentalFeaturesMenu = async () =>
  (await import('@src/components/ExperimentalFeaturesMenu'))
    .ExperimentalFeaturesMenu

const loadSelectionStatusBarItem = async () =>
  (await import('@src/components/SelectionStatusBarItem'))
    .SelectionStatusBarItem

const loadSelectionReferencesPopover = async () =>
  (await import('@src/components/SelectionReferencesPopover'))
    .SelectionReferencesPopover

const loadMeasurementStatusBarItem = async () =>
  (await import('./MeasurementTool')).MeasurementStatusBarItem

const loadToolbarViewExtension = async () =>
  (await import('./ToolbarViewExtension')).EngineSceneToolbarViewExtension

const loadGizmoViewExtension = async () =>
  (await import('./GizmoViewExtension')).EngineSceneGizmoViewExtension

const isSketchSolveMode = (context: EngineSceneExtensionContext) =>
  context.modelingState.matches('sketchSolveMode')

const defaultStreamClassName = defineEngineSceneStreamClassName({
  id: 'engine-scene.stream-default',
  order: 0,
  className: 'absolute inset-x-[-4px] inset-y-[-4px] z-0',
})

const toolbarViewExtension = defineEngineSceneViewExtension({
  id: 'engine-scene.toolbar',
  zone: 'top',
  order: 0,
  loadComponent: loadToolbarViewExtension,
  wrapperClassName: 'w-full min-w-0 flex justify-center',
})

const sketchBackgroundOpacityViewExtension = defineEngineSceneViewExtension({
  id: 'engine-scene.sketch-background-opacity',
  zone: 'bottom-left',
  order: 0,
  Component: SketchBackgroundOpacityViewExtension,
  shouldRegister: isSketchSolveMode,
})

const sketchConstraintsToggleViewExtension = defineEngineSceneViewExtension({
  id: 'engine-scene.sketch-constraints-toggle',
  zone: 'bottom-left',
  order: 10,
  Component: SketchConstraintsToggleViewExtension,
  shouldRegister: isSketchSolveMode,
})

const gizmoViewExtension = defineEngineSceneViewExtension({
  id: 'engine-scene.gizmo',
  zone: 'bottom-right',
  order: 0,
  loadComponent: loadGizmoViewExtension,
})

/**
 * Engine scene extension.
 *
 * Future home for the whole engine scene layout and modeling state machine
 * behavior. For now it contributes always-on local status bar items owned by
 * the scene and the default view chrome rendered around the engine stream.
 */
const engineSceneExtension = defineRegistryItemFactory((ctx) => {
  const executionService = ctx.services.signal(executingEditorService)
  const selectionStatusBarItem = computed(() => {
    const selectionStatusLabel = executionService.value?.selectionStatusLabel
    return nullableStatusBarItem(
      selectionStatusLabel
        ? {
            id: 'selection',
            ...defineLazyRegistryComponent({
              loadComponent: loadSelectionStatusBarItem,
              componentProps: {
                label: selectionStatusLabel.value,
                popoverSections: [
                  {
                    id: 'selection-references',
                    loadComponent: loadSelectionReferencesPopover,
                  },
                ],
              },
            }),
            order: 10,
            scopes: ['file'],
          }
        : null
    )
  })
  const measurementStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value
        ? {
            id: 'measure',
            ...defineLazyRegistryComponent({
              loadComponent: loadMeasurementStatusBarItem,
            }),
            order: 9,
            scopes: ['file'],
          }
        : null
    )
  )
  const selectionFilterStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value
        ? {
            id: 'selection-filter',
            ...defineLazyRegistryComponent({
              loadComponent: loadSelectionFilterControls,
            }),
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
            ...defineLazyRegistryComponent({
              loadComponent: loadExperimentalFeaturesMenu,
            }),
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
            ...defineLazyRegistryComponent({
              loadComponent: loadUnitsMenu,
            }),
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
        provideCommand(openMeasureToolCommand),
        provideKeymapItem(openMeasureToolKeymapItem),
        provide(statusBarLocalItemsValueSpec, measurementStatusBarItem),
        provide(statusBarLocalItemsValueSpec, selectionFilterStatusBarItem),
        provide(statusBarLocalItemsValueSpec, selectionStatusBarItem),
        provide(statusBarLocalItemsValueSpec, unitsStatusBarItem),
        provide(
          statusBarLocalItemsValueSpec,
          experimentalFeaturesStatusBarItem
        ),
        provide(engineSceneStreamClassNamesValueSpec, defaultStreamClassName, {
          key: defaultStreamClassName.id,
        }),
        provide(engineSceneViewExtensionsValueSpec, toolbarViewExtension, {
          key: toolbarViewExtension.id,
        }),
        provide(
          engineSceneViewExtensionsValueSpec,
          sketchBackgroundOpacityViewExtension,
          {
            key: sketchBackgroundOpacityViewExtension.id,
          }
        ),
        provide(
          engineSceneViewExtensionsValueSpec,
          sketchConstraintsToggleViewExtension,
          {
            key: sketchConstraintsToggleViewExtension.id,
          }
        ),
        provide(engineSceneViewExtensionsValueSpec, gizmoViewExtension, {
          key: gizmoViewExtension.id,
        }),
      ],
      uses: [executionIndicator],
    }),
  }
}, 'engine-scene-extension')

export default engineSceneExtension
