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
import { assertParse, recast, type CallExpressionKw } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { modelingMachine } from '@src/machines/modelingMachine'
import { legacySketchCases } from '@src/machines/modelingMachine.legacySketch.fixtures'
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createActor, waitFor } from 'xstate'

import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { generateModelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import { removeSingleConstraintInfo } from '@src/lang/modifyAst'
import { engineSocket } from '@src/machines/modelingMachine.engineSocket'
import type { EngineRequest } from '@src/machines/modelingMachine.engineCassette'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import path from 'node:path'

// Registry imports can request the browser Wasm loader. Load the same real blob
// from disk; both recording and replay execute the normal KCL interpreter.
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
const recording = process.env.ZDS_RECORD_ENGINE_CASSETTES === '1'
const socket = engineSocket(recording)
let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
let cleanup: (() => void) | undefined
let releaseResponse: (() => void) | undefined
let realExecution: ReturnType<typeof vi.spyOn>
let cassettePath: string
let startupFrames: string | undefined
const fileFor = (name: string) => {
  const id =
    name.match(/\b(?:name|remove-one|remove-all|delete)-\d+\b/)?.[0] ??
    name.replace(/[^a-z0-9]+/gi, '-')
  return path.join(
    process.cwd(),
    'src/machines/__cassettes__/legacy-sketch',
    `${id}.json`
  )
}
const forbiddenMockExecution = vi
  .fn<InstanceType<ModuleType['Context']>['executeMock']>()
  .mockRejectedValue(new Error('KCL mock execution is forbidden'))

beforeAll(async () => {
  socket.listen()
  await socket.begin(fileFor('startup'))
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
  world.settingsActor.start()
  world.kclManager.sceneInfra.camControls.localCameraMode = true
  world.kclManager.sceneInfra.camControls.camera.position.set(100, 100, 100)
  instance = world.instance
  realExecution = vi.spyOn(instance.Context.prototype, 'execute')
  vi.spyOn(instance.Context.prototype, 'executeMock').mockImplementation(
    forbiddenMockExecution
  )
  // Legacy redraws request a truncated statement using the old JS facade.
  // Execute its complete program normally so preceding bindings remain available.
  vi.spyOn(world.rustContext, 'executeMock').mockImplementation(
    async (ast, settings, filePath) => {
      const complete = ast.body.some(
        (item) =>
          item.type === 'VariableDeclaration' &&
          item.declaration.id.name === 'sketch001'
      )
        ? ast
        : world.kclManager.ast
      if (
        !ast.body.every((item) =>
          complete.body.some(
            (candidate) => JSON.stringify(candidate) === JSON.stringify(item)
          )
        )
      )
        throw new Error('Redraw does not belong to the current program')
      return world.rustContext.execute(complete, settings, filePath)
    }
  )
  await world.rustContext.execute(
    assertParse('warmup = 1', instance),
    jsAppSettings(world.settingsActor)
  )
  startupFrames = await socket.finish()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
}, 60_000)

beforeEach(async ({ task, expect }) => {
  if (recording && startupFrames) {
    await expect(startupFrames).toMatchFileSnapshot(fileFor('startup'))
    startupFrames = undefined
  }
  realExecution.mockClear()
  cassettePath = fileFor(task.name)
  await socket.begin(cassettePath)
  await world.rustContext.clearSceneAndBustCache(
    jsAppSettings(world.settingsActor)
  )
})
afterEach(async ({ task }) => {
  releaseResponse?.()
  releaseResponse = undefined
  cleanup?.()
  cleanup = undefined
  const frames = await socket.finish()
  if (recording && task.result?.state !== 'fail')
    await expect(frames).toMatchFileSnapshot(cassettePath)
  expect(realExecution).toHaveBeenCalled()
  expect(forbiddenMockExecution).not.toHaveBeenCalled()
  forbiddenMockExecution.mockClear()
})
afterAll(() => {
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
  world?.commandBarActor.stop()
  world?.settingsActor.stop()
  socket.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function holdResponse(matches: (request: EngineRequest) => boolean) {
  const requested = Promise.withResolvers<undefined>()
  const reply = Promise.withResolvers<undefined>()
  let reject = false
  releaseResponse = () => reply.resolve(undefined)
  socket.intercept(async (request, response) => {
    if (!matches(request)) return response
    socket.intercept(undefined)
    requested.resolve(undefined)
    await reply.promise
    return reject
      ? {
          success: false,
          request_id: response.request_id,
          errors: [
            {
              error_code: 'internal_engine',
              message: 'Sketch mode unavailable',
            },
          ],
        }
      : response
  })
  return {
    requested: requested.promise,
    release: () => reply.resolve(undefined),
    reject: () => {
      reject = true
      reply.resolve(undefined)
    },
  }
}
const cameraCommand = (request: EngineRequest) =>
  request.type === 'modeling_cmd_req' &&
  request.cmd.type === 'enable_sketch_mode'
const geometryCommand = (request: EngineRequest) =>
  request.type === 'modeling_cmd_req' && request.cmd.type === 'begin_execution'

async function startSketch(code: string, searchText: string) {
  const { kclManager } = world
  world.kclManager.sceneInfra.camControls.enableRotate = true
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
  world.kclManager.sceneInfra.setSend((event) => actor.send(event))
  world.engineCommandManager.modelingSend = (event) => actor.send(event)
  cleanup = () => {
    world.kclManager.sceneInfra.setSend(() => {})
    world.engineCommandManager.modelingSend = () => {}
    actor.stop()
  }
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
  expect(world.kclManager.sceneInfra.camControls.enableRotate).toBe(false)
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
const numbered = <T extends { name: string }>(items: T[], operation: string) =>
  items.map((item, index) => ({
    ...item,
    name: `${operation}-${index}: ${item.name}`,
  }))
describe('legacy sketch flows with real KCL and recorded WebSocket responses', () => {
  it.each(
    numbered(
      cases.flatMap((c) => c.namedConstantConstraint),
      'name'
    )
  )(
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

  it.each(
    numbered(
      cases.flatMap((c) => c.removeIndividualConstraintsCases),
      'remove-one'
    )
  )(
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

  it.each(
    numbered(
      cases.flatMap((c) => c.removeAllConstraintsCases),
      'remove-all'
    )
  )(
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

  it.each(
    numbered(
      cases.flatMap((c) => c.deleteSegment),
      'delete'
    )
  )(
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

describe(
  'sketch readiness with controlled engine responses',
  { timeout: 30_000 },
  () => {
    const example = legacySketchCases.line.namedConstantConstraint[0]

    it('waits for the sketch-mode acknowledgement before drawing the sketch', async () => {
      const gate = holdResponse(cameraCommand)
      const { actor } = await startSketch(example.code, example.searchText)
      await gate.requested
      expect(actor.getSnapshot().matches('animating to existing sketch')).toBe(
        true
      )
      gate.release()
      await waitForSketch(actor)
      expect(world.kclManager.sceneInfra.camControls.enableRotate).toBe(false)
    })

    it('does not report a ready sketch while its geometry result is pending', async () => {
      // Arm the geometry gate only after the camera acknowledgement, so the
      // initial evaluation completes and the redraw's real interpreter is held.
      const camera = holdResponse(cameraCommand)
      const { actor } = await startSketch(example.code, example.searchText)
      await camera.requested
      const gate = holdResponse(geometryCommand)
      camera.release()
      await gate.requested
      expect(
        actor
          .getSnapshot()
          .matches({ Sketch: { SketchIdle: 'set up segments' } })
      ).toBe(true)
      gate.release()
      await waitForSketch(actor)
      expect(world.kclManager.sceneInfra.camControls.enableRotate).toBe(false)
    })

    it('returns to idle without editing the program when sketch mode is rejected', async () => {
      const gate = holdResponse(cameraCommand)
      const { actor } = await startSketch(example.code, example.searchText)
      await gate.requested
      gate.reject()
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
      const gate = holdResponse(geometryCommand)
      actor.send(namedDimensionEvent(constraint))
      await gate.requested
      expect(
        actor.getSnapshot().matches({ Sketch: 'Converting to named value' })
      ).toBe(true)
      expect(world.kclManager.code).toBe(previousCode)
      gate.release()
      await waitForSketch(actor)
      expect(world.kclManager.code).toContain(example.expectedResult)
      expect(world.kclManager.code).toContain('test_variable = 20')
    })
  }
)
