import type { ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { assertParse } from '@src/lang/wasm'
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
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
    selections,
  }: {
    code: string
    selections: Selections
  }): Selections {
    world.kclManager.updateCodeEditor(code, {
      shouldWriteToDisk: false,
      shouldAddToHistory: false,
    })
    world.kclManager.ast = assertParse(code, world.instance)
    world.kclManager.artifactGraph = new Map() as ArtifactGraph

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
      data: {
        selectionType: 'completeSelection',
        selection: selections,
      },
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
    selections: Selections
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
    })

    await waitFor(actor, (state) => state.context.awaitingResponse)

    actor.stop()

    return ws.sentPayloads.map((payload) => JSON.parse(payload))
  }

  function selectedIdentifierRange(
    code: string,
    identifier: string
  ): SourceRange {
    const start = code.indexOf(identifier)
    expect(start).toBeGreaterThanOrEqual(0)
    return [start, start + identifier.length, 0]
  }

  it('includes the single current graph selection in the Zookeeper user payload', async () => {
    const code = 'width = 5\nheight = 10\n'
    const widthRange = selectedIdentifierRange(code, 'width')
    const modelingSelections = setupModelingSelection({
      code,
      selections: {
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
      selections: {
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
})
