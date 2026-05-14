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
      engineCommandManager,
    })

    expect(sendSceneCommand).toHaveBeenCalledTimes(2)
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cmd: {
          type: 'set_order_independent_transparency',
          enabled: true,
        },
      })
    )
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'modeling_cmd_batch_req',
        requests: expect.arrayContaining([
          expect.objectContaining({
            cmd: expect.objectContaining({
              type: 'entity_set_opacity',
              entity_id: 'body-1',
              opacity: 0.42,
            }),
          }),
          expect.objectContaining({
            cmd: expect.objectContaining({
              type: 'entity_set_opacity',
              entity_id: 'nozzle-1',
              opacity: 0.42,
            }),
          }),
          expect.objectContaining({
            cmd: expect.objectContaining({
              type: 'entity_set_opacity',
              entity_id: 'composite-member-1',
              opacity: 0.42,
            }),
          }),
        ]),
      })
    )
  })

  it('collects X-Ray entity ids from visible and consumed bodies', () => {
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
    ]) as unknown as ScenePostprocessorContext['artifactGraph']

    expect(getXRayEntityIdsFromArtifactGraph(artifactGraph)).toEqual(
      expect.arrayContaining([
        'visible-body',
        'consumed-body',
        'composite',
        'composite-member',
        'pattern-copy',
      ])
    )
  })
})
