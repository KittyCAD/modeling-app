import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@src/routes/utils', () => ({
  APP_DOWNLOAD_PATH: 'design-studio/download/staging',
  APP_VERSION: '0.0.0',
  IS_STAGING: false,
  IS_STAGING_OR_DEBUG: true,
  PACKAGE_NAME: 'zoo-modeling-app',
  generateSignInUrl: () => '/signin',
  getAppVersion: () => '0.0.0',
  getRefFromVersion: () => undefined,
  getReleaseUrl: () => 'https://github.com/KittyCAD/modeling-app/commit/main',
}))

vi.mock('@src/lib/isPlaywright', () => ({
  isPlaywright: () => false,
}))

import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { assertParse, defaultNodePath } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import {
  type Conversation,
  type MlEphantManagerContext,
  type MlEphantManagerEvents,
  MlEphantManagerStates,
  MlEphantManagerTransitions,
  mlEphantManagerMachine,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import { modelingMachine } from '@src/machines/modelingMachine'
import { generateModelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import type {
  EnginePrimitiveSelection,
  Selections,
  SetSelections,
} from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { createActor, fromPromise, waitFor } from 'xstate'

class TestSocket extends EventTarget {
  sentPayloads: string[] = []
  readyState: number = WebSocket.OPEN

  send(payload: string) {
    this.sentPayloads.push(payload)
  }

  close = vi.fn()
}

type TestWebSocket = Pick<MlEphantManagerContext, 'ws'>['ws'] & TestSocket
type SetupActorInput = {
  event: Extract<MlEphantManagerEvents, { type: MlEphantManagerStates.Setup }>
  context: MlEphantManagerContext
}

describe('Zookeeper prompt selections from modelingMachine', () => {
  let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>

  beforeAll(async () => {
    world = await buildTheWorldAndNoEngineConnection()
  })

  afterAll(() => {
    world.engineCommandManager.tearDown()
    world.commandBarActor.stop()
    world.settingsActor.stop()
  })

  const currentFileEntry: FileEntry = {
    path: '/projects/zoo-project/main.kcl',
    name: 'main.kcl',
    children: null,
  }

  const project: Project = {
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: currentFileEntry.path,
    path: '/projects/zoo-project',
    name: 'zoo-project',
    children: [currentFileEntry],
    readWriteAccess: true,
  }

  function setupModelingSelection({
    code,
    selection,
    artifactGraph = new Map() as ArtifactGraph,
  }: {
    code: string
    selection: SetSelections
    artifactGraph?: ArtifactGraph
  }): Selections {
    world.kclManager.updateCodeEditor(code, {
      shouldWriteToDisk: false,
      shouldAddToHistory: false,
    })
    world.kclManager.ast = assertParse(code, world.instance)
    world.kclManager.artifactGraph = artifactGraph

    const context = generateModelingMachineDefaultContext({
      kclManager: world.kclManager,
      rustContext: world.rustContext,
      wasmInstance: world.instance,
      engineCommandManager: world.engineCommandManager,
      commandBarActor: world.commandBarActor,
      machineManager: world.machineManager,
    })

    const actor = createActor(modelingMachine, { input: context }).start()
    actor.send({
      type: 'Set selection',
      data: selection,
    })

    const modelingSelections = actor.getSnapshot().context.selectionRanges
    actor.stop()
    return modelingSelections
  }

  async function sendZookeeperMessage({
    code,
    selections,
    engineCommandManager = world.engineCommandManager,
  }: {
    code: string
    selections: Selections | null
    engineCommandManager?: ConnectionManager
  }) {
    const ws: TestWebSocket = new TestSocket() as TestWebSocket
    const conversation: Conversation = { exchanges: [] }
    const machine = mlEphantManagerMachine.provide({
      actors: {
        [MlEphantManagerStates.Setup]: fromPromise<
          Partial<MlEphantManagerContext>,
          SetupActorInput
        >(async () => ({
          ws,
          conversation,
          conversationId: 'conversation-id',
        })),
      },
    })
    const actor = createActor(machine, { input: { apiToken: '' } }).start()
    const projectFiles: FileMeta[] = [
      {
        type: 'kcl',
        relPath: 'main.kcl',
        absPath: currentFileEntry.path,
        fileContents: code,
        execStateFileNamesIndex: 0,
      },
    ]

    actor.send({
      type: MlEphantManagerTransitions.CacheSetupAndConnect,
      refParentSend: () => {},
    })

    await waitFor(actor, (state) =>
      state.matches(MlEphantManagerStates.WaitForContinueCheck)
    )

    actor.send({
      type: MlEphantManagerStates.ContinueCheck,
      projectName: project.name,
      projectFiles,
      activeFile: 'main.kcl',
    })

    await waitFor(actor, (state) => state.matches(MlEphantManagerStates.Ready))

    actor.send({
      type: MlEphantManagerTransitions.MessageSend,
      projectForPromptOutput: project,
      prompt: 'change the selected values',
      applicationProjectDirectory: '/projects',
      fileSelectedDuringPrompting: {
        entry: currentFileEntry,
        content: code,
      },
      projectFiles,
      selections,
      artifactGraph: world.kclManager.artifactGraph,
      kclManager: world.kclManager,
      engineCommandManager,
      wasmInstance: world.instance,
    })

    await waitFor(actor, (state) => state.context.awaitingResponse)

    actor.stop()

    return ws.sentPayloads.map((payload) => JSON.parse(payload))
  }

  function sourceRangeForSnippet(code: string, snippet: string): SourceRange {
    const start = code.indexOf(snippet)
    expect(start).toBeGreaterThanOrEqual(0)
    return [start, start + snippet.length, 0]
  }

  function selectedIdentifierRange(
    code: string,
    identifier: string
  ): SourceRange {
    return sourceRangeForSnippet(code, identifier)
  }

  function createPrimitiveEngineConnectionManager({
    parentEntityId,
    primitiveIndex,
    primitiveType,
  }: {
    parentEntityId: string
    primitiveIndex: number
    primitiveType: 'edge' | 'face'
  }) {
    return {
      sendSceneCommand: vi.fn(async ({ cmd }: any) => {
        if (cmd.type === 'entity_get_primitive_index') {
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'entity_get_primitive_index',
                  data: {
                    entity_type: primitiveType,
                    primitive_index: primitiveIndex,
                  },
                },
              },
            },
          }
        }

        if (cmd.type === 'entity_get_parent_id') {
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'entity_get_parent_id',
                  data: {
                    entity_id: parentEntityId,
                  },
                },
              },
            },
          }
        }

        return Promise.reject(new Error(`Unexpected command ${cmd.type}`))
      }),
    } as unknown as ConnectionManager
  }

  it('omits source ranges when selection data is unavailable to ZDS', async () => {
    const code = 'width = 5\n'
    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: null,
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.content).toBe('change the selected values')
    expect(userPayload).not.toHaveProperty('source_ranges')
  })

  it('sends empty source ranges for a known-empty modelingMachine selection', async () => {
    const code = 'width = 5\n'
    const modelingSelections = setupModelingSelection({
      code,
      selection: {
        selectionType: 'completeSelection',
        selection: {
          otherSelections: [],
          graphSelections: [],
        },
      },
    })

    expect(modelingSelections).toStrictEqual({
      otherSelections: [],
      graphSelections: [],
    })

    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: modelingSelections,
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.content).toBe('change the selected values')
    expect(userPayload?.source_ranges).toStrictEqual([])
  })

  it('includes generated tag references for graph-only wall selections', async () => {
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

cubeSketch = sketch(on = XY) {
  right = line(end = [10, 0])
}
cubeRegion = region(segments = [cubeSketch.right])
cube = extrude(cubeRegion, length = 10)
`
    expect(code).not.toContain('cubeRegion.tags.right')

    const ast = assertParse(code, world.instance)
    world.kclManager.updateCodeEditor(code, {
      shouldWriteToDisk: false,
      shouldAddToHistory: false,
    })
    world.kclManager.ast = ast

    const sketchRange = sourceRangeForSnippet(
      code,
      `cubeSketch = sketch(on = XY) {
  right = line(end = [10, 0])
}`
    )
    const originalRightRange = sourceRangeForSnippet(
      code,
      'right = line(end = [10, 0])'
    )
    const cubeRegionRange = sourceRangeForSnippet(
      code,
      'cubeRegion = region(segments = [cubeSketch.right])'
    )
    const cubeRange = sourceRangeForSnippet(
      code,
      'extrude(cubeRegion, length = 10)'
    )
    const regionRightCodeRef = {
      range: cubeRegionRange,
      nodePath: defaultNodePath(),
      pathToNode: getNodePathFromSourceRange(ast, cubeRegionRange),
    }

    const cubeSketchPath: Artifact = {
      type: 'path',
      id: 'cube-sketch-path',
      subType: 'sketch',
      planeId: 'xy-plane',
      segIds: ['original-right-segment'],
      consumed: true,
      trajectorySweepId: null,
      codeRef: {
        range: sketchRange,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(ast, sketchRange),
      },
    }
    const originalRightSegment: Artifact = {
      type: 'segment',
      id: 'original-right-segment',
      pathId: cubeSketchPath.id,
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: {
        range: originalRightRange,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(ast, originalRightRange),
      },
    }
    const cubeRegionPath: Artifact = {
      type: 'path',
      id: 'cube-region-path',
      subType: 'region',
      planeId: 'xy-plane',
      segIds: ['region-right-segment'],
      consumed: true,
      sweepId: 'cube-sweep',
      trajectorySweepId: null,
      originPathId: cubeSketchPath.id,
      codeRef: {
        range: cubeRegionRange,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(ast, cubeRegionRange),
      },
    }
    const regionRightSegment: Artifact = {
      type: 'segment',
      id: 'region-right-segment',
      originalSegId: originalRightSegment.id,
      pathId: cubeRegionPath.id,
      surfaceId: 'cube-wall-right',
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: regionRightCodeRef,
    }
    const cubeSweep: Artifact = {
      type: 'sweep',
      id: 'cube-sweep',
      subType: 'extrusion',
      pathId: cubeRegionPath.id,
      surfaceIds: ['cube-wall-right'],
      edgeIds: [],
      trajectoryId: null,
      method: 'new',
      consumed: false,
      codeRef: {
        range: cubeRange,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(ast, cubeRange),
      },
    }
    const cubeWallRight: Artifact = {
      type: 'wall',
      id: 'cube-wall-right',
      sweepId: cubeSweep.id,
      segId: regionRightSegment.id,
      pathIds: [],
      edgeCutEdgeIds: [],
      faceCodeRef: regionRightCodeRef,
      cmdId: 'cube-wall-right-command',
    }

    world.kclManager.artifactGraph = new Map<string, Artifact>([
      [cubeSketchPath.id, cubeSketchPath],
      [originalRightSegment.id, originalRightSegment],
      [cubeRegionPath.id, cubeRegionPath],
      [regionRightSegment.id, regionRightSegment],
      [cubeSweep.id, cubeSweep],
      [cubeWallRight.id, cubeWallRight],
    ])

    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: {
        otherSelections: [],
        graphSelections: [
          {
            artifact: cubeWallRight,
            codeRef: regionRightCodeRef,
          },
        ],
      },
      engineCommandManager: createPrimitiveEngineConnectionManager({
        parentEntityId: cubeSweep.id,
        primitiveIndex: 2,
        primitiveType: 'face',
      }),
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.content).toBe('change the selected values')
    expect(userPayload?.source_ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt: expect.stringContaining('Face: `cubeRegion.tags.right`'),
        }),
      ])
    )
  })

  it('includes the single current graph selection in the Zookeeper user payload', async () => {
    const code = 'width = 5\nheight = 10\n'
    const widthRange = selectedIdentifierRange(code, 'width')
    const modelingSelections = setupModelingSelection({
      code,
      selection: {
        selectionType: 'completeSelection',
        selection: {
          otherSelections: [],
          graphSelections: [
            {
              codeRef: {
                range: widthRange,
                pathToNode: [],
              },
            },
          ],
        },
      },
    })

    expect(
      modelingSelections.graphSelections.map(({ codeRef }) => codeRef.range)
    ).toStrictEqual([widthRange])

    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: modelingSelections,
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.source_ranges).toStrictEqual([
      {
        file: 'main.kcl',
        prompt: 'This is the source range selected by the user.',
        range: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 5 },
        },
      },
    ])
  })

  it('includes every graph selection currently held by modelingMachine', async () => {
    const code = 'width = 5\nheight = 10\n'
    const widthRange = selectedIdentifierRange(code, 'width')
    const heightRange = selectedIdentifierRange(code, 'height')
    const modelingSelections = setupModelingSelection({
      code,
      selection: {
        selectionType: 'completeSelection',
        selection: {
          otherSelections: [],
          graphSelections: [
            {
              codeRef: {
                range: widthRange,
                pathToNode: [],
              },
            },
            {
              codeRef: {
                range: heightRange,
                pathToNode: [],
              },
            },
          ],
        },
      },
    })

    expect(
      modelingSelections.graphSelections.map(({ codeRef }) => codeRef.range)
    ).toStrictEqual([widthRange, heightRange])

    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: modelingSelections,
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.source_ranges).toStrictEqual([
      {
        file: 'main.kcl',
        prompt: 'This is the source range selected by the user.',
        range: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 5 },
        },
      },
      {
        file: 'main.kcl',
        prompt: 'This is the source range selected by the user.',
        range: {
          start: { line: 2, column: 0 },
          end: { line: 2, column: 6 },
        },
      },
    ])
  })

  it('includes primitive face selections as generated KCL references', async () => {
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

outerSketch = sketch(on = YZ) {
  outerCircle = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  diameter(outerCircle) == 20mm
}
outerRegion = region(segments = [outerSketch.outerCircle])
outerBody = extrude(outerRegion, length = 40mm, symmetric = true)

innerSketch = sketch(on = YZ) {
  innerCircle = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
  diameter(innerCircle) == 4mm
}
innerRegion = region(segments = [innerSketch.innerCircle])
innerBody = extrude(innerRegion, length = 40mm, symmetric = true)

cfdBoundingHollowCylinder = subtract(outerBody, tools = innerBody)
`
    world.kclManager.updateCodeEditor(code, {
      shouldWriteToDisk: false,
      shouldAddToHistory: false,
    })
    const ast = assertParse(code, world.instance)
    const cfdBoundingHollowCylinderRange = sourceRangeForSnippet(
      code,
      'cfdBoundingHollowCylinder = subtract(outerBody, tools = innerBody)'
    )
    const cfdBoundingHollowCylinder: Artifact = {
      type: 'compositeSolid',
      id: 'cfd-bounding-hollow-cylinder',
      consumed: false,
      subType: 'subtract',
      solidIds: [],
      toolIds: [],
      codeRef: {
        range: cfdBoundingHollowCylinderRange,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(
          ast,
          cfdBoundingHollowCylinderRange
        ),
      },
    }
    const artifactGraph = new Map([
      [cfdBoundingHollowCylinder.id, cfdBoundingHollowCylinder],
    ])

    const faceSelection: EnginePrimitiveSelection = {
      type: 'enginePrimitive',
      entityId: 'selected-cfd-face',
      parentEntityId: cfdBoundingHollowCylinder.id,
      primitiveIndex: 5,
      primitiveType: 'face',
    }
    const modelingSelections = setupModelingSelection({
      code,
      artifactGraph,
      selection: {
        selectionType: 'enginePrimitiveSelection',
        selection: faceSelection,
      },
    })

    expect(modelingSelections.graphSelections).toStrictEqual([])
    expect(modelingSelections.otherSelections).toStrictEqual([faceSelection])

    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: modelingSelections,
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.content).toBe('change the selected values')
    expect(userPayload?.source_ranges).toHaveLength(1)
    expect(userPayload?.source_ranges?.[0].prompt).toContain(
      'Face: `faceId(cfdBoundingHollowCylinder, index = 5)`'
    )
  })

  it('includes cube side-wall face references without changing visible prompt text', async () => {
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

profile001 = region(segments = [])
extrude001 = extrude(profile001, length = 10mm)
`
    const ast = assertParse(code, world.instance)
    const extrudeRange = sourceRangeForSnippet(
      code,
      'extrude001 = extrude(profile001, length = 10mm)'
    )
    const extrude001: Artifact = {
      type: 'sweep',
      id: 'extrude001-id',
      subType: 'extrusion',
      pathId: 'profile001-path',
      surfaceIds: [],
      edgeIds: [],
      trajectoryId: null,
      method: 'new',
      consumed: false,
      codeRef: {
        range: extrudeRange,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(ast, extrudeRange),
      },
    }
    const artifactGraph = new Map([[extrude001.id, extrude001]])

    const faceSelection: EnginePrimitiveSelection = {
      type: 'enginePrimitive',
      entityId: 'selected-cube-wall',
      parentEntityId: extrude001.id,
      primitiveIndex: 4,
      primitiveType: 'face',
    }
    const modelingSelections = setupModelingSelection({
      code,
      artifactGraph,
      selection: {
        selectionType: 'enginePrimitiveSelection',
        selection: faceSelection,
      },
    })

    expect(modelingSelections.graphSelections).toStrictEqual([])
    expect(modelingSelections.otherSelections).toStrictEqual([faceSelection])

    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: modelingSelections,
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.content).toBe('change the selected values')
    expect(userPayload?.source_ranges).toHaveLength(1)
    expect(userPayload?.source_ranges?.[0].prompt).toContain(
      'Face: `faceId(extrude001, index = 4)`'
    )
  })
})
