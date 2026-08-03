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
    projectFiles: providedProjectFiles,
  }: {
    code: string
    selections: Selections | null
    projectFiles?: FileMeta[]
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
    const projectFiles: FileMeta[] = providedProjectFiles ?? [
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
      engineCommandManager: world.engineCommandManager,
      wasmInstance: world.instance,
    })

    await waitFor(actor, (state) => state.context.awaitingResponse)

    actor.stop()

    return ws.sentPayloads.map((payload) => JSON.parse(payload))
  }

  function sourceRangeForSnippet(
    code: string,
    snippet: string,
    moduleId = 0
  ): SourceRange {
    const start = code.indexOf(snippet)
    expect(start).toBeGreaterThanOrEqual(0)
    return [start, start + snippet.length, moduleId]
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

  it('resolves imported primitive faces against the imported file AST', async () => {
    const code = `import "imported.kcl"

activeRegion = region(segments = [])
activeExtrude = extrude(activeRegion, length = 10mm)
activeShell = shell(activeExtrude, faces = [], thickness = 1mm)
`
    const importedCode = `alignmentMarker = 0

importedRegion = region(segments = [])
importedExtrude = extrude(importedRegion, length = 10mm)
importedShell = shell(importedExtrude, faces = [], thickness = 1mm)
`
    const activeAst = assertParse(code, world.instance)
    const importedShellSnippet =
      'importedShell = shell(importedExtrude, faces = [], thickness = 1mm)'
    const importedShellRange = sourceRangeForSnippet(
      importedCode,
      importedShellSnippet,
      1
    )
    const importRange = sourceRangeForSnippet(code, 'import "imported.kcl"')
    const importedShell: Artifact = {
      type: 'sweep',
      id: 'imported-shell-id',
      subType: 'extrusion',
      pathId: 'imported-region-id',
      surfaceIds: [],
      edgeIds: [],
      trajectoryId: null,
      method: 'new',
      consumed: false,
      codeRef: {
        range: importRange,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(activeAst, importRange),
      },
    }
    const importedPath: Artifact = {
      type: 'path',
      id: 'imported-path-id',
      subType: 'region',
      planeId: 'imported-plane-id',
      segIds: [],
      consumed: true,
      sweepId: importedShell.id,
      trajectorySweepId: null,
      codeRef: importedShell.codeRef,
    }
    const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
      [importedShell.id, importedShell],
      [importedPath.id, importedPath],
    ])
    const faceSelection: EnginePrimitiveSelection = {
      type: 'enginePrimitive',
      entityId: 'selected-imported-shell-face',
      parentEntityId: importedPath.id,
      primitiveIndex: 3,
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
    const previousOperations = world.kclManager.execState.operations
    world.kclManager.execState.operations = {
      map: {
        0: [
          {
            type: 'ModuleInstance',
            name: 'imported',
            moduleId: 1,
            glob: false,
            nodePath: defaultNodePath(),
            sourceRange: importRange,
          },
        ],
        1: [
          {
            type: 'StdLibCall',
            name: 'shell',
            unlabeledArg: {
              value: {
                type: 'Solid',
                value: { artifactId: importedShell.id },
              },
              sourceRange: importedShellRange,
            },
            labeledArgs: {},
            nodePath: defaultNodePath(),
            sourceRange: importedShellRange,
          },
        ],
      },
    }
    const projectFiles: FileMeta[] = [
      {
        type: 'kcl',
        relPath: 'main.kcl',
        absPath: currentFileEntry.path,
        fileContents: code,
        execStateFileNamesIndex: 0,
      },
      {
        type: 'kcl',
        relPath: 'imported.kcl',
        absPath: '/projects/zoo-project/imported.kcl',
        fileContents: importedCode,
        execStateFileNamesIndex: 1,
      },
    ]

    const sentPayloads = await sendZookeeperMessage({
      code,
      selections: modelingSelections,
      projectFiles,
    }).finally(() => {
      world.kclManager.execState.operations = previousOperations
    })
    const userPayload = sentPayloads.find((payload) => payload.type === 'user')

    expect(userPayload?.source_ranges).toHaveLength(1)
    expect(userPayload?.source_ranges?.[0].file).toBe('imported.kcl')
    expect(userPayload?.source_ranges?.[0].prompt).toContain(
      'Face: `faceId(importedShell, index = 3)`'
    )
    expect(userPayload?.source_ranges?.[0].prompt).not.toContain(
      'faceId(activeExtrude'
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
