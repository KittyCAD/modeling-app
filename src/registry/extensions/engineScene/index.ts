import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { provideCommand } from '@src/registry/contracts/commands'
import {
  ENGINE_SCENE_HUD_AREA_TOGGLE_COMMAND_ID,
  ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE,
  ENGINE_SCENE_MODEL_TREE_HUD_TOGGLE_KEYSTROKES,
  defineEngineSceneHudArea,
  defineEngineSceneHudAreaToggleKeymapItem,
  defineEngineSceneStreamClassName,
  defineEngineSceneViewExtension,
  type EngineSceneExtensionContext,
  type EngineSceneHudAreaToggleRequest,
  type EngineSceneHudAreaProps,
  engineSceneHudAreasValueSpec,
  engineSceneModelTreeHudService,
  engineSceneStreamClassNamesValueSpec,
  engineSceneViewExtensionsValueSpec,
} from '@src/registry/contracts/engineScene'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  type KeymapDocument,
  type KeymapItem,
  type KeymapScope,
  MODE_MODELING_KEYMAP_SCOPE,
  provideKeymapItem,
  provideKeymapScope,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'
import {
  nullableStatusBarItem,
  statusBarGlobalItemsValueSpec,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { type ComponentType, createElement, lazy, Suspense } from 'react'
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
  focusModelTreeHud: 'zds.engineScene.focusModelTreeHud',
  openMeasureTool: 'zds.engineScene.openMeasureTool',
  toggleModelTreeHudArea: ENGINE_SCENE_HUD_AREA_TOGGLE_COMMAND_ID,
} as const)

const modelTreeHudFocusedKeymapScope: KeymapScope = {
  id: ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE,
  displayName: 'Model tree HUD focused',
  priority: 1200,
  userEditable: false,
}

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

const focusModelTreeHudKeymapItem: KeymapItem = {
  id: 'engine-scene.model-tree-hud.focus',
  title: 'Focus model tree',
  source: ENGINE_SCENE_KEYMAP_SOURCE,
  scopes: [MODE_MODELING_KEYMAP_SCOPE],
  keystrokes: ENGINE_SCENE_MODEL_TREE_HUD_TOGGLE_KEYSTROKES,
  command: ENGINE_SCENE_COMMAND_IDS.focusModelTreeHud,
}

// Registry extension entrypoints are imported eagerly while App is still
// initializing. These status bar components can reach boot.ts, so keep them
// behind lazy imports to avoid an App <-> boot cycle.
const FeatureTreeHudArea = lazy<ComponentType<EngineSceneHudAreaProps>>(
  async () => {
    const { FeatureTreeHudArea } = await import(
      '@src/components/layout/areas/FeatureTreePane'
    )
    return { default: FeatureTreeHudArea }
  }
)

const FeatureTreeHudHeaderActions = lazy<
  ComponentType<EngineSceneHudAreaProps>
>(async () => {
  const { FeatureTreeMenu } = await import(
    '@src/components/layout/areas/FeatureTreeMenu'
  )
  return { default: FeatureTreeMenu }
})

const BodiesHudArea = lazy<ComponentType<EngineSceneHudAreaProps>>(async () => {
  const { BodiesHudArea } = await import(
    '@src/components/layout/areas/BodiesPane'
  )
  return { default: BodiesHudArea }
})

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

const ScreenshotStatusBarItem = lazy(async () => {
  const { ScreenshotStatusBarItem } = await import('./ScreenshotStatusBarItem')
  return { default: ScreenshotStatusBarItem }
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

const EngineSceneFeatureTreeHudArea = (props: EngineSceneHudAreaProps) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(FeatureTreeHudArea, props)
  )

const EngineSceneFeatureTreeHudHeaderActions = (
  props: EngineSceneHudAreaProps
) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(FeatureTreeHudHeaderActions, props)
  )

const EngineSceneBodiesHudArea = (props: EngineSceneHudAreaProps) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(BodiesHudArea, props)
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

const featureTreeHudArea = defineEngineSceneHudArea({
  id: 'engine-scene.feature-tree',
  title: 'Features',
  toggleKeymap: {
    id: 'engine-scene.model-tree-hud.features.toggle',
    title: 'Toggle features',
    keystrokes: ['f'],
  },
  icon: 'model',
  order: 0,
  Component: EngineSceneFeatureTreeHudArea,
  HeaderActions: EngineSceneFeatureTreeHudHeaderActions,
})

const bodiesHudArea = defineEngineSceneHudArea({
  id: 'engine-scene.bodies',
  title: 'Bodies',
  toggleKeymap: {
    id: 'engine-scene.model-tree-hud.bodies.toggle',
    title: 'Toggle bodies',
    keystrokes: ['b'],
  },
  icon: 'body',
  order: 10,
  Component: EngineSceneBodiesHudArea,
})

const EngineSceneMeasurementStatusBarItem = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(MeasurementStatusBarItem)
  )

const EngineSceneScreenshotStatusBarItem = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(ScreenshotStatusBarItem)
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
  const engineSceneHudAreas = ctx.valueSpecs.signal(
    engineSceneHudAreasValueSpec
  )
  const modelTreeHudExpanded = signal(true)
  const modelTreeHudFocused = signal(false)
  const modelTreeHudFocusRequest = signal(0)
  const modelTreeHudAreaToggleRequest =
    signal<EngineSceneHudAreaToggleRequest | null>(null)
  let modelTreeHudAreaToggleRequestId = 0
  const modelTreeHudService = {
    expanded: modelTreeHudExpanded,
    focused: modelTreeHudFocused,
    focusRequest: modelTreeHudFocusRequest,
    areaToggleRequest: modelTreeHudAreaToggleRequest,
    expand: () => {
      modelTreeHudExpanded.value = true
    },
    collapse: () => {
      modelTreeHudExpanded.value = false
      modelTreeHudFocused.value = false
    },
    toggle: () => {
      const shouldExpand = !modelTreeHudExpanded.value
      modelTreeHudExpanded.value = shouldExpand
      if (!shouldExpand) {
        modelTreeHudFocused.value = false
      }
    },
    focus: () => {
      modelTreeHudExpanded.value = true
      modelTreeHudFocusRequest.value += 1
    },
    setFocused: (focused: boolean) => {
      modelTreeHudFocused.value = focused
    },
    toggleArea: (areaId: string) => {
      modelTreeHudExpanded.value = true
      modelTreeHudAreaToggleRequest.value = {
        areaId,
        requestId: ++modelTreeHudAreaToggleRequestId,
      }
    },
  }
  const modelTreeHudAreaToggleKeymapDocument = computed(
    (): KeymapDocument => ({
      source: ENGINE_SCENE_KEYMAP_SOURCE,
      bindings: engineSceneHudAreas.value.map((area) =>
        defineEngineSceneHudAreaToggleKeymapItem(
          area,
          ENGINE_SCENE_KEYMAP_SOURCE
        )
      ),
    })
  )
  const focusModelTreeHudCommand: Command = {
    id: ENGINE_SCENE_COMMAND_IDS.focusModelTreeHud,
    name: ENGINE_SCENE_COMMAND_IDS.focusModelTreeHud,
    groupId: ENGINE_SCENE_COMMAND_GROUP_ID,
    displayName: 'Focus model tree',
    description: 'Expand and focus the model tree HUD.',
    icon: 'model',
    needsReview: false,
    onSubmit: () => {
      if (modelTreeHudExpanded.value && modelTreeHudFocused.value) {
        modelTreeHudService.collapse()
      } else {
        modelTreeHudService.focus()
      }
      return true
    },
  }
  const toggleModelTreeHudAreaCommand: Command = {
    id: ENGINE_SCENE_COMMAND_IDS.toggleModelTreeHudArea,
    name: ENGINE_SCENE_COMMAND_IDS.toggleModelTreeHudArea,
    groupId: ENGINE_SCENE_COMMAND_GROUP_ID,
    displayName: 'Toggle model tree section',
    description: 'Toggle a focused model tree HUD section.',
    icon: 'model',
    needsReview: false,
    hideFromSearch: true,
    args: {
      areaId: {
        inputType: 'string',
        required: false,
        hidden: true,
        skip: true,
      },
    },
    onSubmit: (data) => {
      const areaId =
        data && typeof data === 'object' && 'areaId' in data
          ? (data as { areaId?: unknown }).areaId
          : undefined
      if (typeof areaId !== 'string') {
        return false
      }

      modelTreeHudService.toggleArea(areaId)
      return true
    },
  }
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
  const screenshotStatusBarItem = computed(() =>
    nullableStatusBarItem(
      executionService.value
        ? {
            id: 'capture-screenshot',
            component: EngineSceneScreenshotStatusBarItem,
            order: 8,
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
      providesServices: [
        provideService(engineSceneModelTreeHudService, modelTreeHudService),
      ],
      provides: [
        provideCommand(captureScreenshotCommand),
        provideCommand(focusModelTreeHudCommand),
        provideCommand(openMeasureToolCommand),
        provideCommand(toggleModelTreeHudAreaCommand),
        provideKeymapScope(modelTreeHudFocusedKeymapScope),
        provideKeymapItem(focusModelTreeHudKeymapItem),
        provideKeymapItem(openMeasureToolKeymapItem),
        provide(keymapValueSpec, modelTreeHudAreaToggleKeymapDocument, {
          key: 'engine-scene.model-tree-hud.area-toggle-keymap',
        }),
        provide(statusBarGlobalItemsValueSpec, screenshotStatusBarItem),
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
        provide(engineSceneHudAreasValueSpec, featureTreeHudArea, {
          key: featureTreeHudArea.id,
        }),
        provide(engineSceneHudAreasValueSpec, bodiesHudArea, {
          key: bodiesHudArea.id,
        }),
      ],
      uses: [executionIndicator],
    }),
  }
}, 'engine-scene-extension')

export default engineSceneExtension
