import type * as CameraControlsModule from '@src/clientSideScene/CameraControls'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createLocalName,
  createLiteral,
  createVariableDeclaration,
} from '@src/lang/create'
import { executeAstMock } from '@src/lang/executeAstMock'
import { removeSingleConstraintInfo } from '@src/lang/modifyAst'
import { artifactToEntityRef, getNodeFromPath } from '@src/lang/queryAst'
import { getConstraintInfoKw } from '@src/lang/std/sketch'
import {
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import { assertParse, recast, type CallExpressionKw } from '@src/lang/wasm'
import type * as WasmUtilsModule from '@src/lang/wasmUtils'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { isErr } from '@src/lib/trap'
import { modelingMachine } from '@src/machines/modelingMachine'
import { legacySketchCases } from '@src/machines/modelingMachine.legacySketch.fixtures'
import { generateModelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import type { MockInstance } from 'vitest'
import {
  afterAll,
  afterEach,
  beforeAll,
  onTestFinished,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import fc from 'fast-check'
import { createActor, waitFor, type ActorRefFrom } from 'xstate'

// Camera acknowledgement/animation belongs to CameraControls' tests. Everything
// that computes edits, resolves selections, or rebuilds sketch geometry is real.
vi.mock('@src/clientSideScene/CameraControls', async (importOriginal) => ({
  ...(await importOriginal<typeof CameraControlsModule>()),
  enterSketchModeAndSyncCamera: vi.fn().mockResolvedValue(undefined),
}))

// Registry imports also request Wasm through the browser loader. Use the same
// real blob from disk so this file has no dependency on a running dev server.
vi.mock('@src/lang/wasmUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof WasmUtilsModule>()),
  initialiseWasm: async () => {
    const { loadWasm } = await import('@src/unitTestUtils')
    return loadWasm()
  },
}))

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
let sendSceneCommand: MockInstance<ConnectionManager['sendSceneCommand']>
beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
  sendSceneCommand = vi
    .spyOn(world.engineCommandManager, 'sendSceneCommand')
    .mockImplementation(() => {
      throw new Error('Legacy sketch edits must not send engine commands')
    })
})
afterEach(() => {
  expect(sendSceneCommand).not.toHaveBeenCalled()
})
afterAll(() => {
  vi.restoreAllMocks()
  world.commandBarActor.stop()
  world.settingsActor.stop()
})

const cases = Object.values(legacySketchCases)
const waitForSketch = (actor: ActorRefFrom<typeof modelingMachine>) =>
  waitFor(actor, (s) => s.matches({ Sketch: { SketchIdle: 'scene drawn' } }), {
    timeout: 5000,
  })

async function prepareSketch(code: string, searchText: string) {
  const { instance, rustContext } = world
  const ast = assertParse(code, instance)
  const execution = await executeAstMock({
    ast,
    rustContext,
    usePrevMemory: false,
  })
  expect(execution.errors).toEqual([])
  const index = code.indexOf(searchText)
  const artifact = [...execution.execState.artifactGraph.values()].find(
    (a) =>
      a.type === 'segment' &&
      a.codeRef.range[0] <= index &&
      index <= a.codeRef.range[1]
  )
  if (!artifact || !('codeRef' in artifact))
    throw new Error(`Missing segment: ${searchText}`)
  const call = getNodeFromPath<Node<CallExpressionKw>>(
    ast,
    artifact.codeRef!.pathToNode,
    instance,
    'CallExpressionKw'
  )
  if (isErr(call)) throw call
  return {
    ast,
    artifact,
    call: call.node,
    variables: execution.execState.variables,
  }
}

async function enterSketch(code: string, searchText: string) {
  const { instance, kclManager } = world
  const { ast, artifact: originalArtifact } = await prepareSketch(
    code,
    searchText
  )
  kclManager.updateCodeEditor(code)
  expect(await kclManager.executeAstMock(ast)).toBeNull()
  const artifact = [...kclManager.artifactGraph.values()].find(
    (a) =>
      a.type === 'segment' &&
      JSON.stringify(a.codeRef.pathToNode) ===
        JSON.stringify(originalArtifact.codeRef!.pathToNode)
  )
  if (!artifact || !('codeRef' in artifact))
    throw new Error('Missing reparsed segment')
  const canonicalCode = recast(kclManager.ast, instance)
  if (isErr(canonicalCode)) throw canonicalCode
  kclManager.updateCodeEditor(canonicalCode)
  const actor = createActor(modelingMachine, {
    input: generateModelingMachineDefaultContext({
      ...world,
      wasmInstance: instance,
    }),
  }).start()
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
  try {
    await waitForSketch(actor)
  } catch (error) {
    actor.stop()
    throw error
  }
  const call = getNodeFromPath<Node<CallExpressionKw>>(
    kclManager.ast,
    artifact.codeRef!.pathToNode,
    instance,
    'CallExpressionKw'
  )
  if (isErr(call)) {
    actor.stop()
    throw call
  }
  return { actor, ast: kclManager.ast, artifact, call: call.node }
}

async function expectExecutableCode() {
  const { instance, kclManager, rustContext } = world
  const result = await executeAstMock({
    ast: assertParse(kclManager.code, instance),
    rustContext,
    usePrevMemory: false,
  })
  expect(result.errors).toEqual([])
  return result.execState
}

describe('legacy sketch edits without an engine connection', () => {
  it.each(cases.flatMap((c) => c.namedConstantConstraint))(
    '$name',
    async ({ code, searchText, constraintIndex, expectedResult, filter }) => {
      const { actor, artifact, call } = await enterSketch(code, searchText)
      onTestFinished(() => {
        actor.stop()
      })
      const { instance, kclManager } = world
      const constraint = getConstraintInfoKw(
        call,
        world.kclManager.code,
        artifact.codeRef!.pathToNode,
        filter
      )[constraintIndex]
      actor.send({
        type: 'Constrain with named value',
        data: {
          currentValue: {
            valueText: constraint.value,
            pathToNode: constraint.pathToNode,
            variableName: 'test_variable',
          },
          namedValue: {
            valueText: '20',
            variableName: 'test_variable',
            insertIndex: 0,
            valueCalculated: '20',
            variableDeclarationAst: createVariableDeclaration(
              'test_variable',
              createLiteral(20, instance)
            ),
            variableIdentifierAst: createLocalName('test_variable'),
            valueAst: createLiteral(20, instance),
          },
        },
      })
      await waitForSketch(actor)
      expect(kclManager.code).toContain(expectedResult)
      expect(kclManager.code).toContain('test_variable = 20')
      await expectExecutableCode()
    }
  )

  it.each(cases.flatMap((c) => c.removeIndividualConstraintsCases))(
    '$name',
    async ({ code, searchText, constraintIndex, expectedResult, filter }) => {
      const { artifact, ast, call, variables } = await prepareSketch(
        code,
        searchText
      )
      const { instance } = world
      const constraint = getConstraintInfoKw(
        call,
        code,
        artifact.codeRef!.pathToNode,
        filter
      )[constraintIndex]
      if (!constraint.argPosition)
        throw new Error('Missing constraint argument')
      const result = removeSingleConstraintInfo(
        constraint.pathToNode,
        constraint.argPosition,
        ast,
        variables,
        removeSingleConstraint,
        transformAstSketchLines,
        instance
      )
      if (!result) throw new Error('Constraint removal failed')
      const edited = recast(result.modifiedAst, instance)
      if (isErr(edited)) throw edited
      expect(edited).toContain(expectedResult)
      const execution = await executeAstMock({
        ast: assertParse(edited, instance),
        rustContext: world.rustContext,
        usePrevMemory: false,
      })
      expect(execution.errors).toEqual([])
    }
  )

  it.each(cases.flatMap((c) => c.removeAllConstraintsCases))(
    '$name',
    async ({ code, searchText, expectedResult }) => {
      const { actor, artifact } = await enterSketch(code, searchText)
      onTestFinished(() => {
        actor.stop()
      })
      actor.send({
        type: 'Constrain remove constraints',
        data: artifact.codeRef!.pathToNode,
      })
      await waitForSketch(actor)
      expect(world.kclManager.code).toContain(expectedResult)
      await expectExecutableCode()
    }
  )

  it.each(cases.flatMap((c) => c.deleteSegment))(
    '$name',
    async ({ code, searchText, filter }) => {
      const { actor, artifact, call } = await enterSketch(code, searchText)
      onTestFinished(() => {
        actor.stop()
      })
      const constraint = getConstraintInfoKw(
        call,
        world.kclManager.code,
        artifact.codeRef!.pathToNode,
        filter
      )[0]
      actor.send({ type: 'Delete segments', data: [constraint.pathToNode] })
      // Deletion is currently a fire-and-forget action; wait for its persisted edit.
      await vi.waitFor(
        () => expect(world.kclManager.code).not.toContain(searchText),
        { timeout: 5000 }
      )
      await expectExecutableCode()
    }
  )
})

describe('removing legacy dimensions', () => {
  it('preserves the endpoint and unrelated code for relative and absolute lines', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .record({
            x: fc.integer({ min: -500, max: 500 }),
            y: fc.integer({ min: -500, max: 500 }),
            originX: fc.integer({ min: -500, max: 500 }),
            originY: fc.integer({ min: -500, max: 500 }),
            absolute: fc.boolean(),
          })
          .filter(({ x, y, originX, originY, absolute }) =>
            absolute ? x !== originX || y !== originY : x !== 0 || y !== 0
          ),
        async ({ x, y, originX, originY, absolute }) => {
          const target = `line(${absolute ? 'endAbsolute' : 'end'} = [dimensionX, dimensionY])`
          const code = `@settings(kclVersion = 1.0, defaultLengthUnit = mm)
dimensionX = ${x}
dimensionY = ${y}
untouched = 123
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [${originX}, ${originY}])
  |> ${target}
`
          const { actor, artifact } = await enterSketch(code, target)
          try {
            actor.send({
              type: 'Constrain remove constraints',
              data: artifact.codeRef!.pathToNode,
            })
            await waitForSketch(actor)
            expect(world.kclManager.code).not.toContain(target)
            expect(world.kclManager.code).toContain(`dimensionX = ${x}`)
            expect(world.kclManager.code).toContain(`dimensionY = ${y}`)
            expect(world.kclManager.code).toContain('untouched = 123')
            const state = await expectExecutableCode()
            const profile = state.variables.profile001
            if (profile?.type !== 'Sketch')
              throw new Error('Missing edited sketch')
            const segment = profile.value.paths[0]
            expect(segment.from).toEqual([originX, originY])
            expect(segment.to).toEqual(
              absolute ? [x, y] : [originX + x, originY + y]
            )
          } finally {
            actor.stop()
          }
        }
      ),
      { numRuns: 50 }
    )
  }, 30_000)
})
