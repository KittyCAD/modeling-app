import { assertParse, recast, type CallExpressionKw } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { kclManager, codeManager } from '@src/lib/singletons'
import {
  createLiteral,
  createIdentifier,
  createVariableDeclaration,
} from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import { expect } from 'vitest'
import { modelingMachine } from '@src/machines/modelingMachine'
import { createActor } from 'xstate'
import { vi } from 'vitest'
import { getConstraintInfoKw } from '@src/lang/std/sketch'
import { ARG_END_ABSOLUTE, ARG_INTERIOR_ABSOLUTE } from '@src/lang/constants'
import { removeSingleConstraintInfo } from '@src/lang/modifyAst'
import {
  generateModelingMachineDefaultContext,
  modelingMachineDefaultContext,
} from '@src/machines/modelingSharedContext'
import {
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { kclEditorMachine } from './kclEditorMachine'
const GLOBAL_TIMEOUT_FOR_MODELING_MACHINE = 5000

describe('modelingMachine.test.ts', () => {
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
        value: '45deg',
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
    timeout = GLOBAL_TIMEOUT_FOR_MODELING_MACHINE,
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
      it('should start in the idle state', async () => {
        const {
          codeManager,
          kclManager,
          engineCommandManager,
          sceneInfra,
          editorManager,
          rustContext,
        } = await buildTheWorldAndConnectToEngine()
        const contextCopied = generateModelingMachineDefaultContext()
        contextCopied.codeManager = codeManager
        contextCopied.kclManager = kclManager
        contextCopied.engineCommandManager = engineCommandManager
        contextCopied.sceneInfra = sceneInfra
        const sceneEntitiesManager = new SceneEntities(
          engineCommandManager,
          sceneInfra,
          editorManager,
          codeManager,
          kclManager,
          rustContext
        )
        contextCopied.sceneEntitiesManager = sceneEntitiesManager
        const actor = createActor(modelingMachine, {
          input: contextCopied,
        }).start()
        const state = actor.getSnapshot().value

        // The machine should start in the idle state
        expect(state).toEqual({ idle: 'hidePlanes' })
        engineCommandManager.tearDown()
      })
    })

    const makeStraightSegmentSnippet = (line: string) => ({
      code: `testVar1 = 55
testVar2 = 66
testVar3 = 77
testVar4 = 88
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [2263.04, -2721.2])
|> line(end = [78, 19])
|> ${line}
|> line(end = [75.72, 18.41])`,
      searchText: line,
    })
    const makeCircSnippet = (line: string) => ({
      code: `testVar1 = 55
testVar2 = 66
testVar3 = 77
testVar4 = 88
testVar5 = 99
testVar6 = 11
sketch001 = startSketchOn(YZ)
profile001 = ${line}
`,
      searchText: line,
    })
    const threePointCirceCode = `circleThreePoint(
sketch001,
p1 = [testVar1, testVar2],
p2 = [testVar3, testVar4],
p3 = [testVar5, testVar6],
)`
    const threePointCirceCodeLiterals = `circleThreePoint(
sketch001,
p1 = [281.18, 215.74],
p2 = [295.39, 269.96],
p3 = [342.51, 216.38],
)`

    type TestDetails = {
      name: string
      code: string
      searchText: string
      constraintIndex: number
      expectedResult: string
      filter?: string
    }

    const cases: {
      [strLibName: string]: {
        namedConstantConstraint: TestDetails[]
        removeAllConstraintsCases: TestDetails[]
        removeIndividualConstraintsCases: TestDetails[]
        deleteSegment: Omit<TestDetails, 'expectedResult' | 'constraintIndex'>[]
      }
    } = {
      line: {
        namedConstantConstraint: [
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
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain rel-line',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [55, 66])',
          },
          {
            name: 'should un-constrain abs-line',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 0,
            expectedResult: 'line(end = [-2286.04, 2768.2]',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [55, 66]',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain line x value',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [55, testVar2]',
          },
          {
            name: 'should un-constrain line y value',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 1,
            expectedResult: 'line(end = [testVar1, 66]',
          },
          {
            name: 'should un-constrain line absolute x value',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 0,
            // expectedResult: 'line(end = [-2286.04, testVar2])',
            // // TODO should not swap from abs to relative, expected should be
            expectedResult: 'line(endAbsolute = [55, testVar2]',
          },
          {
            name: 'should un-constrain line absolute y value',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 1,
            expectedResult: 'line(endAbsolute = [testVar1, 66])',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete rel-line',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
          },
          {
            name: 'should delete abs-line',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
          },
        ],
      },
      xLine: {
        namedConstantConstraint: [
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
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain xLine',
            ...makeStraightSegmentSnippet('xLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [55, 0])',
          },
          {
            name: 'should un-constrain xLine absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [-2286.04, 0])',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [55, 0])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain xLine x value',
            ...makeStraightSegmentSnippet('xLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'xLine(length = 55)',
          },
          {
            name: 'should un-constrain xLine x absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'xLine(endAbsolute = 55)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete xLine',
            ...makeStraightSegmentSnippet('xLine(length = 15)'),
          },
          {
            name: 'should delete xLine',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = 15)'),
          },
        ],
      },
      yLine: {
        namedConstantConstraint: [
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
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain yLine value',
            ...makeStraightSegmentSnippet('yLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [0, 55])',
          },
          {
            name: 'should un-constrain yLine absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [0, 2757.2])',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [0, 55])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain yLine y value',
            ...makeStraightSegmentSnippet('yLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'yLine(length = 55)',
          },
          {
            name: 'should un-constrain yLine y absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'yLine(endAbsolute = 55)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete yLine',
            ...makeStraightSegmentSnippet('yLine(length = 15)'),
          },
          {
            name: 'should delete yLine abs',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = 15)'),
          },
        ],
      },
      angledLine: {
        namedConstantConstraint: [
          {
            name: 'should constrain angledLine, angle value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
            constraintIndex: 0,
            expectedResult: 'angledLine(angle = test_variable, length = 100)',
          },
          {
            name: 'should constrain angledLine, length value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = 45deg, length = test_variable)',
          },
          {
            name: 'should constrain angledLine, endAbsoluteY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteY = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, endAbsoluteY = test_variable)',
          },
          {
            name: 'should constrain angledLine, endAbsoluteX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteX = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, endAbsoluteX = test_variable)',
          },
          {
            name: 'should constrain angledLine, lengthY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthY = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, lengthY = test_variable)',
          },
          {
            name: 'should constrain angledLine, lengthX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthX = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, lengthX = test_variable)',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain angledLine',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 0,
            expectedResult: 'line(end = [37.86, 54.06]',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [1938.31, 2768.2])',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [-2275.04, -3249.09])',
          },
          {
            name: 'should un-constrain angledLine, lengthY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [46.21, 66])',
          },
          {
            name: 'should un-constrain angledLine, lengthX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [66, 94.26])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain angledLine, angle value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 0,
            expectedResult: 'angledLine(angle = 55deg, length = testVar2)',
          },
          {
            name: 'should un-constrain angledLine, length value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, length = 66)',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, endAbsoluteY = 66)',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, endAbsoluteX = 66)',
          },
          {
            name: 'should un-constrain angledLine, lengthY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, lengthY = 66)',
          },
          {
            name: 'should un-constrain angledLine, lengthX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, lengthX = 66)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete angledLine, angle length',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
          },
          {
            name: 'should delete angledLine, endAbsoluteY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteY = 5)'
            ),
          },
          {
            name: 'should delete angledLine, endAbsoluteX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteX = 5)'
            ),
          },
          {
            name: 'should delete angledLine, lengthY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthY = 5)'
            ),
          },
          {
            name: 'should delete angledLine, lengthX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthX = 5)'
            ),
          },
        ],
      },
      circle: {
        namedConstantConstraint: [
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
        ],
        removeAllConstraintsCases: [
          // TODO circle when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain circle, radius value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = testVar1)'
            ),
            constraintIndex: 0,
            expectedResult:
              'circle(sketch001, center = [140.82, 183.92], radius = 55)',
          },
          {
            name: 'should un-constrain circle, center x value',
            ...makeCircSnippet(
              'circle(sketch001, center = [testVar1, testVar2], radius = 74.18)'
            ),
            constraintIndex: 1,
            expectedResult:
              'circle(sketch001, center = [55, testVar2], radius = 74.18)',
          },
          {
            name: 'should un-constrain circle, center y value',
            ...makeCircSnippet(
              'circle(sketch001, center = [testVar1, testVar2], radius = 74.18)'
            ),
            constraintIndex: 2,
            expectedResult:
              'circle(sketch001, center = [testVar1, 66], radius = 74.18)',
          },
        ],
        deleteSegment: [
          /** TODO once circle has delete implemented */
        ],
      },
      circleThreePoint: {
        namedConstantConstraint: [
          {
            name: 'should constrain circleThreePoint, p1 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p1 = [test_variable, 215.74]',
            filter: 'p1',
          },
          {
            name: 'should constrain circleThreePoint, p1 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p1 = [281.18, test_variable]',
            filter: 'p1',
          },
          {
            name: 'should constrain circleThreePoint, p2 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p2 = [test_variable, 269.96]',
            filter: 'p2',
          },
          {
            name: 'should constrain circleThreePoint, p2 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p2 = [295.39, test_variable]',
            filter: 'p2',
          },
          {
            name: 'should constrain circleThreePoint, p3 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p3 = [test_variable, 216.38]',
            filter: 'p3',
          },
          {
            name: 'should constrain circleThreePoint, p3 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p3 = [342.51, test_variable]',
            filter: 'p3',
          },
        ],
        removeAllConstraintsCases: [
          // TODO circleThreePoint when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain circleThreePoint, p1 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p1 = [55, testVar2]',
            filter: 'p1',
          },
          {
            name: 'should un-constrain circleThreePoint, p1 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p1 = [testVar1, 66]',
            filter: 'p1',
          },
          {
            name: 'should un-constrain circleThreePoint, p2 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p2 = [77, testVar4]',
            filter: 'p2',
          },
          {
            name: 'should un-constrain circleThreePoint, p2 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p2 = [testVar3, 88]',
            filter: 'p2',
          },
          {
            name: 'should un-constrain circleThreePoint, p3 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p3 = [99, testVar6]',
            filter: 'p3',
          },
          {
            name: 'should un-constrain circleThreePoint, p3 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p3 = [testVar5, 11]',
            filter: 'p3',
          },
        ],
        deleteSegment: [
          /**TODO once three point circle has delete implemented */
        ],
      },
      tangentialArc: {
        namedConstantConstraint: [
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
        ],
        removeAllConstraintsCases: [
          // TODO tangentialArc when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain tangentialArc absolute x value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [55, testVar2]',
          },
          {
            name: 'should un-constrain tangentialArc absolute y value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 2,
            expectedResult: 'endAbsolute = [testVar1, 66]',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete tangentialArc absolute',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [176.11, 19.49])'
            ),
          },
        ],
      },
      arc: {
        namedConstantConstraint: [
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
          // TODO do other kwargs for arc
        ],
        removeAllConstraintsCases: [
          // TODO arc when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain threePoint Arc interior x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 0,
            expectedResult: 'interiorAbsolute = [55, testVar2]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc interior y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 1,
            expectedResult: 'interiorAbsolute = [testVar1, 66]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc end x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 0,
            expectedResult: 'endAbsolute = [77, testVar4]',
            filter: ARG_END_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc end y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [testVar3, 88]',
            filter: ARG_END_ABSOLUTE,
          },
        ],
        deleteSegment: [
          {
            name: 'should delete threePoint Arc (interior, end)',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
          },
        ],
      },
    }

    describe.only('Deleting segment with three dot menu', () => {
      const namedConstantConstraintCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.deleteSegment
      )
      namedConstantConstraintCases.forEach(
        ({ name, code, searchText, filter }) => {
          it(name, async () => {
            const {
              codeManager,
              kclManager,
              engineCommandManager,
              sceneInfra,
              editorManager,
              rustContext,
              instance,
            } = await buildTheWorldAndConnectToEngine()
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code, instance)

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
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const contextCopied = generateModelingMachineDefaultContext()
            const kclEditorActor = createActor(kclEditorMachine).start()

            contextCopied.codeManager = codeManager
            contextCopied.kclManager = kclManager
            contextCopied.engineCommandManager = engineCommandManager
            contextCopied.sceneInfra = sceneInfra
            contextCopied.editorManager = editorManager
            contextCopied.wasmInstance = instance
            contextCopied.kclEditorMachine = kclEditorActor

            const sceneEntitiesManager = new SceneEntities(
              engineCommandManager,
              sceneInfra,
              editorManager,
              codeManager,
              kclManager,
              rustContext
            )
            contextCopied.sceneEntitiesManager = sceneEntitiesManager
            const actor = createActor(modelingMachine, {
              input: contextCopied,
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
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

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
            const constraint = constraintInfo[0]

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Delete segment',
              data: constraint.pathToNode,
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
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const startTime = Date.now()
            while (
              codeManager.code.includes(searchText) &&
              Date.now() - startTime < GLOBAL_TIMEOUT_FOR_MODELING_MACHINE
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            expect(codeManager.code).not.toContain(searchText)
            engineCommandManager.tearDown()
          }, 10_000)
        }
      )
    })
    describe('Adding segment overlay constraints', () => {
      const namedConstantConstraintCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.namedConstantConstraint
      )
      namedConstantConstraintCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
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
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
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
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

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
            const constraint = constraintInfo[constraintIndex]

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Constrain with named value',
              data: {
                currentValue: {
                  valueText: constraint.value,
                  pathToNode: constraint.pathToNode,
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
                  variableIdentifierAst: createIdentifier(
                    'test_variable'
                  ) as any,
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
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({ Sketch: 'Converting to named value' })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)
            expect(codeManager.code).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
    describe('removing individual constraints with segment overlay events', () => {
      const removeIndividualConstraintsCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.removeIndividualConstraintsCases
      )

      removeIndividualConstraintsCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
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
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
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
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

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
            const constraint = constraintInfo[constraintIndex]
            console.log('constraint', constraint)
            if (!constraint.argPosition) {
              throw new Error(
                `Constraint at index ${constraintIndex} does not have argPosition`
              )
            }

            const mod = removeSingleConstraintInfo(
              constraint.pathToNode,
              constraint.argPosition,
              ast,
              kclManager.variables,
              removeSingleConstraint,
              transformAstSketchLines
            )
            if (!mod) {
              throw new Error('Failed to remove constraint info')
            }
            const codeRecast = recast(mod.modifiedAst)

            expect(codeRecast).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
    describe('Removing segment overlay constraints', () => {
      const removeAllConstraintsCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.removeAllConstraintsCases
      )

      removeAllConstraintsCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
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
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
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
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Constrain remove constraints',
              data: artifact.codeRef.pathToNode,
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
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({ Sketch: 'Constrain remove constraints' })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)
            const startTime = Date.now()
            while (
              !codeManager.code.includes(expectedResult) &&
              Date.now() - startTime < GLOBAL_TIMEOUT_FOR_MODELING_MACHINE
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            expect(codeManager.code).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
  })
})
