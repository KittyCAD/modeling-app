import type {
  BatchResponse,
  ModelingCmd,
  OkModelingCmdResponse,
  WebSocketResponse,
} from '@kittycad/lib'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type * as WasmUtilsModule from '@src/lang/wasmUtils'
import {
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import { artifactToEntityRef, getNodeFromPath } from '@src/lang/queryAst'
import { getConstraintInfoKw } from '@src/lang/std/sketch'
import {
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import {
  assertParse,
  recast,
  type CallExpressionKw,
  type Program,
  type ExecState,
} from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { modelingMachine } from '@src/machines/modelingMachine'
import { legacySketchCases } from '@src/machines/modelingMachine.legacySketch.fixtures'
import {
  beforeAll,
  afterAll,
  afterEach,
  onTestFinished,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createActor, waitFor } from 'xstate'

import {
  buildTheWorldAndNoEngineConnection,
  buildTheWorldAndConnectToEngine,
} from '@src/unitTestUtils'
import { generateModelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import { removeSingleConstraintInfo } from '@src/lang/modifyAst'
import {
  findSketchEngineResult,
  recordSketchEngineResult,
  replaySketchEngineResult,
  sketchEngineFixtureKey,
  type RecordedSketchEngineResult,
} from '@src/machines/modelingMachine.legacySketch.runtimeFixtures'
import { recordedSketchEngineResults } from '@src/machines/modelingMachine.legacySketch.engineResults'
import { writeFile } from 'fs/promises'

// Registry imports can request the browser Wasm loader. Load the same real blob
// from disk; the fixture-backed app never executes KCL.
vi.mock('@src/lang/wasmUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof WasmUtilsModule>()),
  initialiseWasm: async () => {
    const [{ loadAndInitialiseWasmInstance }, path] = await Promise.all([
      import('@src/lang/wasmUtilsNode'),
      import('path'),
    ])
    return loadAndInitialiseWasmInstance(
      path.join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    )
  },
}))

let instance: ModuleType
const recording = process.env.ZDS_RECORD_SKETCH_ENGINE_RESULTS === '1'
let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
let engineWorld:
  | Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
  | undefined
const records = new Map(
  recording ? [] : recordedSketchEngineResults.map((f) => [f.key, f])
)
const pending = new Map<string, Promise<RecordedSketchEngineResult>>()
let runtimeFailures: unknown[] = []
let defaultPlanes: ExecState['defaultPlanes'] = null
type Gate = {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}
const createGate = (): Gate => {
  const pending = Promise.withResolvers<undefined>()
  return {
    promise: pending.promise,
    resolve: () => pending.resolve(undefined),
    reject: (error) => pending.reject(error),
  }
}
let cameraGate: { requested: Gate; reply: Gate } | undefined
let resultGate:
  | { matches: (ast: Node<Program>) => boolean; requested: Gate; reply: Gate }
  | undefined

function holdNextRuntimeResult(matches: (ast: Node<Program>) => boolean) {
  const gate = {
    matches,
    requested: createGate(),
    reply: createGate(),
  }
  resultGate = gate
  return gate
}

function acknowledgeSceneCommand(command: ModelingCmd): OkModelingCmdResponse {
  if (
    command.type === 'enable_sketch_mode' ||
    command.type === 'object_visible' ||
    command.type === 'set_selection_filter' ||
    command.type === 'select_clear' ||
    command.type === 'select_entity'
  )
    return { type: command.type, data: {} }
  throw new Error(`Unexpected fixture transport command: ${command.type}`)
}

async function sceneReply(
  command: Parameters<typeof world.engineCommandManager.sendSceneCommand>[0]
): Promise<WebSocketResponse | null> {
  if (command.type === 'modeling_cmd_batch_req') {
    const responses: Record<string, BatchResponse> = {}
    for (const request of command.requests)
      responses[request.cmd_id] = {
        response: acknowledgeSceneCommand(request.cmd),
      }
    return {
      request_id: command.batch_id,
      success: true,
      resp: { type: 'modeling_batch', data: { responses } },
    }
  }
  if (command.type !== 'modeling_cmd_req')
    throw new Error(`Unexpected fixture request: ${command.type}`)
  if (command.cmd.type === 'enable_sketch_mode' && cameraGate) {
    const gate = cameraGate
    cameraGate = undefined
    gate.requested.resolve()
    await gate.reply.promise
  }
  return {
    request_id: command.cmd_id,
    success: true,
    resp: {
      type: 'modeling',
      data: { modeling_response: acknowledgeSceneCommand(command.cmd) },
    },
  }
}

const forbiddenMockExecution = vi
  .fn<InstanceType<ModuleType['Context']>['executeMock']>()
  .mockRejectedValue(new Error('KCL mock execution is forbidden'))
const forbiddenEngineExecution = vi
  .fn<InstanceType<ModuleType['Context']>['execute']>()
  .mockRejectedValue(new Error('Fixture tests must not execute KCL'))

async function runtimeResult(ast: Node<Program>) {
  if (resultGate?.matches(ast)) {
    const gate = resultGate
    resultGate = undefined
    gate.requested.resolve()
    await gate.reply.promise
  }
  try {
    const hasPlane = ast.body.some(
      (item) =>
        item.type === 'VariableDeclaration' &&
        item.declaration.id.name === 'sketch001'
    )
    const context = hasPlane ? undefined : world.kclManager.ast
    const key = sketchEngineFixtureKey(ast, context)
    let fixture = records.get(key)
    if (!fixture && recording) {
      let request = pending.get(key)
      if (!request) {
        request = (async () => {
          if (!engineWorld) throw new Error('Missing recording engine')
          // Sketch redraw requests contain only the sketch statement and rely on
          // the current program's bindings. Record their real result by executing
          // that complete program, never by running the mock interpreter.
          const executable = hasPlane ? ast : world.kclManager.ast
          if (
            !hasPlane &&
            !ast.body.every((item) =>
              executable.body.some(
                (candidate) =>
                  JSON.stringify(candidate) === JSON.stringify(item)
              )
            )
          )
            throw new Error(
              'Recording request does not belong to the current program'
            )
          const state = await engineWorld.rustContext.execute(executable, {})
          const fixture = recordSketchEngineResult(
            ast,
            state,
            instance,
            context
          )
          if (isErr(fixture)) throw fixture
          records.set(key, fixture)
          await writeFile(
            '/tmp/zds-sketch-engine-results.json',
            JSON.stringify([...records.values()])
          )
          return fixture
        })()
        pending.set(key, request)
      }
      fixture = await request
    }
    const recorded = fixture ?? findSketchEngineResult(ast, context)
    if (isErr(recorded)) throw recorded
    const result = replaySketchEngineResult(recorded)
    defaultPlanes = result.defaultPlanes
    return result
  } catch (error) {
    runtimeFailures.push(error)
    throw error
  }
}

beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
  instance = world.instance
  vi.spyOn(instance.Context.prototype, 'executeMock').mockImplementation(
    forbiddenMockExecution
  )
  if (!recording)
    vi.spyOn(instance.Context.prototype, 'execute').mockImplementation(
      forbiddenEngineExecution
    )
  if (recording)
    engineWorld = await buildTheWorldAndConnectToEngine({
      webrtc: false,
      geometryOnly: true,
    })
  vi.spyOn(world.rustContext, 'defaultPlanes', 'get').mockImplementation(
    () => defaultPlanes
  )
  vi.spyOn(world.rustContext, 'execute').mockImplementation(runtimeResult)
  vi.spyOn(world.rustContext, 'executeMock').mockImplementation(runtimeResult)
  vi.spyOn(
    world.rustContext,
    'waitForAllEngineModelingCommands'
  ).mockResolvedValue(undefined)
  vi.spyOn(world.engineCommandManager, 'start').mockRejectedValue(
    new Error('Fixture tests must not connect')
  )
  Object.defineProperty(world.engineCommandManager, 'geometryOnly', {
    configurable: true,
    value: true,
  })
  world.engineCommandManager.started = true
  world.sceneInfra.camControls.localCameraMode = true
  world.sceneInfra.camControls.camera.position.set(100, 100, 100)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.spyOn(world.engineCommandManager, 'sendSceneCommand').mockImplementation(
    sceneReply
  )
}, 60_000)

afterEach(() => {
  cameraGate = undefined
  resultGate = undefined
  const failures = runtimeFailures
  runtimeFailures = []
  expect(failures).toEqual([])
  try {
    expect(forbiddenMockExecution).not.toHaveBeenCalled()
    expect(forbiddenEngineExecution).not.toHaveBeenCalled()
  } finally {
    forbiddenMockExecution.mockClear()
    forbiddenEngineExecution.mockClear()
  }
})
afterAll(() => {
  engineWorld?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
  world.commandBarActor.stop()
  world.settingsActor.stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function startSketch(code: string, searchText: string) {
  const { kclManager } = world
  world.sceneInfra.camControls.enableRotate = true
  kclManager.updateCodeEditor(code)
  await kclManager.executeAst({ ast: assertParse(code, instance) })
  expect(kclManager.errors).toEqual([])
  const index = code.indexOf(searchText)
  const artifact = [...kclManager.artifactGraph.values()].find(
    (a) =>
      a.type === 'segment' &&
      a.codeRef.range[0] <= index &&
      index <= a.codeRef.range[1]
  )
  if (!artifact || !('codeRef' in artifact))
    throw new Error(`Missing segment: ${searchText}`)
  const actor = createActor(modelingMachine, {
    input: generateModelingMachineDefaultContext({
      ...world,
      wasmInstance: instance,
    }),
  }).start()
  world.sceneInfra.setSend((event) => actor.send(event))
  world.engineCommandManager.modelingSend = (event) => actor.send(event)
  onTestFinished(() => {
    world.sceneInfra.setSend(() => {})
    world.engineCommandManager.modelingSend = () => {}
    actor.stop()
  })
  actor.send({
    type: 'Set selection',
    data: {
      selectionType: 'mirrorCodeMirrorSelections',
      selection: {
        graphSelections: [
          {
            entityRef: artifactToEntityRef(artifact.type, artifact.id),
            codeRef: artifact.codeRef,
          },
        ],
        otherSelections: [],
      },
    },
  })
  actor.send({ type: 'Enter sketch' })
  const call = getNodeFromPath<Node<CallExpressionKw>>(
    kclManager.ast,
    artifact.codeRef!.pathToNode,
    instance,
    'CallExpressionKw'
  )
  if (isErr(call)) throw call
  return { actor, artifact, call: call.node }
}

async function enterSketch(code: string, searchText: string) {
  const flow = await startSketch(code, searchText)
  await waitForSketch(flow.actor)
  expect(world.sceneInfra.camControls.enableRotate).toBe(false)
  return flow
}

const waitForSketch = (
  actor: ReturnType<typeof createActor<typeof modelingMachine>>
) =>
  waitFor(actor, (s) => s.matches({ Sketch: { SketchIdle: 'scene drawn' } }), {
    timeout: 15_000,
  })
function namedDimensionEvent(
  constraint: ReturnType<typeof getConstraintInfoKw>[number]
) {
  return {
    type: 'Constrain with named value',
    data: {
      currentValue: {
        valueText: constraint.value,
        pathToNode: constraint.pathToNode,
        variableName: 'test_variable',
      },
      namedValue: {
        valueText: '20',
        valueCalculated: '20',
        variableName: 'test_variable',
        insertIndex: 0,
        variableDeclarationAst: createVariableDeclaration(
          'test_variable',
          createLiteral(20, instance)
        ),
        variableIdentifierAst: createLocalName('test_variable'),
        valueAst: createLiteral(20, instance),
      },
    },
  } as const
}

const cases = Object.values(legacySketchCases)
describe('legacy sketch flows with recorded engine results', () => {
  it.each(cases.flatMap((c) => c.namedConstantConstraint))(
    '$name',
    async ({ code, searchText, constraintIndex, expectedResult, filter }) => {
      const { actor, artifact, call } = await enterSketch(code, searchText)
      const constraint = getConstraintInfoKw(
        call,
        world.kclManager.code,
        artifact.codeRef!.pathToNode,
        filter
      )[constraintIndex]
      actor.send(namedDimensionEvent(constraint))
      await waitForSketch(actor)
      expect(world.kclManager.code).toContain(expectedResult)
      expect(world.kclManager.code).toContain('test_variable = 20')
    },
    30_000
  )

  it.each(cases.flatMap((c) => c.removeIndividualConstraintsCases))(
    '$name',
    async ({ code, searchText, constraintIndex, expectedResult, filter }) => {
      const { artifact, call } = await enterSketch(code, searchText)
      const constraint = getConstraintInfoKw(
        call,
        world.kclManager.code,
        artifact.codeRef!.pathToNode,
        filter
      )[constraintIndex]
      if (!constraint.argPosition) throw new Error('Missing argument')
      const result = removeSingleConstraintInfo(
        constraint.pathToNode,
        constraint.argPosition,
        world.kclManager.ast,
        world.kclManager.variables,
        removeSingleConstraint,
        transformAstSketchLines,
        instance
      )
      if (!result) throw new Error('Constraint removal failed')
      expect(recast(result.modifiedAst, instance)).toContain(expectedResult)
    },
    30_000
  )

  it.each(cases.flatMap((c) => c.removeAllConstraintsCases))(
    '$name',
    async ({ code, searchText, expectedResult }) => {
      const { actor, artifact } = await enterSketch(code, searchText)
      actor.send({
        type: 'Constrain remove constraints',
        data: artifact.codeRef!.pathToNode,
      })
      await waitForSketch(actor)
      expect(world.kclManager.code).toContain(expectedResult)
    },
    30_000
  )

  it.each(cases.flatMap((c) => c.deleteSegment))(
    '$name',
    async ({ code, searchText, filter }) => {
      const { actor, artifact, call } = await enterSketch(code, searchText)
      const constraint = getConstraintInfoKw(
        call,
        world.kclManager.code,
        artifact.codeRef!.pathToNode,
        filter
      )[0]
      actor.send({ type: 'Delete segments', data: [constraint.pathToNode] })
      await vi.waitFor(
        () => expect(world.kclManager.code).not.toContain(searchText),
        { timeout: 15_000 }
      )
    },
    30_000
  )
})

describe('sketch readiness with controlled engine responses', () => {
  const example = legacySketchCases.line.namedConstantConstraint[0]

  it('waits for the sketch-mode acknowledgement before drawing the sketch', async () => {
    const gate = {
      requested: createGate(),
      reply: createGate(),
    }
    cameraGate = gate
    const { actor } = await startSketch(example.code, example.searchText)
    await gate.requested.promise
    expect(actor.getSnapshot().matches('animating to existing sketch')).toBe(
      true
    )
    gate.reply.resolve()
    await waitForSketch(actor)
    expect(world.sceneInfra.camControls.enableRotate).toBe(false)
  })

  it('does not report a ready sketch while its geometry result is pending', async () => {
    const gate = holdNextRuntimeResult((ast) => ast.body.length === 1)
    const { actor } = await startSketch(example.code, example.searchText)
    await gate.requested.promise
    expect(
      actor.getSnapshot().matches({ Sketch: { SketchIdle: 'set up segments' } })
    ).toBe(true)
    gate.reply.resolve()
    await waitForSketch(actor)
    expect(world.sceneInfra.camControls.enableRotate).toBe(false)
  })

  it('returns to idle without editing the program when sketch mode is rejected', async () => {
    const gate = {
      requested: createGate(),
      reply: createGate(),
    }
    cameraGate = gate
    const { actor } = await startSketch(example.code, example.searchText)
    await gate.requested.promise
    gate.reply.reject(new Error('Sketch mode unavailable'))
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
    expect(world.kclManager.code).toBe(example.code)
  })

  it('persists the named dimension only after its rebuilt sketch is available', async () => {
    const { actor, artifact, call } = await enterSketch(
      example.code,
      example.searchText
    )
    const previousCode = world.kclManager.code
    const constraint = getConstraintInfoKw(
      call,
      world.kclManager.code,
      artifact.codeRef!.pathToNode
    )[0]
    const gate = holdNextRuntimeResult((ast) =>
      ast.body.some(
        (item) =>
          item.type === 'VariableDeclaration' &&
          item.declaration.id.name === 'test_variable'
      )
    )
    actor.send(namedDimensionEvent(constraint))
    await gate.requested.promise
    expect(
      actor.getSnapshot().matches({ Sketch: 'Converting to named value' })
    ).toBe(true)
    expect(world.kclManager.code).toBe(previousCode)
    gate.reply.resolve()
    await waitForSketch(actor)
    expect(world.kclManager.code).toContain(example.expectedResult)
    expect(world.kclManager.code).toContain('test_variable = 20')
  })
})
