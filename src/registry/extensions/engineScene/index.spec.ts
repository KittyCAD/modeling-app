import {
  Registry,
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { modelingMachine } from '@src/machines/modelingMachine'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import {
  type EngineSceneExtensionContext,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
  engineSceneViewExtensionsValueSpec,
  mergeEngineSceneClassNames,
  resolveEngineSceneViewExtensions,
} from '@src/registry/contracts/engineScene'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  MODE_MODELING_KEYMAP_SCOPE,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import {
  statusBarGlobalItemsValueSpec,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import type { StateFrom } from 'xstate'
import engineSceneExtension, { ENGINE_SCENE_COMMAND_IDS } from '.'
import { measurementToolService } from './measurementToolService'
import { saveViewportScreenshot } from './saveViewportScreenshot'

vi.mock('@src/components/ExperimentalFeaturesMenu', () => ({
  ExperimentalFeaturesMenu: () => null,
}))
vi.mock('@src/components/SelectionReferencesPopover', () => ({
  SelectionReferencesPopover: () => null,
}))
vi.mock('@src/components/SelectionStatusBarItem', () => ({
  SelectionStatusBarItem: () => null,
}))
vi.mock('@src/components/UnitsMenu', () => ({
  UnitsMenu: () => null,
}))

function createExecutingEditorService(
  isExecuting = signal(false),
  showExperimentalFeaturesStatusBarItem = signal(true)
): ExecutingEditorService {
  return {
    code: signal(''),
    hasEditsSinceLastExecution: signal(false),
    isExecuting,
    executionElapsedMs: signal(0),
    selectionStatusLabel: signal('No selection'),
    showExperimentalFeaturesStatusBarItem,
    getPendingCommandCount: vi.fn(() => 0),
    executeCode: vi.fn(),
    updateCode: vi.fn(),
  }
}

function createModelingState(
  inSketchSolveMode: boolean
): StateFrom<typeof modelingMachine> {
  return {
    context: {
      showNonVisualConstraints: false,
    },
    matches: (state: string) =>
      state === 'sketchSolveMode' && inSketchSolveMode,
  } as unknown as StateFrom<typeof modelingMachine>
}

function createEngineSceneViewExtensionContext(
  inSketchSolveMode: boolean
): EngineSceneExtensionContext {
  return {
    modelingState: createModelingState(inSketchSolveMode),
    modelingSend: vi.fn(),
    sketchSolveStreamDimming: 0.3,
    setSketchSolveStreamDimming: vi.fn(),
  }
}

describe('engineScene extension', () => {
  it('bundles the execution indicator without a plugin or setting', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const executionIndicatorPlugin = registry
      .get(pluginsValueSpec)
      .find((plugin) => plugin.id === 'execution-indicator')

    expect(executionIndicatorPlugin).toBeUndefined()
    expect(
      registry.get(settingsValueSpec).modeling?.executionIndicator
    ).toBeUndefined()
  })

  it('contributes ordered engine scene status bar items', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService()
          ),
        ],
      }),
      engineSceneExtension,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([
      'measure',
      'selection',
      'selection-filter',
      'units',
      'experimental-features',
    ])
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.scopes)
    ).toEqual([['file'], ['file'], ['file'], ['file'], ['file']])
    expect(registry.get(statusBarGlobalItemsValueSpec)).toMatchObject([
      {
        id: 'capture-screenshot',
        scopes: ['file'],
      },
    ])
  })

  it('contributes a command and modeling keybinding to open the measure tool', () => {
    measurementToolService.close()
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const command = registry
      .get(commandsValueSpec)
      .find(
        (candidate) => candidate.id === ENGINE_SCENE_COMMAND_IDS.openMeasureTool
      )
    const keymapItem = registry
      .get(keymapValueSpec)
      .items.find((item) => item.id === 'engine-scene.measure.open')

    expect(command).toMatchObject({
      displayName: 'Open measure tool',
      icon: 'ruler',
      needsReview: false,
    })
    expect(keymapItem).toMatchObject({
      title: 'Open measure tool',
      scopes: [MODE_MODELING_KEYMAP_SCOPE],
      keystrokes: ['shift+m'],
      command: ENGINE_SCENE_COMMAND_IDS.openMeasureTool,
    })

    expect(measurementToolService.isOpen.value).toBe(false)
    command?.onSubmit()
    expect(measurementToolService.isOpen.value).toBe(true)

    measurementToolService.close()
  })

  it('contributes the capture screenshot command', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const command = registry
      .get(commandsValueSpec)
      .find(
        (candidate) =>
          candidate.id === ENGINE_SCENE_COMMAND_IDS.captureScreenshot
      )

    expect(command).toMatchObject({
      displayName: 'Capture screenshot',
      description: 'Save the current modeling viewport as a PNG image.',
      icon: 'camera',
      needsReview: false,
      onSubmit: saveViewportScreenshot,
    })
    expect(command?.hideFromSearch).not.toBe(true)
  })

  it('hides the experimental features item when file settings deny it', () => {
    const showExperimentalFeaturesStatusBarItem = signal(false)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService(
              signal(false),
              showExperimentalFeaturesStatusBarItem
            )
          ),
        ],
      }),
      engineSceneExtension,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['measure', 'selection', 'selection-filter', 'units'])

    showExperimentalFeaturesStatusBarItem.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([
      'measure',
      'selection',
      'selection-filter',
      'units',
      'experimental-features',
    ])
  })

  it('contributes engine scene view extensions by zone', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    expect(
      registry.get(engineSceneViewExtensionsValueSpec).map((extension) => ({
        id: extension.id,
        zone: extension.zone,
      }))
    ).toEqual([
      { id: 'engine-scene.toolbar', zone: 'top' },
      { id: 'engine-scene.sketch-background-opacity', zone: 'bottom-left' },
      { id: 'engine-scene.sketch-constraints-toggle', zone: 'bottom-left' },
      { id: 'engine-scene.gizmo', zone: 'bottom-right' },
    ])
  })

  it('contributes the default engine stream class name', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    expect(registry.get(engineSceneStreamClassNamesValueSpec)).toEqual([
      {
        id: 'engine-scene.stream-default',
        order: 0,
        className: 'absolute inset-x-[-4px] inset-y-[-4px] z-0',
      },
    ])
    expect(registry.get(engineSceneStreamLayersValueSpec)).toEqual([])
  })

  it('merges later stream class name conflicts over earlier ones', () => {
    expect(
      mergeEngineSceneClassNames([
        {
          id: 'default',
          className: 'absolute inset-[-4px] z-0',
        },
        {
          id: 'active-extension',
          className: 'inset-4 transition-all bg-ml-green rounded-lg',
        },
      ])
    ).toBe('absolute z-0 inset-4 transition-all bg-ml-green rounded-lg')
  })

  it('preserves granular stream inset class name overrides', () => {
    expect(
      mergeEngineSceneClassNames([
        {
          id: 'default',
          order: 0,
          className: 'absolute inset-x-[-4px] inset-y-[-4px] z-0',
        },
        {
          id: 'extension',
          order: 10,
          className: 'inset-x-0 inset-y-4',
        },
      ])
    ).toBe('absolute z-0 inset-x-0 inset-y-4')
  })

  it('registers sketch-only view extensions from modeling state', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])
    const extensions = registry.get(engineSceneViewExtensionsValueSpec)

    expect(
      resolveEngineSceneViewExtensions(
        extensions,
        createEngineSceneViewExtensionContext(false)
      ).map((extension) => extension.id)
    ).toEqual(['engine-scene.toolbar', 'engine-scene.gizmo'])

    expect(
      resolveEngineSceneViewExtensions(
        extensions,
        createEngineSceneViewExtensionContext(true)
      ).map((extension) => extension.id)
    ).toEqual([
      'engine-scene.toolbar',
      'engine-scene.sketch-background-opacity',
      'engine-scene.sketch-constraints-toggle',
      'engine-scene.gizmo',
    ])
  })
})
