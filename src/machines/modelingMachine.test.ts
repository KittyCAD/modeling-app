import {
  modelingMachine,
  modelingMachineDefaultContext,
} from '@src/machines/modelingMachine'
import { createActor } from 'xstate'
import { vi } from 'vitest'
import { assertParse, type CallExpressionKw } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import {
  codeManager,
  engineCommandManager,
  kclManager,
} from '@src/lib/singletons'
import { VITE_KC_DEV_TOKEN } from '@src/env'
import { line } from '@src/lang/std/sketch'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { err } from '@src/lib/trap'
import {
  createIdentifier,
  createLiteral,
  createVariableDeclaration,
} from '@src/lang/create'

// Store original method to restore in afterAll

beforeAll(async () => {
  await initPromise

  // THESE TEST WILL FAIL without VITE_KC_DEV_TOKEN set in .env.development.local
  await new Promise((resolve) => {
    engineCommandManager.start({
      token: VITE_KC_DEV_TOKEN,
      width: 256,
      height: 256,
      setMediaStream: () => {},
      setIsStreamReady: () => {},
      callbackOnEngineLiteConnect: () => {
        resolve(true)
      },
    })
  })
}, 30_000)

afterAll(() => {
  // Restore the original method

  engineCommandManager.tearDown()
})

// Define mock implementations that will be referenced in vi.mock calls
vi.mock('@src/components/SetHorVertDistanceModal', () => ({
  createInfoModal: vi.fn(() => ({
    open: vi.fn().mockResolvedValue({
      value: '10',
      segName: 'test',
      valueNode: {},
      newVariableInsertIndex: 0,
      sign: 1,
    }),
  })),
  GetInfoModal: vi.fn(),
}))

vi.mock('@src/components/SetAngleLengthModal', () => ({
  createSetAngleLengthModal: vi.fn(() => ({
    open: vi.fn().mockResolvedValue({
      value: '45',
      segName: 'test',
      valueNode: {},
      newVariableInsertIndex: 0,
      sign: 1,
    }),
  })),
  SetAngleLengthModal: vi.fn(),
}))

// Add this function before the test cases
// Utility function to wait for a condition to be met
const waitForCondition = async (
  condition: () => boolean,
  timeout = 5000,
  interval = 100
) => {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      if (condition()) {
        return true
      }
    } catch {
      // Ignore errors, keep polling
    }

    // Wait for the next interval
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  // Last attempt before failing
  return condition()
}

describe('modelingMachine - XState', () => {
  describe('when initialized', () => {
    it('should start in the idle state', () => {
      const actor = createActor(modelingMachine, {
        input: modelingMachineDefaultContext,
      }).start()
      const state = actor.getSnapshot().value

      // The machine should start in the idle state
      expect(state).toEqual({ idle: 'hidePlanes' })
    })
  })

  describe('when in sketch mode', () => {
    it('should transition to sketch state when entering sketch mode', async () => {
      const code = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [2263.04, -2721.2])
  |> line(end = [16.27, 73.81])
  |> line(end = [75.72, 18.41])
`

      const ast = assertParse(code)

      await kclManager.executeAst({ ast })

      expect(kclManager.errors).toEqual([])

      const indexOfInterest = code.indexOf('[16.27, 73.81]')

      // segment artifact with that source range
      const artifact = [...kclManager.artifactGraph].find(
        ([_, artifact]) =>
          artifact?.type === 'segment' &&
          artifact.codeRef.range[0] <= indexOfInterest &&
          indexOfInterest <= artifact.codeRef.range[1]
      )?.[1]
      if (!artifact || !('codeRef' in artifact)) {
        throw new Error('Artifact not found or invalid artifact structure')
      }

      const actor = createActor(modelingMachine, {
        input: modelingMachineDefaultContext,
      }).start()

      // Send event to transition to sketch mode
      actor.send({
        type: 'Set selection',
        data: {
          selectionType: 'mirrorCodeMirrorSelections',
          selection: {
            graphSelections: [
              {
                artifact: artifact,
                codeRef: artifact.codeRef,
              },
            ],
            otherSelections: [],
          },
        },
      })
      actor.send({ type: 'Enter sketch' })

      // Check that we're in the sketch state
      let state = actor.getSnapshot()
      expect(state.value).toBe('animating to existing sketch')

      // wait for it to transition
      await waitForCondition(() => {
        const snapshot = actor.getSnapshot()
        return snapshot.value !== 'animating to existing sketch'
      }, 5000)

      // After the condition is met, do the actual assertion
      expect(actor.getSnapshot().value).toEqual({
        Sketch: { SketchIdle: 'scene drawn' },
      })

      const getConstraintInfo = line.getConstraintInfo
      const callExp = getNodeFromPath<Node<CallExpressionKw>>(
        kclManager.ast,
        artifact.codeRef.pathToNode,
        'CallExpressionKw'
      )
      if (err(callExp)) {
        throw new Error('Failed to get CallExpressionKw node')
      }
      const constraintInfo = getConstraintInfo(
        callExp.node,
        codeManager.code,
        artifact.codeRef.pathToNode
      )
      const first = constraintInfo[0]

      // Now that we're in sketchIdle state, test the "Constrain with named value" event
      actor.send({
        type: 'Constrain with named value',
        data: {
          currentValue: {
            valueText: first.value,
            pathToNode: first.pathToNode,
            variableName: 'test_variable',
          },
          // Use type assertion to mock the complex type
          namedValue: {
            valueText: '20',
            variableName: 'test_variable',
            insertIndex: 0,
            valueCalculated: '20',
            variableDeclarationAst: createVariableDeclaration(
              'test_variable',
              createLiteral('20')
            ),
            variableIdentifierAst: createIdentifier('test_variable') as any,
            valueAst: createLiteral('20'),
          },
        },
      })

      // Wait for the state to change in response to the constraint
      await waitForCondition(() => {
        const snapshot = actor.getSnapshot()
        // Check if we've transitioned to a different state
        return (
          JSON.stringify(snapshot.value) !==
          JSON.stringify({
            Sketch: { SketchIdle: 'set up segments' },
          })
        )
      }, 5000)

      await waitForCondition(() => {
        const snapshot = actor.getSnapshot()
        // Check if we've transitioned to a different state
        return (
          JSON.stringify(snapshot.value) !==
          JSON.stringify({ Sketch: 'Converting to named value' })
        )
      }, 5000)
      expect(codeManager.code).toContain('line(end = [test_variable,')
    }, 10_000)
  })
})
