import {
  assertParse,
  Expr,
  recast,
  initPromise,
  Program,
  topLevelRange,
} from '../wasm'
import {
  getConstraintType,
  getTransformInfos,
  transformAstSketchLines,
  transformSecondarySketchLinesTagFirst,
  ConstraintType,
  ConstraintLevel,
  getConstraintLevelFromSourceRange,
} from './sketchcombos'
import { ToolTip } from 'lang/langHelpers'
import { Selections, Selection } from 'lib/selections'
import { err } from 'lib/trap'
import { enginelessExecutor } from '../../lib/testHelpers'
import { codeRefFromRange } from './artifactGraph'
import { findKwArg } from 'lang/util'
import { ARG_END, ARG_END_ABSOLUTE } from './sketch'

beforeAll(async () => {
  await initPromise
})

describe('testing getConstraintType', () => {
  const helper = getConstraintTypeFromSourceHelper
  it('testing line', () => {
    expect(helper(`line(end = [5, myVar])`)).toBe('yRelative')
    expect(helper(`line(end = [myVar, 5])`)).toBe('xRelative')
  })
  it('testing lineTo', () => {
    expect(helper(`line(endAbsolute = [5, myVar])`)).toBe('yAbsolute')
    expect(helper(`line(endAbsolute = [myVar, 5])`)).toBe('xAbsolute')
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
): ReturnType<typeof getConstraintType> | Error {
  const ast = assertParse(code)

  const item = ast.body[0]
  if (item.type !== 'ExpressionStatement') {
    return new Error('must be expression')
  }
  const expr = item.expression
  switch (expr.type) {
    case 'CallExpression': {
      const arg = expr.arguments[0]
      if (arg.type !== 'ArrayExpression') {
        return new Error(
          'expected first arg to be array but it was ' + arg.type
        )
      }
      const args = arg.elements as [Expr, Expr]
      const fnName = expr.callee.name as ToolTip
      return getConstraintType(args, fnName, false)
    }
    case 'CallExpressionKw': {
      const end = findKwArg(ARG_END, expr)
      const endAbsolute = findKwArg(ARG_END_ABSOLUTE, expr)
      const arg = end || endAbsolute
      if (!arg) {
        return new Error("couldn't find either end or endAbsolute in KW call")
      }
      const isAbsolute = endAbsolute ? true : false
      const fnName = expr.callee.name as ToolTip
      if (arg.type === 'ArrayExpression') {
        return getConstraintType(
          arg.elements as [Expr, Expr],
          fnName,
          isAbsolute
        )
      }
      return new Error('arg did not have any key named elements')
    }
    default:
      return new Error(
        'must be a call (positional or keyword but it was) ' + expr.type
      )
  }
}

function getConstraintTypeFromSourceHelper2(
  code: string
): ReturnType<typeof getConstraintType> | Error {
  const ast = assertParse(code)

  const arg = (ast.body[0] as any).expression.arguments[0] as Expr
  const fnName = (ast.body[0] as any).expression.callee.name as ToolTip
  return getConstraintType(arg, fnName, false)
}

function makeSelections(
  graphSelections: Selections['graphSelections']
): Selections {
  return {
    graphSelections: graphSelections,
    otherSelections: [],
  }
}

describe('testing transformAstForSketchLines for equal length constraint', () => {
  describe(`should always reorder selections to have the base selection first`, () => {
    const inputScript = `sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line(end = [5, 5])
  |> line(end = [-2, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`

    const expectedModifiedScript = `sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line(end = [5, 5], tag = $seg01)
  |> angledLine([112, segLen(seg01)], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`

    const selectLine = (
      script: string,
      lineNumber: number,
      ast: Program
    ): Selection => {
      const lines = script.split('\n')
      const codeBeforeLine = lines.slice(0, lineNumber).join('\n').length
      const line = lines.find((_, i) => i === lineNumber)
      if (!line) {
        throw new Error(
          `line index ${lineNumber} not found in test sample, friend`
        )
      }
      const start = codeBeforeLine + line.indexOf('|> ' + 5)
      const range = topLevelRange(start, start)
      return {
        codeRef: codeRefFromRange(range, ast),
      }
    }

    async function applyTransformation(
      inputCode: string,
      selectionRanges: Selections['graphSelections']
    ) {
      const ast = assertParse(inputCode)
      const execState = await enginelessExecutor(ast)
      const transformInfos = getTransformInfos(
        makeSelections(selectionRanges.slice(1)),
        ast,
        'equalLength'
      )

      const transformedSelection = makeSelections(selectionRanges)

      const newAst = transformSecondarySketchLinesTagFirst({
        ast,
        selectionRanges: transformedSelection,
        transformInfos,
        programMemory: execState.memory,
      })
      if (err(newAst)) return Promise.reject(newAst)

      const newCode = recast(newAst.modifiedAst)
      return newCode
    }

    it(`Should reorder when user selects first-to-last`, async () => {
      const ast = assertParse(inputScript)
      const selectionRanges: Selections['graphSelections'] = [
        selectLine(inputScript, 3, ast),
        selectLine(inputScript, 4, ast),
      ]

      const newCode = await applyTransformation(inputScript, selectionRanges)
      expect(newCode).toBe(expectedModifiedScript)
    })

    it(`Should reorder when user selects last-to-first`, async () => {
      const ast = assertParse(inputScript)
      const selectionRanges: Selections['graphSelections'] = [
        selectLine(inputScript, 4, ast),
        selectLine(inputScript, 3, ast),
      ]

      const newCode = await applyTransformation(inputScript, selectionRanges)
      expect(newCode).toBe(expectedModifiedScript)
    })
  })
  const inputScript = `myVar = 3
myVar2 = 5
myVar3 = 6
myAng = 40
myAng2 = 134
part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(end = [1, 3.82]) // ln-should-get-tag
  |> line(endAbsolute = [myVar, 1]) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> line(endAbsolute = [1, myVar]) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
  |> line(endAbsolute = [2, 4]) // ln-lineTo-free should become angledLine
  |> angledLineToX([45, 2.5], %) // ln-angledLineToX-free should become angledLine
  |> angledLineToX([myAng, 3], %) // ln-angledLineToX-angle should become angledLine
  |> angledLineToX([45, myVar2], %) // ln-angledLineToX-xAbsolute should use angleToMatchLengthX to get angle
  |> angledLineToY([135, 5], %) // ln-angledLineToY-free should become angledLine
  |> angledLineToY([myAng2, 4], %) // ln-angledLineToY-angle should become angledLine
  |> angledLineToY([45, myVar3], %) // ln-angledLineToY-yAbsolute should use angleToMatchLengthY to get angle
  |> line(end = [myVar, 1]) // ln-should use legLen for y
  |> line(end = [myVar, -1]) // ln-legLen but negative
  |> line(end = [-0.62, -1.54]) // ln-should become angledLine
  |> angledLine([myVar, 1.04], %) // ln-use segLen for second arg
  |> angledLine([45, 1.04], %) // ln-segLen again
  |> angledLineOfXLength([54, 2.35], %) // ln-should be transformed to angledLine
  |> angledLineOfXLength([50, myVar], %) // ln-should use legAngX to calculate angle
  |> angledLineOfXLength([209, myVar], %) // ln-same as above but should have + 180 to match original quadrant
  |> line(end = [1, myVar]) // ln-legLen again but yRelative
  |> line(end = [-1, myVar]) // ln-negative legLen yRelative
  |> angledLineOfYLength([58, 0.7], %) // ln-angledLineOfYLength-free should become angledLine
  |> angledLineOfYLength([myAng, 0.7], %) // ln-angledLineOfYLength-angle should become angledLine
  |> angledLineOfYLength([35, myVar], %) // ln-angledLineOfYLength-yRelative use legAngY
  |> angledLineOfYLength([305, myVar], %) // ln-angledLineOfYLength-yRelative with angle > 90 use binExp
  |> xLine(1.03, %) // ln-xLine-free should sub in segLen
  |> yLine(1.04, %) // ln-yLine-free should sub in segLen
  |> xLineTo(30, %) // ln-xLineTo-free should convert to xLine
  |> yLineTo(20, %) // ln-yLineTo-free should convert to yLine
`
  const expectModifiedScript = `myVar = 3
myVar2 = 5
myVar3 = 6
myAng = 40
myAng2 = 134
part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(end = [1, 3.82], tag = $seg01) // ln-should-get-tag
  |> angledLineToX([
       -angleToMatchLengthX(seg01, myVar, %),
       myVar
     ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> angledLineToY([
       -angleToMatchLengthY(seg01, myVar, %),
       myVar
     ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
  |> angledLine([45, segLen(seg01)], %) // ln-lineTo-free should become angledLine
  |> angledLine([45, segLen(seg01)], %) // ln-angledLineToX-free should become angledLine
  |> angledLine([myAng, segLen(seg01)], %) // ln-angledLineToX-angle should become angledLine
  |> angledLineToX([
       angleToMatchLengthX(seg01, myVar2, %),
       myVar2
     ], %) // ln-angledLineToX-xAbsolute should use angleToMatchLengthX to get angle
  |> angledLine([-45, segLen(seg01)], %) // ln-angledLineToY-free should become angledLine
  |> angledLine([myAng2, segLen(seg01)], %) // ln-angledLineToY-angle should become angledLine
  |> angledLineToY([
       angleToMatchLengthY(seg01, myVar3, %),
       myVar3
     ], %) // ln-angledLineToY-yAbsolute should use angleToMatchLengthY to get angle
  |> line(end = [
       min(segLen(seg01), myVar),
       legLen(segLen(seg01), myVar)
     ]) // ln-should use legLen for y
  |> line(end = [
       min(segLen(seg01), myVar),
       -legLen(segLen(seg01), myVar)
     ]) // ln-legLen but negative
  |> angledLine([-112, segLen(seg01)], %) // ln-should become angledLine
  |> angledLine([myVar, segLen(seg01)], %) // ln-use segLen for second arg
  |> angledLine([45, segLen(seg01)], %) // ln-segLen again
  |> angledLine([54, segLen(seg01)], %) // ln-should be transformed to angledLine
  |> angledLineOfXLength([
       legAngX(segLen(seg01), myVar),
       min(segLen(seg01), myVar)
     ], %) // ln-should use legAngX to calculate angle
  |> angledLineOfXLength([
       180 + legAngX(segLen(seg01), myVar),
       min(segLen(seg01), myVar)
     ], %) // ln-same as above but should have + 180 to match original quadrant
  |> line(end = [
       legLen(segLen(seg01), myVar),
       min(segLen(seg01), myVar)
     ]) // ln-legLen again but yRelative
  |> line(end = [
       -legLen(segLen(seg01), myVar),
       min(segLen(seg01), myVar)
     ]) // ln-negative legLen yRelative
  |> angledLine([58, segLen(seg01)], %) // ln-angledLineOfYLength-free should become angledLine
  |> angledLine([myAng, segLen(seg01)], %) // ln-angledLineOfYLength-angle should become angledLine
  |> angledLineOfXLength([
       legAngY(segLen(seg01), myVar),
       min(segLen(seg01), myVar)
     ], %) // ln-angledLineOfYLength-yRelative use legAngY
  |> angledLineOfXLength([
       270 + legAngY(segLen(seg01), myVar),
       min(segLen(seg01), myVar)
     ], %) // ln-angledLineOfYLength-yRelative with angle > 90 use binExp
  |> xLine(segLen(seg01), %) // ln-xLine-free should sub in segLen
  |> yLine(segLen(seg01), %) // ln-yLine-free should sub in segLen
  |> xLine(segLen(seg01), %) // ln-xLineTo-free should convert to xLine
  |> yLine(segLen(seg01), %) // ln-yLineTo-free should convert to yLine
`
  it('should transform the ast', async () => {
    const ast = assertParse(inputScript)

    const selectionRanges: Selections['graphSelections'] = inputScript
      .split('\n')
      .filter((ln) => ln.includes('//'))
      .map((ln) => {
        const comment = ln.split('//')[1]
        const start = inputScript.indexOf('//' + comment) - 7
        return {
          codeRef: codeRefFromRange(topLevelRange(start, start), ast),
        }
      })

    const execState = await enginelessExecutor(ast)
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges.slice(1)),
      ast,
      'equalLength'
    )

    const newAst = transformSecondarySketchLinesTagFirst({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      programMemory: execState.memory,
    })
    if (err(newAst)) return Promise.reject(newAst)

    const newCode = recast(newAst.modifiedAst)
    expect(newCode).toBe(expectModifiedScript)
  })
})

describe('testing transformAstForSketchLines for vertical and horizontal constraint', () => {
  const inputScript = `myVar = 2
myVar2 = 12
myVar3 = -10
part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [1, 1])
  |> line(end = [-6.28, 1.4]) // select for horizontal constraint 1
  |> line(end = [-1.07, myVar]) // select for vertical constraint 1
  |> line(end = [myVar, 4.32]) // select for horizontal constraint 2
  |> line(end = [6.35, -1.12]) // select for vertical constraint 2
  |> line(endAbsolute = [5, 8]) // select for horizontal constraint 3
  |> line(endAbsolute = [3, 11]) // select for vertical constraint 3
  |> line(endAbsolute = [myVar2, 12.63]) // select for horizontal constraint 4
  |> line(endAbsolute = [4.08, myVar2]) // select for vertical constraint 4
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
`
  it('should transform horizontal lines the ast', async () => {
    const expectModifiedScript = `myVar = 2
myVar2 = 12
myVar3 = -10
part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [1, 1])
  |> xLine(-6.28, %) // select for horizontal constraint 1
  |> line(end = [-1.07, myVar]) // select for vertical constraint 1
  |> xLine(myVar, %) // select for horizontal constraint 2
  |> line(end = [6.35, -1.12]) // select for vertical constraint 2
  |> xLineTo(5, %) // select for horizontal constraint 3
  |> line(endAbsolute = [3, 11]) // select for vertical constraint 3
  |> xLineTo(myVar2, %) // select for horizontal constraint 4
  |> line(endAbsolute = [4.08, myVar2]) // select for vertical constraint 4
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
`
    const ast = assertParse(inputScript)

    const selectionRanges: Selections['graphSelections'] = inputScript
      .split('\n')
      .filter((ln) => ln.includes('// select for horizontal constraint'))
      .map((ln) => {
        const comment = ln.split('//')[1]
        const start = inputScript.indexOf('//' + comment) - 7
        return {
          codeRef: codeRefFromRange(topLevelRange(start, start), ast),
        }
      })

    const execState = await enginelessExecutor(ast)
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges),
      ast,
      'horizontal'
    )

    const newAst = transformAstSketchLines({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      programMemory: execState.memory,
      referenceSegName: '',
    })
    if (err(newAst)) return Promise.reject(newAst)

    const newCode = recast(newAst.modifiedAst)
    expect(newCode).toBe(expectModifiedScript)
  })
  it('should transform vertical lines the ast', async () => {
    const expectModifiedScript = `myVar = 2
myVar2 = 12
myVar3 = -10
part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [1, 1])
  |> line(end = [-6.28, 1.4]) // select for horizontal constraint 1
  |> yLine(myVar, %) // select for vertical constraint 1
  |> line(end = [myVar, 4.32]) // select for horizontal constraint 2
  |> yLine(-1.12, %) // select for vertical constraint 2
  |> line(endAbsolute = [5, 8]) // select for horizontal constraint 3
  |> yLineTo(11, %) // select for vertical constraint 3
  |> line(endAbsolute = [myVar2, 12.63]) // select for horizontal constraint 4
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
`
    const ast = assertParse(inputScript)

    const selectionRanges: Selections['graphSelections'] = inputScript
      .split('\n')
      .filter((ln) => ln.includes('// select for vertical constraint'))
      .map((ln) => {
        const comment = ln.split('//')[1]
        const start = inputScript.indexOf('//' + comment) - 7
        return {
          codeRef: codeRefFromRange(topLevelRange(start, start), ast),
        }
      })

    const execState = await enginelessExecutor(ast)
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges),
      ast,
      'vertical'
    )

    const newAst = transformAstSketchLines({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      programMemory: execState.memory,
      referenceSegName: '',
    })
    if (err(newAst)) return Promise.reject(newAst)

    const newCode = recast(newAst.modifiedAst)
    expect(newCode).toBe(expectModifiedScript)
  })
})

describe('testing transformAstForSketchLines for vertical and horizontal distance constraints', () => {
  describe('testing setHorzDistance for line', () => {
    const inputScript = `myVar = 1
part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(end = [0.31, 1.67]) // base selection
  |> line(end = [0.45, 1.46])
  |> line(end = [0.45, 1.46]) // free
  |> line(end = [myVar, 0.01]) // xRelative
  |> line(end = [0.7, myVar]) // yRelative
`
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
        `line(endAbsolute = [segEndX(seg01) + 0.9, 4.59]) // free`
      )
      expect(expectedVerticalCode).toContain(
        `line(endAbsolute = [1.21, segEndY(seg01) + 2.92]) // free`
      )
    })
    it('testing for xRelative to vertical distance', async () => {
      const expectedCode = await helperThing(
        inputScript,
        ['// base selection', '// xRelative'],
        'setVertDistance'
      )
      expect(expectedCode).toContain(`|> line(endAbsolute = [
       lastSegX(%) + myVar,
       segEndY(seg01) + 2.93
     ]) // xRelative`)
    })
    it('testing for yRelative to horizontal distance', async () => {
      const expectedCode = await helperThing(
        inputScript,
        ['// base selection', '// yRelative'],
        'setHorzDistance'
      )
      expect(expectedCode).toContain(`|> line(endAbsolute = [
       segEndX(seg01) + 2.6,
       lastSegY(%) + myVar
     ]) // yRelative`)
    })
  })
})

async function helperThing(
  inputScript: string,
  linesOfInterest: string[],
  constraint: ConstraintType
): Promise<string> {
  const ast = assertParse(inputScript)

  const selectionRanges: Selections['graphSelections'] = inputScript
    .split('\n')
    .filter((ln) =>
      linesOfInterest.some((lineOfInterest) => ln.includes(lineOfInterest))
    )
    .map((ln) => {
      const comment = ln.split('//')[1]
      const start = inputScript.indexOf('//' + comment) - 7
      return {
        codeRef: codeRefFromRange(topLevelRange(start, start), ast),
      }
    })

  const execState = await enginelessExecutor(ast)
  const transformInfos = getTransformInfos(
    makeSelections(selectionRanges.slice(1)),
    ast,
    constraint
  )

  const newAst = transformSecondarySketchLinesTagFirst({
    ast,
    selectionRanges: makeSelections(selectionRanges),
    transformInfos,
    programMemory: execState.memory,
  })

  if (err(newAst)) return Promise.reject(newAst)
  const recasted = recast(newAst.modifiedAst)

  if (err(recasted)) return Promise.reject(recasted)
  return recasted
}

describe('testing getConstraintLevelFromSourceRange', () => {
  it('should divide up lines into free, partial and fully contrained', () => {
    const code = `baseLength = 3
baseThick = 1
armThick = 0.5
totalHeight = 4
armAngle = 60
totalLength = 9.74
yDatum = 0

baseThickHalf = baseThick / 2
halfHeight = totalHeight / 2
halfArmAngle = armAngle / 2

part001 = startSketchOn('XY')
  |> startProfileAt([-0.01, -0.05], %)
  |> line(end = [0.01, 0.94 + 0]) // partial
  |> xLine(3.03, %) // partial
  |> angledLine({
  angle: halfArmAngle,
  length: 2.45,
}, %, $seg01bing) // partial
  |> xLine(4.4, %) // partial
  |> yLine(-1, %) // partial
  |> xLine(-4.2 + 0, %) // full
  |> angledLine([segAng(seg01bing) + 180, 1.79], %) // partial
  |> line(end = [1.44, -0.74]) // free
  |> xLine(3.36, %) // partial
  |> line(end = [1.49, 1.06]) // free
  |> xLine(-3.43 + 0, %) // full
  |> angledLineOfXLength([243 + 0, 1.2 + 0], %) // full`
    const ast = assertParse(code)
    const constraintLevels: ConstraintLevel[] = ['full', 'partial', 'free']
    constraintLevels.forEach((constraintLevel) => {
      const recursivelySearchCommentsAndCheckConstraintLevel = (
        str: string,
        offset: number = 0
      ): null => {
        const index = str.indexOf(`// ${constraintLevel}`, offset)
        if (index === -1) {
          return null
        }
        const offsetIndex = index - 7
        const expectedConstraintLevel = getConstraintLevelFromSourceRange(
          topLevelRange(offsetIndex, offsetIndex),
          ast
        )
        if (err(expectedConstraintLevel)) {
          throw expectedConstraintLevel
        }
        expect(expectedConstraintLevel.level).toBe(constraintLevel)
        return recursivelySearchCommentsAndCheckConstraintLevel(
          str,
          index + constraintLevel.length
        )
      }
      recursivelySearchCommentsAndCheckConstraintLevel(code)
    })
  })
})
