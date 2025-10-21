import { ARG_END, ARG_END_ABSOLUTE } from '@src/lang/constants'
import type { ToolTip } from '@src/lang/langHelpers'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import {
  fnNameToTooltip,
  getArgForEnd,
  isAbsoluteLine,
} from '@src/lang/std/sketch'
import type {
  ConstraintLevel,
  ConstraintType,
} from '@src/lang/std/sketchcombos'
import {
  getConstraintLevelFromSourceRange,
  getConstraintType,
  getTransformInfos,
  transformAstSketchLines,
  transformSecondarySketchLinesTagFirst,
} from '@src/lang/std/sketchcombos'
import { findKwArg, topLevelRange } from '@src/lang/util'
import type { Expr, Program } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { allLabels } from '@src/lib/utils'
import { findAngleLengthPair } from '@src/unitTestUtils'

import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeAll(async () => {
  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
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
    expect(helper(`angledLine(angle = 5deg, length = myVar)`)).toBe('length')
    expect(helper(`angledLine(angle = myVar, length = 5)`)).toBe('angle')
  })
  it('testing angledLineOfXLength', () => {
    expect(helper(`angledLine(angle = 5deg, lengthX = myVar)`)).toBe(
      'xRelative'
    )
    expect(helper(`angledLine(angle = myVar, lengthX = 5)`)).toBe('angle')
  })
  it('testing angledLineToX', () => {
    expect(helper(`angledLine(angle = 5deg, endAbsoluteX = myVar)`)).toBe(
      'xAbsolute'
    )
    expect(helper(`angledLine(angle = myVar, endAbsoluteX = 5)`)).toBe('angle')
  })
  it('testing angledLineOfYLength', () => {
    expect(helper(`angledLine(angle = 5deg, lengthY = myVar)`)).toBe(
      'yRelative'
    )
    expect(helper(`angledLine(angle = myVar, lengthY = 5)`)).toBe('angle')
  })
  it('testing angledLineToY', () => {
    expect(helper(`angledLine(angle = 5deg, endAbsoluteY = myVar)`)).toBe(
      'yAbsolute'
    )
    expect(helper(`angledLine(angle = myVar, endAbsoluteY = 5)`)).toBe('angle')
  })
  const helper2 = getConstraintTypeFromSourceHelper2
  it('testing xLine', () => {
    expect(helper2(`xLine(length = 5)`)).toBe('yRelative')
  })
  it('testing yLine', () => {
    expect(helper2(`yLine(length = 5)`)).toBe('xRelative')
  })
  it('testing xLineTo', () => {
    expect(helper2(`xLine(endAbsolute = 5)`)).toBe('yAbsolute')
  })
  it('testing yLineTo', () => {
    expect(helper2(`yLine(endAbsolute = 5)`)).toBe('xAbsolute')
  })
})

function getConstraintTypeFromSourceHelper(
  code: string
): ReturnType<typeof getConstraintType> | Error {
  const ast = assertParse(code, instanceInThisFile)

  const item = ast.body[0]
  if (item.type !== 'ExpressionStatement') {
    return new Error('must be expression')
  }
  const expr = item.expression
  switch (expr.type) {
    case 'CallExpressionKw': {
      const end = findKwArg(ARG_END, expr)
      const endAbsolute = findKwArg(ARG_END_ABSOLUTE, expr)
      const arg = end || endAbsolute || findAngleLengthPair(expr)
      if (!arg) {
        return new Error("couldn't find either end or endAbsolute in KW call")
      }
      const isAbsolute = endAbsolute ? true : false
      const fnName = fnNameToTooltip(allLabels(expr), expr.callee.name.name)
      if (err(fnName)) {
        return fnName
      }
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
      return new Error('must be a KCL function call, but it was ' + expr.type)
  }
}

function getConstraintTypeFromSourceHelper2(
  code: string
): ReturnType<typeof getConstraintType> | Error {
  const ast = assertParse(code, instanceInThisFile)

  const bodyItem = ast.body[0]
  if (bodyItem.type !== 'ExpressionStatement') {
    return new Error('was not a call expression')
  }
  const callExpr = bodyItem.expression
  let arg
  let isAbsolute = false
  switch (callExpr.type) {
    case 'CallExpressionKw':
      const argEnd = getArgForEnd(callExpr)
      if (err(argEnd)) {
        return argEnd
      }
      const maybeAbsolute = isAbsoluteLine(callExpr)
      if (err(maybeAbsolute)) {
        return maybeAbsolute
      } else {
        isAbsolute = maybeAbsolute
      }
      arg = argEnd.val
      break
    default:
      return new Error('was not a call expression')
  }
  const fnName = callExpr.callee.name.name as ToolTip
  const constraintType = getConstraintType(arg, fnName, isAbsolute)
  return constraintType
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
    const inputScript = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [5, 5])
  |> line(end = [-2, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`

    const expectedModifiedScript = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [5, 5], tag = $seg01)
  |> angledLine(angle = 112deg, length = segLen(seg01))
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
      const ast = assertParse(inputCode, instanceInThisFile)
      const execState = await enginelessExecutor(
        ast,
        undefined,
        undefined,
        rustContextInThisFile
      )
      const transformInfos = getTransformInfos(
        makeSelections(selectionRanges.slice(1)),
        ast,
        'equalLength',
        instanceInThisFile
      )

      const transformedSelection = makeSelections(selectionRanges)

      const newAst = transformSecondarySketchLinesTagFirst({
        ast,
        selectionRanges: transformedSelection,
        transformInfos,
        memVars: execState.variables,
        wasmInstance: instanceInThisFile,
      })
      if (err(newAst)) return Promise.reject(newAst)

      const newCode = recast(newAst.modifiedAst, instanceInThisFile)
      return newCode
    }

    it(`Should reorder when user selects first-to-last`, async () => {
      const ast = assertParse(inputScript, instanceInThisFile)
      const selectionRanges: Selections['graphSelections'] = [
        selectLine(inputScript, 3, ast),
        selectLine(inputScript, 4, ast),
      ]

      const newCode = await applyTransformation(inputScript, selectionRanges)
      expect(newCode).toBe(expectedModifiedScript)
    })

    it(`Should reorder when user selects last-to-first`, async () => {
      const ast = assertParse(inputScript, instanceInThisFile)
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
myAng = 40deg
myAng2 = 134deg
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 3.82]) // ln-should-get-tag
  |> line(endAbsolute = [2, 4]) // ln-lineTo-free should become angledLine
  |> angledLine(angle = 45deg, endAbsoluteX = 2.5) // ln-angledLineToX-free should become angledLine
  |> angledLine(angle = myAng, endAbsoluteX = 3) // ln-angledLineToX-angle should become angledLine
  |> angledLine(angle = 135deg, endAbsoluteY = 5) // ln-angledLineToY-free should become angledLine
  |> angledLine(angle = myAng2, endAbsoluteY = 4) // ln-angledLineToY-angle should become angledLine
  |> line(end = [myVar, 1]) // ln-should use legLen for y
  |> line(end = [myVar, -1]) // ln-legLen but negative
  |> line(end = [-0.62, -1.54]) // ln-should become angledLine
  |> angledLine(angle = myVar, length = 1.04) // ln-use segLen for second arg
  |> angledLine(angle = 45deg, length = 1.04) // ln-segLen again
  |> angledLine(angle = 54deg, lengthX = 2.35) // ln-should be transformed to angledLine
  |> angledLine(angle = 50deg, lengthX = myVar) // ln-should use legAngX to calculate angle
  |> angledLine(angle = 209deg, lengthX = myVar) // ln-same as above but should have + 180 to match original quadrant
  |> line(end = [1, myVar]) // ln-legLen again but yRelative
  |> line(end = [-1, myVar]) // ln-negative legLen yRelative
  |> angledLine(angle = 58deg, lengthY = 0.7) // ln-angledLineOfYLength-free should become angledLine
  |> angledLine(angle = myAng, lengthY = 0.7) // ln-angledLineOfYLength-angle should become angledLine
  |> angledLine(angle = 35deg, lengthY = myVar) // ln-angledLineOfYLength-yRelative use legAngY
  |> angledLine(angle = 305deg, lengthY = myVar) // ln-angledLineOfYLength-yRelative with angle > 90 use binExp
  |> xLine(length = 1.03) // ln-xLine-free should sub in segLen
  |> yLine(length = 1.04) // ln-yLine-free should sub in segLen
  |> xLine(endAbsolute = 30) // ln-xLineTo-free should convert to xLine
  |> yLine(endAbsolute = 20) // ln-yLineTo-free should convert to yLine
`
  const expectModifiedScript = `myVar = 3
myVar2 = 5
myVar3 = 6
myAng = 40deg
myAng2 = 134deg
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 3.82], tag = $seg01) // ln-should-get-tag
  |> angledLine(angle = 10deg, length = segLen(seg01)) // ln-lineTo-free should become angledLine
  |> angledLine(angle = 45deg, length = segLen(seg01)) // ln-angledLineToX-free should become angledLine
  |> angledLine(angle = myAng, length = segLen(seg01)) // ln-angledLineToX-angle should become angledLine
  |> angledLine(angle = 135deg, length = segLen(seg01)) // ln-angledLineToY-free should become angledLine
  |> angledLine(angle = myAng2, length = segLen(seg01)) // ln-angledLineToY-angle should become angledLine
  |> line(end = [
       min([segLen(seg01), myVar]),
       legLen(hypotenuse = segLen(seg01), leg = myVar)
     ]) // ln-should use legLen for y
  |> line(end = [
       min([segLen(seg01), myVar]),
       -legLen(hypotenuse = segLen(seg01), leg = myVar)
     ]) // ln-legLen but negative
  |> angledLine(angle = -112deg, length = segLen(seg01)) // ln-should become angledLine
  |> angledLine(angle = myVar, length = segLen(seg01)) // ln-use segLen for second arg
  |> angledLine(angle = 45deg, length = segLen(seg01)) // ln-segLen again
  |> angledLine(angle = 54deg, length = segLen(seg01)) // ln-should be transformed to angledLine
  |> angledLine(angle = legAngX(hypotenuse = segLen(seg01), leg = myVar), lengthX = min([segLen(seg01), myVar])) // ln-should use legAngX to calculate angle
  |> angledLine(angle = 180deg + legAngX(hypotenuse = segLen(seg01), leg = myVar), lengthX = min([segLen(seg01), myVar])) // ln-same as above but should have + 180 to match original quadrant
  |> line(end = [
       legLen(hypotenuse = segLen(seg01), leg = myVar),
       min([segLen(seg01), myVar])
     ]) // ln-legLen again but yRelative
  |> line(end = [
       -legLen(hypotenuse = segLen(seg01), leg = myVar),
       min([segLen(seg01), myVar])
     ]) // ln-negative legLen yRelative
  |> angledLine(angle = 58deg, length = segLen(seg01)) // ln-angledLineOfYLength-free should become angledLine
  |> angledLine(angle = myAng, length = segLen(seg01)) // ln-angledLineOfYLength-angle should become angledLine
  |> angledLine(angle = legAngY(hypotenuse = segLen(seg01), leg = myVar), lengthX = min([segLen(seg01), myVar])) // ln-angledLineOfYLength-yRelative use legAngY
  |> angledLine(angle = 270deg + legAngY(hypotenuse = segLen(seg01), leg = myVar), lengthX = min([segLen(seg01), myVar])) // ln-angledLineOfYLength-yRelative with angle > 90 use binExp
  |> xLine(length = segLen(seg01)) // ln-xLine-free should sub in segLen
  |> yLine(length = segLen(seg01)) // ln-yLine-free should sub in segLen
  |> xLine(length = segLen(seg01)) // ln-xLineTo-free should convert to xLine
  |> yLine(length = segLen(seg01)) // ln-yLineTo-free should convert to yLine
`
  it('should transform the ast', async () => {
    const ast = assertParse(inputScript, instanceInThisFile)

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

    const execState = await enginelessExecutor(
      ast,
      undefined,
      undefined,
      rustContextInThisFile
    )
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges.slice(1)),
      ast,
      'equalLength',
      instanceInThisFile
    )

    const newAst = transformSecondarySketchLinesTagFirst({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      memVars: execState.variables,
      wasmInstance: instanceInThisFile,
    })
    if (err(newAst)) return Promise.reject(newAst)

    const newCode = recast(newAst.modifiedAst, instanceInThisFile)
    expect(newCode).toBe(expectModifiedScript)
  })
})

describe('testing transformAstForSketchLines for vertical and horizontal constraint', () => {
  const inputScript = `myVar = 2
myVar2 = 12
myVar3 = -10
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  |> line(end = [-6.28, 1.4]) // select for horizontal constraint 1
  |> line(end = [-1.07, myVar]) // select for vertical constraint 1
  |> line(end = [myVar, 4.32]) // select for horizontal constraint 2
  |> line(end = [6.35, -1.12]) // select for vertical constraint 2
  |> line(endAbsolute = [5, 8]) // select for horizontal constraint 3
  |> line(endAbsolute = [3, 11]) // select for vertical constraint 3
  |> line(endAbsolute = [myVar2, 12.63]) // select for horizontal constraint 4
  |> line(endAbsolute = [4.08, myVar2]) // select for vertical constraint 4
  |> angledLine(angle = 156deg, length = 1.34) // select for horizontal constraint 5
  |> angledLine(angle = 103deg, length = 1.44) // select for vertical constraint 5
  |> angledLine(angle = -178deg, length = myVar) // select for horizontal constraint 6
  |> angledLine(angle = 129deg, length = myVar) // select for vertical constraint 6
  |> angledLine(angle = 237deg, lengthX = 1.05) // select for horizontal constraint 7
  |> angledLine(angle = 196deg, lengthY = 1.11) // select for vertical constraint 7
  |> angledLine(angle = 194deg, lengthX = myVar) // select for horizontal constraint 8
  |> angledLine(angle = 248deg, lengthY = myVar) // select for vertical constraint 8
  |> angledLine(angle = 202deg, endAbsoluteX = -10.92) // select for horizontal constraint 9
  |> angledLine(angle = 223deg, endAbsoluteY = 7.68) // select for vertical constraint 9
  |> angledLine(angle = 333deg, endAbsoluteX = myVar3) // select for horizontal constraint 10
  |> angledLine(angle = 301deg, endAbsoluteY = myVar) // select for vertical constraint 10
`
  it('should transform horizontal lines the ast', async () => {
    const expectModifiedScript = `myVar = 2
myVar2 = 12
myVar3 = -10
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  |> xLine(length = -6.28) // select for horizontal constraint 1
  |> line(end = [-1.07, myVar]) // select for vertical constraint 1
  |> xLine(length = myVar) // select for horizontal constraint 2
  |> line(end = [6.35, -1.12]) // select for vertical constraint 2
  |> xLine(endAbsolute = 5) // select for horizontal constraint 3
  |> line(endAbsolute = [3, 11]) // select for vertical constraint 3
  |> xLine(endAbsolute = myVar2) // select for horizontal constraint 4
  |> line(endAbsolute = [4.08, myVar2]) // select for vertical constraint 4
  |> xLine(length = -1.22) // select for horizontal constraint 5
  |> angledLine(angle = 103deg, length = 1.44) // select for vertical constraint 5
  |> xLine(length = -myVar) // select for horizontal constraint 6
  |> angledLine(angle = 129deg, length = myVar) // select for vertical constraint 6
  |> xLine(length = -1.05) // select for horizontal constraint 7
  |> angledLine(angle = 196deg, lengthY = 1.11) // select for vertical constraint 7
  |> xLine(length = -myVar) // select for horizontal constraint 8
  |> angledLine(angle = 248deg, lengthY = myVar) // select for vertical constraint 8
  |> xLine(endAbsolute = -10.92) // select for horizontal constraint 9
  |> angledLine(angle = 223deg, endAbsoluteY = 7.68) // select for vertical constraint 9
  |> xLine(endAbsolute = myVar3) // select for horizontal constraint 10
  |> angledLine(angle = 301deg, endAbsoluteY = myVar) // select for vertical constraint 10
`
    const ast = assertParse(inputScript, instanceInThisFile)

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

    const execState = await enginelessExecutor(
      ast,
      undefined,
      undefined,
      rustContextInThisFile
    )
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges),
      ast,
      'horizontal'
    )

    const newAst = transformAstSketchLines({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      memVars: execState.variables,
      referenceSegName: '',
    })
    if (err(newAst)) return Promise.reject(newAst)

    const newCode = recast(newAst.modifiedAst, instanceInThisFile)
    expect(newCode).toBe(expectModifiedScript)
  })
  it('should transform vertical lines the ast', async () => {
    const expectModifiedScript = `myVar = 2
myVar2 = 12
myVar3 = -10
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  |> line(end = [-6.28, 1.4]) // select for horizontal constraint 1
  |> yLine(length = myVar) // select for vertical constraint 1
  |> line(end = [myVar, 4.32]) // select for horizontal constraint 2
  |> yLine(length = -1.12) // select for vertical constraint 2
  |> line(endAbsolute = [5, 8]) // select for horizontal constraint 3
  |> yLine(endAbsolute = 11) // select for vertical constraint 3
  |> line(endAbsolute = [myVar2, 12.63]) // select for horizontal constraint 4
  |> yLine(endAbsolute = myVar2) // select for vertical constraint 4
  |> angledLine(angle = 156deg, length = 1.34) // select for horizontal constraint 5
  |> yLine(length = 1.4) // select for vertical constraint 5
  |> angledLine(angle = -178deg, length = myVar) // select for horizontal constraint 6
  |> yLine(length = myVar) // select for vertical constraint 6
  |> angledLine(angle = 237deg, lengthX = 1.05) // select for horizontal constraint 7
  |> yLine(length = -1.11) // select for vertical constraint 7
  |> angledLine(angle = 194deg, lengthX = myVar) // select for horizontal constraint 8
  |> yLine(length = -myVar) // select for vertical constraint 8
  |> angledLine(angle = 202deg, endAbsoluteX = -10.92) // select for horizontal constraint 9
  |> yLine(endAbsolute = 7.68) // select for vertical constraint 9
  |> angledLine(angle = 333deg, endAbsoluteX = myVar3) // select for horizontal constraint 10
  |> yLine(endAbsolute = myVar) // select for vertical constraint 10
`
    const ast = assertParse(inputScript, instanceInThisFile)

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

    const execState = await enginelessExecutor(
      ast,
      undefined,
      undefined,
      rustContextInThisFile
    )
    const transformInfos = getTransformInfos(
      makeSelections(selectionRanges),
      ast,
      'vertical'
    )

    const newAst = transformAstSketchLines({
      ast,
      selectionRanges: makeSelections(selectionRanges),
      transformInfos,
      memVars: execState.variables,
      referenceSegName: '',
    })
    if (err(newAst)) return Promise.reject(newAst)

    const newCode = recast(newAst.modifiedAst, instanceInThisFile)
    expect(newCode).toBe(expectModifiedScript)
  })
})

describe('testing transformAstForSketchLines for vertical and horizontal distance constraints', () => {
  describe('testing setHorzDistance for line', () => {
    const inputScript = `myVar = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
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
  const ast = assertParse(inputScript, instanceInThisFile)

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

  const execState = await enginelessExecutor(
    ast,
    undefined,
    undefined,
    rustContextInThisFile
  )
  const transformInfos = getTransformInfos(
    makeSelections(selectionRanges.slice(1)),
    ast,
    constraint
  )

  const newAst = transformSecondarySketchLinesTagFirst({
    ast,
    selectionRanges: makeSelections(selectionRanges),
    transformInfos,
    memVars: execState.variables,
  })

  if (err(newAst)) return Promise.reject(newAst)
  const recasted = recast(newAst.modifiedAst, instanceInThisFile)

  if (err(recasted)) return Promise.reject(recasted)
  return recasted
}

describe('testing getConstraintLevelFromSourceRange', () => {
  it('should divide up lines into free, partial and fully constrained', () => {
    const code = `baseLength = 3
baseThick = 1
armThick = 0.5
totalHeight = 4
armAngle = 60deg
totalLength = 9.74
yDatum = 0

baseThickHalf = baseThick / 2
halfHeight = totalHeight / 2
halfArmAngle = armAngle / 2

part001 = startSketchOn(XY)
  |> startProfile(at = [-0.01, -0.05])
  |> line(end = [0.01, 0.94 + 0]) // partial
  |> xLine(length = 3.03) // partial
  |> angledLine(angle = halfArmAngle, length = 2.45, tag = $seg01bing) // partial
  |> xLine(length = 4.4) // partial
  |> yLine(length = -1) // partial
  |> xLine(length = -4.2 + 0) // full
  |> angledLine(angle = segAng(seg01bing) + 180deg, length = 1.79) // partial
  |> line(end = [1.44, -0.74]) // free
  |> xLine(length = 3.36) // partial
  |> line(end = [1.49, 1.06]) // free
  |> xLine(length = -3.43 + 0) // full
  |> angledLine(angle = 243deg + 0, lengthX = 1.2 + 0) // full`
    const ast = assertParse(code, instanceInThisFile)
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
