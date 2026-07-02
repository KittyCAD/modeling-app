import {
  Registry,
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { modelingMachine } from '@src/machines/modelingMachine'
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
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import type { StateFrom } from 'xstate'
import engineSceneExtension from '.'

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
  it('bundles the execution indicator plugin off by default', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const executionIndicatorPlugin = registry
      .get(pluginsValueSpec)
      .find((plugin) => plugin.id === 'execution-indicator')

    expect(executionIndicatorPlugin).toBeDefined()
    if (!executionIndicatorPlugin) {
      throw new Error('Expected execution indicator plugin')
    }
    expect(
      registry
        .get(settingsValueSpec)
        .modeling.executionIndicator.createSetting().default
    ).toBe(false)
    expect(
      registry.get(settingsValueSpec).plugins?.['execution-indicator']
    ).toBeUndefined()
    expect(registry.get(executionIndicatorPlugin.service).active.value).toBe(
      false
    )
  })

  it('contributes ordered engine scene local status bar items', () => {
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
      'selection',
      'selection-filter',
      'units',
      'experimental-features',
    ])
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.scopes)
    ).toEqual([['file'], ['file'], ['file'], ['file']])
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
    ).toEqual(['selection', 'selection-filter', 'units'])

    showExperimentalFeaturesStatusBarItem.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([
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
        className: 'absolute inset-[-4px] z-0',
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
