import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import engineSceneExtension from '.'
import { ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID } from './constants'
import type { ScenePostprocessorContext } from './scenePostprocessors'
import { scenePostprocessorsValueSpec } from './scenePostprocessors'
import {
  sceneControlsViewExtensionsValueSpec,
  viewExtensionsValueSpec,
} from './viewExtensions'
import {
  applyXRayTransparencyToScene,
  getXRayEntityIdsFromArtifactGraph,
  xRayTransparency,
} from './xRayPostprocessor'

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

function createAppearanceOperation({
  artifactId,
  color,
  metalness,
  roughness,
  opacity,
}: {
  artifactId: string
  color: string
  metalness?: number
  roughness?: number
  opacity?: number
}): ScenePostprocessorContext['operations'][number] {
  return {
    type: 'StdLibCall',
    name: 'appearance',
    unlabeledArg: {
      value: {
        type: 'Solid',
        value: {
          artifactId,
        },
      },
      sourceRange: [],
    },
    labeledArgs: {
      color: {
        value: {
          type: 'String',
          value: color,
        },
        sourceRange: [],
      },
      ...(metalness === undefined
        ? {}
        : {
            metalness: {
              value: {
                type: 'Number',
                value: metalness,
              },
              sourceRange: [],
            },
          }),
      ...(roughness === undefined
        ? {}
        : {
            roughness: {
              value: {
                type: 'Number',
                value: roughness,
              },
              sourceRange: [],
            },
          }),
      ...(opacity === undefined
        ? {}
        : {
            opacity: {
              value: {
                type: 'Number',
                value: opacity,
              },
              sourceRange: [],
            },
          }),
    },
    nodePath: { steps: [] },
    sourceRange: [],
  } as unknown as ScenePostprocessorContext['operations'][number]
}

describe('engineScene extension', () => {
  afterEach(() => {
    xRayTransparency.value = 1
  })

  it('contributes the executing spinner setting disabled by default', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const setting = registry
      .get(settingsValueSpec)
      .modeling.showExecutingSpinner.createSetting()

    expect(setting.default).toBe(false)
  })

  it('contributes ordered engine scene local status bar items', () => {
    const isExecuting = signal(false)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService(isExecuting)
          ),
        ],
      }),
      engineSceneExtension,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['selection', 'units', 'experimental-features'])
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.scopes)
    ).toEqual([['file'], ['file'], ['file']])

    isExecuting.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([
      ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID,
      'selection',
      'units',
      'experimental-features',
    ])

    isExecuting.value = false

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['selection', 'units', 'experimental-features'])
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
    ).toEqual(['selection', 'units'])

    showExperimentalFeaturesStatusBarItem.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['selection', 'units', 'experimental-features'])
  })

  it('contributes the X-Ray transparency scene postprocessor', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    expect(
      registry.get(scenePostprocessorsValueSpec).map((item) => item.id)
    ).toEqual(['engine-scene.x-ray.override-transparency'])
  })

  it('contributes scene controls view extensions', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    expect(
      registry.get(viewExtensionsValueSpec).map((item) => item.id)
    ).toEqual(['engine-scene.scene-controls'])
    expect(
      registry.get(sceneControlsViewExtensionsValueSpec).map((item) => item.id)
    ).toEqual(['engine-scene.x-ray.control'])
  })

  it('applies X-Ray transparency to scene bodies', async () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])
    const [postprocessor] = registry.get(scenePostprocessorsValueSpec)
    const sendSceneCommand = vi.fn().mockResolvedValue(null)
    const artifactGraph = new Map([
      [
        'body-1',
        {
          id: 'body-1',
          type: 'sweep',
          consumed: false,
        },
      ],
      [
        'nozzle-1',
        {
          id: 'nozzle-1',
          type: 'sweep',
          consumed: true,
        },
      ],
      [
        'composite-1',
        {
          id: 'composite-1',
          type: 'compositeSolid',
          consumed: false,
          solidIds: ['composite-member-1', 'composite-member-2'],
          toolIds: [],
        },
      ],
    ]) as unknown as ScenePostprocessorContext['artifactGraph']
    const engineCommandManager = {
      settings: { enableSSAO: true },
      sendSceneCommand,
    } as unknown as ScenePostprocessorContext['engineCommandManager']

    xRayTransparency.value = 0.42

    await postprocessor.postprocess({
      artifactGraph,
      operations: [
        createAppearanceOperation({
          artifactId: 'body-1',
          color: '#ff0000',
          metalness: 50,
          roughness: 25,
        }),
        createAppearanceOperation({
          artifactId: 'composite-member-1',
          color: '#00ff00',
          metalness: 80,
          roughness: 40,
        }),
      ],
      engineCommandManager,
    })

    expect(sendSceneCommand).toHaveBeenCalledTimes(3)
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cmd: {
          type: 'set_order_independent_transparency',
          enabled: true,
        },
      })
    )
    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'modeling_cmd_req',
        cmd: expect.objectContaining({
          type: 'object_set_material_params_pbr',
          object_id: 'body-1',
          color: {
            r: 1,
            g: 0,
            b: 0,
            a: 0.42,
          },
          metalness: 0.5,
          roughness: 0.25,
          ambient_occlusion: 0,
        }),
      })
    )
    expect(sendSceneCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'modeling_cmd_req',
        cmd: expect.objectContaining({
          type: 'object_set_material_params_pbr',
          object_id: 'nozzle-1',
        }),
      })
    )
    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'modeling_cmd_req',
        cmd: expect.objectContaining({
          type: 'object_set_material_params_pbr',
          object_id: 'composite-1',
          color: {
            r: 0,
            g: 1,
            b: 0,
            a: 0.42,
          },
          metalness: 0.8,
          roughness: 0.4,
          ambient_occlusion: 0,
        }),
      })
    )
    expect(sendSceneCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'modeling_cmd_req',
        cmd: expect.objectContaining({
          type: 'object_set_material_params_pbr',
          object_id: 'composite-member-1',
        }),
      })
    )
    expect(sendSceneCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'scene_get_entity_ids',
        }),
      })
    )
  })

  it('restores original material alpha when X-Ray transparency is forced off', async () => {
    const sendSceneCommand = vi.fn().mockResolvedValue(null)
    const artifactGraph = new Map([
      [
        'body-1',
        {
          id: 'body-1',
          type: 'sweep',
          consumed: false,
        },
      ],
    ]) as unknown as ScenePostprocessorContext['artifactGraph']
    const engineCommandManager = {
      settings: { enableSSAO: true },
      sendSceneCommand,
    } as unknown as ScenePostprocessorContext['engineCommandManager']

    await applyXRayTransparencyToScene({
      transparency: 1,
      artifactGraph,
      operations: [
        createAppearanceOperation({
          artifactId: 'body-1',
          color: '#336699',
          metalness: 80,
          roughness: 20,
          opacity: 30,
        }),
      ],
      engineCommandManager,
      force: true,
    })

    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: {
          type: 'set_order_independent_transparency',
          enabled: true,
        },
      })
    )
    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'modeling_cmd_req',
        cmd: expect.objectContaining({
          type: 'object_set_material_params_pbr',
          object_id: 'body-1',
          color: {
            r: 0.2,
            g: 0.4,
            b: 0.6,
            a: 0.3,
          },
          metalness: 0.8,
          roughness: 0.2,
          ambient_occlusion: 0,
        }),
      })
    )
  })

  it('collects X-Ray entity ids from non-consumed bodies', () => {
    const artifactGraph = new Map([
      [
        'visible-body',
        {
          id: 'visible-body',
          type: 'sweep',
          consumed: false,
        },
      ],
      [
        'consumed-body',
        {
          id: 'consumed-body',
          type: 'sweep',
          consumed: true,
        },
      ],
      [
        'composite',
        {
          id: 'composite',
          type: 'compositeSolid',
          consumed: false,
          solidIds: ['composite-member'],
          toolIds: [],
        },
      ],
      [
        'pattern',
        {
          id: 'pattern',
          type: 'pattern',
          sourceId: 'visible-body',
          copyIds: ['pattern-copy'],
        },
      ],
      [
        'consumed-source',
        {
          id: 'consumed-source',
          type: 'sweep',
          consumed: true,
          patternIds: ['consumed-source-pattern'],
        },
      ],
      [
        'consumed-source-pattern',
        {
          id: 'consumed-source-pattern',
          type: 'pattern',
          sourceId: 'consumed-source',
          copyIds: ['consumed-source-pattern-copy'],
        },
      ],
    ]) as unknown as ScenePostprocessorContext['artifactGraph']

    expect(getXRayEntityIdsFromArtifactGraph(artifactGraph)).toEqual(
      expect.arrayContaining([
        'visible-body',
        'composite',
        'pattern-copy',
        'consumed-source-pattern-copy',
      ])
    )
    expect(getXRayEntityIdsFromArtifactGraph(artifactGraph)).not.toEqual(
      expect.arrayContaining([
        'consumed-body',
        'composite-member',
        'consumed-source',
      ])
    )
  })
})
