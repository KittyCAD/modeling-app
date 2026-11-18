// Existing legacy KCL regression programs; these deliberately exercise KCL 1.0.
import { ARG_END_ABSOLUTE, ARG_INTERIOR_ABSOLUTE } from '@src/lang/constants'

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

export const legacySketchCases: {
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
        ...makeStraightSegmentSnippet('angledLine(angle = 45deg, lengthY = 5)'),
        constraintIndex: 1,
        expectedResult: 'angledLine(angle = 45deg, lengthY = test_variable)',
      },
      {
        name: 'should constrain angledLine, lengthX value',
        ...makeStraightSegmentSnippet('angledLine(angle = 45deg, lengthX = 5)'),
        constraintIndex: 1,
        expectedResult: 'angledLine(angle = 45deg, lengthX = test_variable)',
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
        ...makeStraightSegmentSnippet('angledLine(angle = 45deg, lengthY = 5)'),
      },
      {
        name: 'should delete angledLine, lengthX',
        ...makeStraightSegmentSnippet('angledLine(angle = 45deg, lengthX = 5)'),
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
