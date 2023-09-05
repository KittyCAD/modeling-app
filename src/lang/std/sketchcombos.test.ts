import { parser_wasm } from '../abstractSyntaxTree'
import { Value } from '../abstractSyntaxTreeTypes'
import {
  getConstraintType,
  getTransformInfos,
  transformAstSketchLines,
  transformSecondarySketchLinesTagFirst,
  ConstraintType,
  getConstraintLevelFromSourceRange,
} from './sketchcombos'
import { initPromise } from '../rust'
import { Selections, TooTip } from '../../useStore'
import { enginelessExecutor } from '../../lib/testHelpers'
import { recast } from '../../lang/recast'

beforeAll(() => initPromise)

describe('testing getConstraintType', () => {
  const helper = getConstraintTypeFromSourceHelper
  it('testing line', () => {
    expect(helper(`line([5, myVar], %)`)).toBe('yRelative')
    expect(helper(`line([myVar, 5], %)`)).toBe('xRelative')
  })
  it('testing lineTo', () => {
    expect(helper(`lineTo([5, myVar], %)`)).toBe('yAbsolute')
    expect(helper(`lineTo([myVar, 5], %)`)).toBe('xAbsolute')
  })
  it('testing angledLine', () => {
    expect(helper(`angledLine([5, myVar], %)`)).toBe('length')
    expect(helper(`angledLine([myVar, 5], %)`)).toBe('angle')
  })
  it('testing angledLineOfXLength', () => {
    expect(helper(`angledLineOfXLength([5, myVar], %)`)).toBe('xRelative')
    expect(helper(`angledLineOfXLength([myVar, 5], %)`)).toBe('angle')
  })
  it('testing angledLineToX', () => {
    expect(helper(`angledLineToX([5, myVar], %)`)).toBe('xAbsolute')
    expect(helper(`angledLineToX([myVar, 5], %)`)).toBe('angle')
  })
  it('testing angledLineOfYLength', () => {
    expect(helper(`angledLineOfYLength([5, myVar], %)`)).toBe('yRelative')
    expect(helper(`angledLineOfYLength([myVar, 5], %)`)).toBe('angle')
  })
  it('testing angledLineToY', () => {
    expect(helper(`angledLineToY([5, myVar], %)`)).toBe('yAbsolute')
    expect(helper(`angledLineToY([myVar, 5], %)`)).toBe('angle')
  })
  const helper2 = getConstraintTypeFromSourceHelper2
  it('testing xLine', () => {
    expect(helper2(`xLine(5, %)`)).toBe('yRelative')
  })
  it('testing yLine', () => {
    expect(helper2(`yLine(5, %)`)).toBe('xRelative')
  })
  it('testing xLineTo', () => {
    expect(helper2(`xLineTo(5, %)`)).toBe('yAbsolute')
  })
  it('testing yLineTo', () => {
    expect(helper2(`yLineTo(5, %)`)).toBe('xAbsolute')
  })
})

function getConstraintTypeFromSourceHelper(
  code: string
): ReturnType<typeof getConstraintType> {
  const ast = parser_wasm(code)
  const args = (ast.body[0] as any).expression.arguments[0].elements as [
    Value,
    Value
  ]
  const fnName = (ast.body[0] as any).expression.callee.name as TooTip
  return getConstraintType(args, fnName)
}
function getConstraintTypeFromSourceHelper2(
  code: string
): ReturnType<typeof getConstraintType> {
  const ast = parser_wasm(code)
  const arg = (ast.body[0] as any).expression.arguments[0] as Value
  const fnName = (ast.body[0] as any).expression.callee.name as TooTip
  return getConstraintType(arg, fnName)
}

function makeSelections(
  codeBaseSelections: Selections['codeBasedSelections']
): Selections {
  return {
    codeBasedSelections: codeBaseSelections,
    otherSelections: [],
  }
}

describe('testing transformAstForSketchLines for equal length constraint', () => {
  const inputScript = `const myVar = 3
const myVar2 = 5
const myVar3 = 6
const myAng = 40
const myAng2 = 134
const part001 = startSketchAt([0, 0])
  |> line([1, 3.82], %) // ln-should-get-tag
  |> lineTo([myVar, 1], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> lineTo([1, myVar], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
  |> lineTo([2, 4], %) // ln-lineTo-free should become angledLine
  |> angledLineToX([45, 2.5], %) // ln-angledLineToX-free should become angledLine
  |> angledLineToX([myAng, 3], %) // ln-angledLineToX-angle should become angledLine
  |> angledLineToX([45, myVar2], %) // ln-angledLineToX-xAbsolute should use angleToMatchLengthX to get angle
  |> angledLineToY([135, 5], %) // ln-angledLineToY-free should become angledLine
  |> angledLineToY([myAng2, 4], %) // ln-angledLineToY-angle should become angledLine
  |> angledLineToY([45, myVar3], %) // ln-angledLineToY-yAbsolute should use angleToMatchLengthY to get angle
  |> line([myVar, 1], %) // ln-should use legLen for y
  |> line([myVar, -1], %) // ln-legLen but negative
  |> line([-0.62, -1.54], %) // ln-should become angledLine
  |> angledLine([myVar, 1.04], %) // ln-use segLen for secound arg
  |> angledLine([45, 1.04], %) // ln-segLen again
  |> angledLineOfXLength([54, 2.35], %) // ln-should be transformed to angledLine
  |> angledLineOfXLength([50, myVar], %) // ln-should use legAngX to calculate angle
  |> angledLineOfXLength([209, myVar], %) // ln-same as above but should have + 180 to match original quadrant
  |> line([1, myVar], %) // ln-legLen again but yRelative
  |> line([-1, myVar], %) // ln-negative legLen yRelative
  |> angledLineOfYLength([58, 0.7], %) // ln-angledLineOfYLength-free should become angledLine
  |> angledLineOfYLength([myAng, 0.7], %) // ln-angledLineOfYLength-angle should become angledLine
  |> angledLineOfYLength([35, myVar], %) // ln-angledLineOfYLength-yRelative use legAngY
  |> angledLineOfYLength([305, myVar], %) // ln-angledLineOfYLength-yRelative with angle > 90 use binExp
  |> xLine(1.03, %) // ln-xLine-free should sub in segLen
  |> yLine(1.04, %) // ln-yLine-free should sub in segLen
  |> xLineTo(30, %) // ln-xLineTo-free should convert to xLine
  |> yLineTo(20, %) // ln-yLineTo-free should convert to yLine
show(part001)`
  const expectModifiedScript = `const myVar = 3
const myVar2 = 5
const myVar3 = 6
const myAng = 40
const myAng2 = 134
const part001 = startSketchAt([0, 0])
  |> line({ to: [1, 3.82], tag: 'seg01' }, %) // ln-should-get-tag
  |> angledLineToX([
        -angleToMatchLengthX('seg01', myVar, %),
        myVar
    ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> angledLineToY([
        -angleToMatchLengthY('seg01', myVar, %),
        myVar
    ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
  |> angledLine([45, segLen('seg01', %)], %) // ln-lineTo-free should become angledLine
  |> angledLine([45, segLen('seg01', %)], %) // ln-angledLineToX-free should become angledLine
  |> angledLine([myAng, segLen('seg01', %)], %) // ln-angledLineToX-angle should become angledLine
  |> angledLineToX([
        angleToMatchLengthX('seg01', myVar2, %),
        myVar2
    ], %) // ln-angledLineToX-xAbsolute should use angleToMatchLengthX to get angle
  |> angledLine([-45, segLen('seg01', %)], %) // ln-angledLineToY-free should become angledLine
  |> angledLine([myAng2, segLen('seg01', %)], %) // ln-angledLineToY-angle should become angledLine
  |> angledLineToY([
        angleToMatchLengthY('seg01', myVar3, %),
        myVar3
    ], %) // ln-angledLineToY-yAbsolute should use angleToMatchLengthY to get angle
  |> line([
        min(segLen('seg01', %), myVar),
        legLen(segLen('seg01', %), myVar)
    ], %) // ln-should use legLen for y
  |> line([
        min(segLen('seg01', %), myVar),
        -legLen(segLen('seg01', %), myVar)
    ], %) // ln-legLen but negative
  |> angledLine([-112, segLen('seg01', %)], %) // ln-should become angledLine
  |> angledLine([myVar, segLen('seg01', %)], %) // ln-use segLen for secound arg
  |> angledLine([45, segLen('seg01', %)], %) // ln-segLen again
  |> angledLine([54, segLen('seg01', %)], %) // ln-should be transformed to angledLine
  |> angledLineOfXLength([
        legAngX(segLen('seg01', %), myVar),
        min(segLen('seg01', %), myVar)
    ], %) // ln-should use legAngX to calculate angle
  |> angledLineOfXLength([
        180 + legAngX(segLen('seg01', %), myVar),
        min(segLen('seg01', %), myVar)
    ], %) // ln-same as above but should have + 180 to match original quadrant
  |> line([
        legLen(segLen('seg01', %), myVar),
        min(segLen('seg01', %), myVar)
    ], %) // ln-legLen again but yRelative
  |> line([
        -legLen(segLen('seg01', %), myVar),
        min(segLen('seg01', %), myVar)
    ], %) // ln-negative legLen yRelative
  |> angledLine([58, segLen('seg01', %)], %) // ln-angledLineOfYLength-free should become angledLine
  |> angledLine([myAng, segLen('seg01', %)], %) // ln-angledLineOfYLength-angle should become angledLine
  |> angledLineOfXLength([
        legAngY(segLen('seg01', %), myVar),
        min(segLen('seg01', %), myVar)
    ], %) // ln-angledLineOfYLength-yRelative use legAngY
  |> angledLineOfXLength([
        270 + legAngY(segLen('seg01', %), myVar),
        min(segLen('seg01', %), myVar)
    ], %) // ln-angledLineOfYLength-yRelative with angle > 90 use binExp
  |> xLine(segLen('seg01', %), %) // ln-xLine-free should sub in segLen
  |> yLine(segLen('seg01', %), %) // ln-yLine-free should sub in segLen
  |> xLine(segLen('seg01', %), %) // ln-xLineTo-free should convert to xLine
  |> yLine(segLen('seg01', %), %) // ln-yLineTo-free should convert to yLine
show(part001)`
  it('should transform the ast', async () => {
    const ast = parser_wasm(inputScript)
    const selectionRanges: Selections['codeBasedSelections'] = inputScript
      .split('\n')
      .filter((ln) => ln.includes('//'))
      .map((ln) => {
        const comment = ln.split('//')[1]
        const start = inputScript.indexOf('//' + comment) - 7
        return {
          type: 'default',
          range: [start, start],
        }
      })

    const programMemory = await enginelessExecutor(ast)
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges.slice(1)),
      ast,
      'equalLength'
    )

    const newAst = transformSecondarySketchLinesTagFirst({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      programMemory,
    })?.modifiedAst
    const newCode = recast(newAst)
    expect(newCode).toBe(expectModifiedScript)
  })
})

describe('testing transformAstForSketchLines for vertical and horizontal constraint', () => {
  const inputScript = `const myVar = 2
const myVar2 = 12
const myVar3 = -10
const part001 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  |> line([-6.28, 1.4], %) // select for horizontal constraint 1
  |> line([-1.07, myVar], %) // select for vertical constraint 1
  |> line([myVar, 4.32], %) // select for horizontal constraint 2
  |> line([6.35, -1.12], %) // select for vertical constraint 2
  |> lineTo([5, 8], %) // select for horizontal constraint 3
  |> lineTo([3, 11], %) // select for vertical constraint 3
  |> lineTo([myVar2, 12.63], %) // select for horizontal constraint 4
  |> lineTo([4.08, myVar2], %) // select for vertical constraint 4
  |> angledLine([156, 1.34], %) // select for horizontal constraint 5
  |> angledLine([103, 1.44], %) // select for vertical constraint 5
  |> angledLine([-178, myVar], %) // select for horizontal constraint 6
  |> angledLine([129, myVar], %) // select for vertical constraint 6
  |> angledLineOfXLength([237, 1.05], %) // select for horizontal constraint 7
  |> angledLineOfYLength([196, 1.11], %) // select for vertical constraint 7
  |> angledLineOfXLength([194, myVar], %) // select for horizontal constraint 8
  |> angledLineOfYLength([248, myVar], %) // select for vertical constraint 8
  |> angledLineToX([202, -10.92], %) // select for horizontal constraint 9
  |> angledLineToY([223, 7.68], %) // select for vertical constraint 9
  |> angledLineToX([333, myVar3], %) // select for horizontal constraint 10
  |> angledLineToY([301, myVar], %) // select for vertical constraint 10
show(part001)`
  it('should transform horizontal lines the ast', async () => {
    const expectModifiedScript = `const myVar = 2
const myVar2 = 12
const myVar3 = -10
const part001 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  |> xLine(-6.28, %) // select for horizontal constraint 1
  |> line([-1.07, myVar], %) // select for vertical constraint 1
  |> xLine(myVar, %) // select for horizontal constraint 2
  |> line([6.35, -1.12], %) // select for vertical constraint 2
  |> xLineTo(5, %) // select for horizontal constraint 3
  |> lineTo([3, 11], %) // select for vertical constraint 3
  |> xLineTo(myVar2, %) // select for horizontal constraint 4
  |> lineTo([4.08, myVar2], %) // select for vertical constraint 4
  |> xLine(-1.22, %) // select for horizontal constraint 5
  |> angledLine([103, 1.44], %) // select for vertical constraint 5
  |> xLine(-myVar, %) // select for horizontal constraint 6
  |> angledLine([129, myVar], %) // select for vertical constraint 6
  |> xLine(-1.05, %) // select for horizontal constraint 7
  |> angledLineOfYLength([196, 1.11], %) // select for vertical constraint 7
  |> xLine(-myVar, %) // select for horizontal constraint 8
  |> angledLineOfYLength([248, myVar], %) // select for vertical constraint 8
  |> xLineTo(-10.92, %) // select for horizontal constraint 9
  |> angledLineToY([223, 7.68], %) // select for vertical constraint 9
  |> xLineTo(myVar3, %) // select for horizontal constraint 10
  |> angledLineToY([301, myVar], %) // select for vertical constraint 10
show(part001)`
    const ast = parser_wasm(inputScript)
    const selectionRanges: Selections['codeBasedSelections'] = inputScript
      .split('\n')
      .filter((ln) => ln.includes('// select for horizontal constraint'))
      .map((ln) => {
        const comment = ln.split('//')[1]
        const start = inputScript.indexOf('//' + comment) - 7
        return {
          type: 'default',
          range: [start, start],
        }
      })

    const programMemory = await enginelessExecutor(ast)
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges),
      ast,
      'horizontal'
    )

    const newAst = transformAstSketchLines({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      programMemory,
      referenceSegName: '',
    })?.modifiedAst
    const newCode = recast(newAst)
    expect(newCode).toBe(expectModifiedScript)
  })
  it('should transform vertical lines the ast', async () => {
    const expectModifiedScript = `const myVar = 2
const myVar2 = 12
const myVar3 = -10
const part001 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  |> line([-6.28, 1.4], %) // select for horizontal constraint 1
  |> yLine(myVar, %) // select for vertical constraint 1
  |> line([myVar, 4.32], %) // select for horizontal constraint 2
  |> yLine(-1.12, %) // select for vertical constraint 2
  |> lineTo([5, 8], %) // select for horizontal constraint 3
  |> yLineTo(11, %) // select for vertical constraint 3
  |> lineTo([myVar2, 12.63], %) // select for horizontal constraint 4
  |> yLineTo(myVar2, %) // select for vertical constraint 4
  |> angledLine([156, 1.34], %) // select for horizontal constraint 5
  |> yLine(1.4, %) // select for vertical constraint 5
  |> angledLine([-178, myVar], %) // select for horizontal constraint 6
  |> yLine(myVar, %) // select for vertical constraint 6
  |> angledLineOfXLength([237, 1.05], %) // select for horizontal constraint 7
  |> yLine(-1.11, %) // select for vertical constraint 7
  |> angledLineOfXLength([194, myVar], %) // select for horizontal constraint 8
  |> yLine(-myVar, %) // select for vertical constraint 8
  |> angledLineToX([202, -10.92], %) // select for horizontal constraint 9
  |> yLineTo(7.68, %) // select for vertical constraint 9
  |> angledLineToX([333, myVar3], %) // select for horizontal constraint 10
  |> yLineTo(myVar, %) // select for vertical constraint 10
show(part001)`
    const ast = parser_wasm(inputScript)
    const selectionRanges: Selections['codeBasedSelections'] = inputScript
      .split('\n')
      .filter((ln) => ln.includes('// select for vertical constraint'))
      .map((ln) => {
        const comment = ln.split('//')[1]
        const start = inputScript.indexOf('//' + comment) - 7
        return {
          type: 'default',
          range: [start, start],
        }
      })

    const programMemory = await enginelessExecutor(ast)
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges),
      ast,
      'vertical'
    )

    const newAst = transformAstSketchLines({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      programMemory,
      referenceSegName: '',
    })?.modifiedAst
    const newCode = recast(newAst)
    expect(newCode).toBe(expectModifiedScript)
  })
})

describe('testing transformAstForSketchLines for vertical and horizontal distance constraints', () => {
  describe('testing setHorzDistance for line', () => {
    const inputScript = `const myVar = 1
const part001 = startSketchAt([0, 0])
  |> line([0.31, 1.67], %) // base selection
  |> line([0.45, 1.46], %)
  |> line([0.45, 1.46], %) // free
  |> line([myVar, 0.01], %) // xRelative
  |> line([0.7, myVar], %) // yRelative
show(part001)`
    it('testing for free to horizontal and vertical distance', async () => {
      const expectedHorizontalCode = await helperThing(
        inputScript,
        ['// base selection', '// free'],
        'setHorzDistance'
      )
      const expectedVerticalCode = await helperThing(
        inputScript,
        ['// base selection', '// free'],
        'setVertDistance'
      )
      expect(expectedHorizontalCode).toContain(
        `lineTo([segEndX('seg01', %) + 0.9, 4.59], %) // free`
      )
      expect(expectedVerticalCode).toContain(
        `lineTo([1.21, segEndY('seg01', %) + 2.92], %) // free`
      )
    })
    it('testing for xRelative to vertical distance', async () => {
      const expectedCode = await helperThing(
        inputScript,
        ['// base selection', '// xRelative'],
        'setVertDistance'
      )
      expect(expectedCode).toContain(`|> lineTo([
        lastSegX(%) + myVar,
        segEndY('seg01', %) + 2.93
    ], %) // xRelative`)
    })
    it('testing for yRelative to horizontal distance', async () => {
      const expectedCode = await helperThing(
        inputScript,
        ['// base selection', '// yRelative'],
        'setHorzDistance'
      )
      expect(expectedCode).toContain(`|> lineTo([
        segEndX('seg01', %) + 2.6,
        lastSegY(%) + myVar
    ], %) // yRelative`)
    })
  })
})

async function helperThing(
  inputScript: string,
  linesOfInterest: string[],
  constraint: ConstraintType
): Promise<string> {
  const ast = parser_wasm(inputScript)
  const selectionRanges: Selections['codeBasedSelections'] = inputScript
    .split('\n')
    .filter((ln) =>
      linesOfInterest.some((lineOfInterest) => ln.includes(lineOfInterest))
    )
    .map((ln) => {
      const comment = ln.split('//')[1]
      const start = inputScript.indexOf('//' + comment) - 7
      return {
        type: 'default',
        range: [start, start],
      }
    })

  const programMemory = await enginelessExecutor(ast)
  const transformInfos = getTransformInfos(
    makeSelections(selectionRanges.slice(1)),
    ast,
    constraint
  )

  const newAst = transformSecondarySketchLinesTagFirst({
    ast,
    selectionRanges: makeSelections(selectionRanges),
    transformInfos,
    programMemory,
  })?.modifiedAst
  return recast(newAst)
}

describe('testing getConstraintLevelFromSourceRange', () => {
  it('should devide up lines into free, partial and fully contrained', () => {
    const code = `const baseLength = 3
const baseThick = 1
const armThick = 0.5
const totalHeight = 4
const armAngle = 60
const totalLength = 9.74
const yDatum = 0

const baseThickHalf = baseThick / 2
const halfHeight = totalHeight / 2
const halfArmAngle = armAngle / 2

const part001 = startSketchAt([-0.01, -0.05])
  |> line([0.01, 0.94 + 0], %) // partial
  |> xLine(3.03, %) // partial
  |> angledLine({
  angle: halfArmAngle,
  length: 2.45,
  tag: 'seg01bing'
}, %) // partial
  |> xLine(4.4, %) // partial
  |> yLine(-1, %) // partial
  |> xLine(-4.2 + 0, %) // full
  |> angledLine([segAng('seg01bing', %) + 180, 1.79], %) // partial
  |> line([1.44, -0.74], %) // free
  |> xLine(3.36, %) // partial
  |> line([-1.49, 1.06], %) // free
  |> xLine(-3.43 + 0, %) // full
  |> angledLineOfXLength([243 + 0, 1.2 + 0], %) // full
show(part001)`
    const ast = parser_wasm(code)
    const constraintLevels: ReturnType<
      typeof getConstraintLevelFromSourceRange
    >[] = ['full', 'partial', 'free']
    constraintLevels.forEach((constraintLevel) => {
      const recursivelySeachCommentsAndCheckConstraintLevel = (
        str: string,
        offset: number = 0
      ): null => {
        const index = str.indexOf(`// ${constraintLevel}`, offset)
        if (index === -1) {
          return null
        }
        const offsetIndex = index - 7
        const expectedConstraintLevel = getConstraintLevelFromSourceRange(
          [offsetIndex, offsetIndex],
          ast
        )
        expect(expectedConstraintLevel).toBe(constraintLevel)
        return recursivelySeachCommentsAndCheckConstraintLevel(
          str,
          index + constraintLevel.length
        )
      }
      recursivelySeachCommentsAndCheckConstraintLevel(code)
    })
  })
})
