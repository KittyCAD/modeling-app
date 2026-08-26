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
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import {
  type Conversation,
  type ZookeeperManagerContext,
  type ZookeeperManagerEvents,
  ZookeeperManagerStates,
  ZookeeperManagerTransitions,
  zookeeperManagerMachine,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
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

type TestWebSocket = Pick<ZookeeperManagerContext, 'ws'>['ws'] & TestSocket
type SetupActorInput = {
  event: Extract<ZookeeperManagerEvents, { type: ZookeeperManagerStates.Setup }>
  context: ZookeeperManagerContext
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
  }: {
    code: string
    selections: Selections | null
  }) {
    const ws: TestWebSocket = new TestSocket() as TestWebSocket
    const conversation: Conversation = { exchanges: [] }
    const machine = zookeeperManagerMachine.provide({
      actors: {
        [ZookeeperManagerStates.Setup]: fromPromise<
          Partial<ZookeeperManagerContext>,
          SetupActorInput
        >(async () => ({
          ws,
          conversation,
          conversationId: 'conversation-id',
        })),
      },
    })
    const actor = createActor(machine, { input: { apiToken: 'token' } }).start()
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
      type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      refParentSend: () => {},
    })

    await waitFor(actor, (state) =>
      state.matches(ZookeeperManagerStates.WaitForContinueCheck)
    )

    actor.send({
      type: ZookeeperManagerStates.ContinueCheck,
      projectName: project.name,
      projectFiles,
      activeFile: 'main.kcl',
    })

    await waitFor(actor, (state) => state.matches(ZookeeperManagerStates.Ready))

    actor.send({
      type: ZookeeperManagerTransitions.MessageSend,
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
      engineCommandManager: world.engineCommandManager,
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
