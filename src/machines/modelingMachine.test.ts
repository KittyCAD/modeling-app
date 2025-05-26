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
import { getConstraintInfoKw } from '@src/lang/std/sketch'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { err } from '@src/lib/trap'
import {
  createIdentifier,
  createLiteral,
  createVariableDeclaration,
} from '@src/lang/create'
import { ARG_END_ABSOLUTE, ARG_INTERIOR_ABSOLUTE } from '@src/lang/constants'

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
    // Test cases with different variations
    const makeStraightSegmentSnippet = (line: string) => ({
      code: `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [2263.04, -2721.2])
  |> line(end = [78, 19])
  |> ${line}
  |> line(end = [75.72, 18.41])`,
      searchText: line,
    })
    const makeCircSnippet = (line: string) => ({
      code: `sketch001 = startSketchOn(YZ)
profile001 = ${line}
`,
      searchText: line,
    })
    const threePointCirceCode = `circleThreePoint(
  sketch001,
  p1 = [281.18, 215.74],
  p2 = [295.39, 269.96],
  p3 = [342.51, 216.38],
)`

    const testCases: {
      name: string
      code: string
      searchText: string
      constraintIndex: number
      expectedResult: string
      filter?: string
    }[] = [
      {
        name: 'should constrain line x value',
        ...makeStraightSegmentSnippet('line(end = [16.27, 73.81])'),
        constraintIndex: 0,
        expectedResult: 'line(end = [test_variable,',
      },
      {
        name: 'should constrain line y value',
        ...makeStraightSegmentSnippet('line(end = [16.27, 73.81])'),
        constraintIndex: 1,
        expectedResult: 'line(end = [16.27, test_variable]',
      },
      {
        name: 'should constrain line absolute x value',
        ...makeStraightSegmentSnippet('line(endAbsolute = [16.27, 73.81])'),
        constraintIndex: 0,
        expectedResult: 'line(endAbsolute = [test_variable, 73.81]',
      },
      {
        name: 'should constrain line absolute y value',
        ...makeStraightSegmentSnippet('line(endAbsolute = [16.27, 73.81])'),
        constraintIndex: 1,
        expectedResult: 'line(endAbsolute = [16.27, test_variable]',
      },
      {
        name: 'should constrain xLine x value',
        ...makeStraightSegmentSnippet('xLine(length = 15)'),
        constraintIndex: 1,
        expectedResult: 'xLine(length = test_variable)',
      },
      {
        name: 'should constrain xLine x absolute value',
        ...makeStraightSegmentSnippet('xLine(endAbsolute = 15)'),
        constraintIndex: 1,
        expectedResult: 'xLine(endAbsolute = test_variable)',
      },
      {
        name: 'should constrain yLine y value',
        ...makeStraightSegmentSnippet('yLine(length = 15)'),
        constraintIndex: 1,
        expectedResult: 'yLine(length = test_variable)',
      },
      {
        name: 'should constrain yLine y absolute value',
        ...makeStraightSegmentSnippet('yLine(endAbsolute = 15)'),
        constraintIndex: 1,
        expectedResult: 'yLine(endAbsolute = test_variable)',
      },
      {
        name: 'should constrain angledLine, angle value',
        ...makeStraightSegmentSnippet('angledLine(angle = 45, length = 100)'),
        constraintIndex: 0,
        expectedResult: 'angledLine(angle = test_variable, length = 100)',
      },
      {
        name: 'should constrain angledLine, length value',
        ...makeStraightSegmentSnippet('angledLine(angle = 45, length = 100)'),
        constraintIndex: 1,
        expectedResult: 'angledLine(angle = 45, length = test_variable)',
      },
      {
        name: 'should constrain angledLine, endAbsoluteY value',
        ...makeStraightSegmentSnippet(
          'angledLine(angle = 45, endAbsoluteY = 5)'
        ),
        constraintIndex: 1,
        expectedResult: 'angledLine(angle = 45, endAbsoluteY = test_variable)',
      },
      {
        name: 'should constrain angledLine, endAbsoluteX value',
        ...makeStraightSegmentSnippet(
          'angledLine(angle = 45, endAbsoluteX = 5)'
        ),
        constraintIndex: 1,
        expectedResult: 'angledLine(angle = 45, endAbsoluteX = test_variable)',
      },
      {
        name: 'should constrain angledLine, lengthY value',
        ...makeStraightSegmentSnippet('angledLine(angle = 45, lengthY = 5)'),
        constraintIndex: 1,
        expectedResult: 'angledLine(angle = 45, lengthY = test_variable)',
      },
      {
        name: 'should constrain angledLine, lengthX value',
        ...makeStraightSegmentSnippet('angledLine(angle = 45, lengthX = 5)'),
        constraintIndex: 1,
        expectedResult: 'angledLine(angle = 45, lengthX = test_variable)',
      },

      {
        name: 'should constrain circle, radius value',
        ...makeCircSnippet(
          'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
        ),
        constraintIndex: 0,
        expectedResult:
          'circle(sketch001, center = [140.82, 183.92], radius = test_variable)',
      },
      {
        name: 'should constrain circle, center x value',
        ...makeCircSnippet(
          'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
        ),
        constraintIndex: 1,
        expectedResult:
          'circle(sketch001, center = [test_variable, 183.92], radius = 74.18)',
      },
      {
        name: 'should constrain circle, center y value',
        ...makeCircSnippet(
          'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
        ),
        constraintIndex: 2,
        expectedResult:
          'circle(sketch001, center = [140.82, test_variable], radius = 74.18)',
      },

      {
        name: 'should constrain circleThreePoint, p1 x value',
        ...makeCircSnippet(threePointCirceCode),
        constraintIndex: 0,
        expectedResult: 'p1 = [test_variable, 215.74]',
        filter: 'p1',
      },
      {
        name: 'should constrain circleThreePoint, p1 y value',
        ...makeCircSnippet(threePointCirceCode),
        constraintIndex: 1,
        expectedResult: 'p1 = [281.18, test_variable]',
        filter: 'p1',
      },
      {
        name: 'should constrain circleThreePoint, p2 x value',
        ...makeCircSnippet(threePointCirceCode),
        constraintIndex: 0,
        expectedResult: 'p2 = [test_variable, 269.96]',
        filter: 'p2',
      },
      {
        name: 'should constrain circleThreePoint, p2 y value',
        ...makeCircSnippet(threePointCirceCode),
        constraintIndex: 1,
        expectedResult: 'p2 = [295.39, test_variable]',
        filter: 'p2',
      },
      {
        name: 'should constrain circleThreePoint, p3 x value',
        ...makeCircSnippet(threePointCirceCode),
        constraintIndex: 0,
        expectedResult: 'p3 = [test_variable, 216.38]',
        filter: 'p3',
      },
      {
        name: 'should constrain circleThreePoint, p3 y value',
        ...makeCircSnippet(threePointCirceCode),
        constraintIndex: 1,
        expectedResult: 'p3 = [342.51, test_variable]',
        filter: 'p3',
      },
      {
        name: 'should constrain tangentialArc absolute x value',
        ...makeStraightSegmentSnippet(
          'tangentialArc(endAbsolute = [176.11, 19.49])'
        ),
        constraintIndex: 1,
        expectedResult: 'endAbsolute = [test_variable, 19.49]',
      },
      {
        name: 'should constrain tangentialArc absolute y value',
        ...makeStraightSegmentSnippet(
          'tangentialArc(endAbsolute = [176.11, 19.49])'
        ),
        constraintIndex: 2,
        expectedResult: 'endAbsolute = [176.11, test_variable]',
      },
      // TODO tangentialArc relative when that's working
      {
        name: 'should constrain threePoint Arc interior x value',
        ...makeStraightSegmentSnippet(
          'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
        ),
        constraintIndex: 0,
        expectedResult: 'interiorAbsolute = [test_variable, 103.92]',
        filter: ARG_INTERIOR_ABSOLUTE,
      },
      {
        name: 'should constrain threePoint Arc interior y value',
        ...makeStraightSegmentSnippet(
          'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
        ),
        constraintIndex: 1,
        expectedResult: 'interiorAbsolute = [379.93, test_variable]',
        filter: ARG_INTERIOR_ABSOLUTE,
      },
      {
        name: 'should constrain threePoint Arc end x value',
        ...makeStraightSegmentSnippet(
          'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
        ),
        constraintIndex: 0,
        expectedResult: 'endAbsolute = [test_variable, 162.89]',
        filter: ARG_END_ABSOLUTE,
      },
      {
        name: 'should constrain threePoint Arc end y value',
        ...makeStraightSegmentSnippet(
          'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
        ),
        constraintIndex: 1,
        expectedResult: 'endAbsolute = [386.2, test_variable]',
        filter: ARG_END_ABSOLUTE,
      },
    ]

    testCases.forEach(
      ({ name, code, searchText, constraintIndex, expectedResult, filter }) => {
        it(name, async () => {
          const indexOfInterest = code.indexOf(searchText)

          const ast = assertParse(code)

          await kclManager.executeAst({ ast })

          expect(kclManager.errors).toEqual([])

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

          const callExp = getNodeFromPath<Node<CallExpressionKw>>(
            kclManager.ast,
            artifact.codeRef.pathToNode,
            'CallExpressionKw'
          )
          if (err(callExp)) {
            throw new Error('Failed to get CallExpressionKw node')
          }
          const constraintInfo = getConstraintInfoKw(
            callExp.node,
            codeManager.code,
            artifact.codeRef.pathToNode,
            filter
          )
          const first = constraintInfo[constraintIndex]

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
          expect(codeManager.code).toContain(expectedResult)
        }, 10_000)
      }
    )
  })
})
