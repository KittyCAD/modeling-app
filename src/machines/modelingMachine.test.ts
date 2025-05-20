import {
  modelingMachine,
  modelingMachineDefaultContext,
} from '@src/machines/modelingMachine'
import { createActor } from 'xstate'
import { vi } from 'vitest'
import { assertParse } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import {
  engineCommandManager,
  kclManager,
  sceneEntitiesManager,
} from '@src/lib/singletons'
import { VITE_KC_DEV_TOKEN } from '@src/env'

// Store original method to restore in afterAll
const originalSetupNoPointsListener = sceneEntitiesManager.setupNoPointsListener
const originalCreateSketchAxis = sceneEntitiesManager.createSketchAxis

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

  // Replace the method directly rather than using spyOn
  sceneEntitiesManager.setupNoPointsListener = function () {
    console.log('Mock setupNoPointsListener called')
    return { destroy: vi.fn() }
  }
  sceneEntitiesManager.createSketchAxis = function () {
    console.log('Mock createSketchAxis called')
    return { destroy: vi.fn() }
  }
}, 30_000)

afterAll(() => {
  // Restore the original method
  sceneEntitiesManager.setupNoPointsListener = originalSetupNoPointsListener
  sceneEntitiesManager.createSketchAxis = originalCreateSketchAxis

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
    it.only('should transition to sketch state when entering sketch mode', async () => {
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
        Sketch: { 'Line tool': 'Init' },
      })
    }, 10_000)
  })
})
