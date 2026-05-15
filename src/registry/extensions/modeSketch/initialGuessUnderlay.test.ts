import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  type ProjectService,
  type SketchSolveScenePlugin,
  projectService,
  sketchSolveScenePluginsValueSpec,
} from '@src/registry/contracts/project'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import modeSketch from '@src/registry/plugins/modeSketch'
import { describe, expect, it } from 'vitest'
import {
  INITIAL_GUESS_UNDERLAY_OBJECT_NAME,
  buildInitialGuessDriftsForSceneGraph,
} from './initialGuessUnderlay'

function createSketchApiObject(id: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      constraints: [],
      plane: 0,
      segments: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createSettings(showSketchInitialGuessDrift: boolean): SettingsType {
  return {
    debug: {
      showSketchInitialGuessDrift: {
        current: showSketchInitialGuessDrift,
      },
    },
  } as unknown as SettingsType
}

function createProjectServiceItem(settings: ProjectService['settings']) {
  return defineRegistryItem({
    providesServices: [
      provideService(projectService, {
        project: {} as ProjectService['project'],
        settings,
        sketchSolveScenePlugins: signal([] as SketchSolveScenePlugin[]),
      }),
    ],
  })
}

function createTrace(
  sketchId: number,
  guesses: Array<[number, number]>
): SketchSolverTrace {
  return {
    sketchId,
    sourceRange: [0, 0, 0],
    requiredConstraintCount: 0,
    optionalConstraintCount: 0,
    initialGuessCount: guesses.length,
    items: guesses.map(([id, value]) => ({
      kind: 'initialGuess',
      label: `guess ${id}`,
      detail: String(value),
    })),
  }
}

describe('mode sketch initial guess drift plugin', () => {
  it('contributes initial guess drift as a debug-controlled setting', () => {
    const registry = new Registry()
    registry.configure([modeSketch])

    const setting = registry
      .get(settingsValueSpec)
      .debug.showSketchInitialGuessDrift.createSetting()

    expect(setting.default).toBe(false)
    expect(registry.get(settingsValueSpec).plugins['mode-sketch']).toBeDefined()
    expect(registry.get(sketchSolveScenePluginsValueSpec)).toHaveLength(0)
  })

  it('derives the initial guess drift scene plugin from live settings', () => {
    const registry = new Registry()
    const settings = signal(createSettings(false))

    registry.configure([createProjectServiceItem(settings), modeSketch])

    const plugins = registry.signal(sketchSolveScenePluginsValueSpec)

    expect(plugins.value).toHaveLength(0)

    settings.value = createSettings(true)

    expect(plugins.value).toHaveLength(1)
    const plugin = plugins.value[0]
    expect(plugin?.id).toBe(INITIAL_GUESS_UNDERLAY_OBJECT_NAME)
    expect(plugin?.onSketchScenePluginDispose).toBeTypeOf('function')

    settings.value = createSettings(false)

    expect(plugins.value).toHaveLength(0)
  })
})

describe('buildInitialGuessDriftsForSceneGraph', () => {
  it('builds drift pairs from trace guesses to resolved sketch points', () => {
    const sceneGraphDelta = createSceneGraphDelta([
      createSketchApiObject(0),
      createPointApiObject({ id: 1, x: 2, y: 3 }),
      createPointApiObject({ id: 2, x: 5, y: 6 }),
    ])
    sceneGraphDelta.exec_outcome.sketchSolverTraces = [
      createTrace(0, [
        [0, 1],
        [1, 3],
        [2, 5],
        [3, 6],
      ]),
    ]

    expect(buildInitialGuessDriftsForSceneGraph(sceneGraphDelta, 0)).toEqual([
      {
        pointId: 1,
        xGuessId: 0,
        yGuessId: 1,
        guess: { x: 1, y: 3 },
        resolved: { x: 2, y: 3 },
        distance: 1,
      },
    ])
  })

  it('uses the latest trace for the active sketch', () => {
    const sceneGraphDelta = createSceneGraphDelta([
      createSketchApiObject(0),
      createPointApiObject({ id: 1, x: 2, y: 3 }),
    ])
    sceneGraphDelta.exec_outcome.sketchSolverTraces = [
      createTrace(0, [
        [0, -10],
        [1, -10],
      ]),
      createTrace(1, [
        [0, -20],
        [1, -20],
      ]),
      createTrace(0, [
        [0, 2],
        [1, 1],
      ]),
    ]

    expect(buildInitialGuessDriftsForSceneGraph(sceneGraphDelta, 0)).toEqual([
      {
        pointId: 1,
        xGuessId: 0,
        yGuessId: 1,
        guess: { x: 2, y: 1 },
        resolved: { x: 2, y: 3 },
        distance: 2,
      },
    ])
  })
})
