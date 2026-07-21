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
import { Suspense, createElement, lazy } from 'react'
import executionIndicator from './executionIndicator'
import { measurementToolService } from './measurementToolService'
import { saveViewportScreenshot } from './saveViewportScreenshot'
import {
  EngineSceneGizmoViewExtension,
  EngineSceneToolbarViewExtension,
  SketchBackgroundOpacityViewExtension,
  SketchConstraintsToggleViewExtension,
} from './viewExtensionControls'

const ENGINE_SCENE_COMMAND_GROUP_ID = 'engineScene'
const ENGINE_SCENE_KEYMAP_SOURCE = 'Engine scene'

export const ENGINE_SCENE_COMMAND_IDS = Object.freeze({
  captureScreenshot: 'zds.engineScene.captureScreenshot',
  openMeasureTool: 'zds.engineScene.openMeasureTool',
} as const)

const captureScreenshotCommand: Command = {
  id: ENGINE_SCENE_COMMAND_IDS.captureScreenshot,
  name: ENGINE_SCENE_COMMAND_IDS.captureScreenshot,
  groupId: ENGINE_SCENE_COMMAND_GROUP_ID,
  displayName: 'Capture screenshot',
  description: 'Save the current modeling viewport as a PNG image.',
  icon: 'camera',
  needsReview: false,
  onSubmit: saveViewportScreenshot,
}

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

const MeasurementStatusBarItem = lazy(async () => {
  const { MeasurementStatusBarItem } = await import('./MeasurementTool')
  return { default: MeasurementStatusBarItem }
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
  Component: EngineSceneToolbarViewExtension,
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
  Component: EngineSceneGizmoViewExtension,
})

const EngineSceneMeasurementStatusBarItem = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(MeasurementStatusBarItem)
  )

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
  const measurementStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value
        ? {
            id: 'measure',
            component: EngineSceneMeasurementStatusBarItem,
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
        provideCommand(captureScreenshotCommand),
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
