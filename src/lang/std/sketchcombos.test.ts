import { abstractSyntaxTree, Value } from '../abstractSyntaxTree'
import { lexer } from '../tokeniser'
import {
  getConstraintType,
  getTransformInfos,
  transformAstForSketchLines,
} from './sketchcombos'
import { initPromise } from '../rust'
import { Ranges, TooTip } from '../../useStore'
import { executor } from '../../lang/executor'
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
  it('testing xLine', () => {
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
  const ast = abstractSyntaxTree(lexer(code))
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
  const ast = abstractSyntaxTree(lexer(code))
  const arg = (ast.body[0] as any).expression.arguments[0] as Value
  const fnName = (ast.body[0] as any).expression.callee.name as TooTip
  return getConstraintType(arg, fnName)
}

describe('testing transformAstForSketchLines for equal length constraint', () => {
  const example = `const myVar = 3
const myAng = 40
const part001 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  |> line([1.94, 3.82], %) // ln-should-get-tag
  |> line([myVar, 1], %) // ln-should use legLen for y
  |> line([myVar, -1], %) // ln-legLen but negative
  |> line([-0.62, -1.54], %) // ln-should become angledLine
  |> angledLine([myVar, 1.04], %) // ln-use segLen for secound arg
  |> angledLine([45, 1.04], %) // ln-segLen again
  |> angledLineOfXLength([50, 2.5], %) // ln-should be transformed to angledLine
  |> angledLineOfXLength([50, myVar], %) // ln-should use legAngX to calculate angle
  |> angledLineOfXLength([230, myVar], %) // ln-same as above but should have + 180 to match original quadrant
  |> line([1, myVar], %) // ln-legLen again but yRelative
  |> line([-1, myVar], %) // ln-negative legLen yRelative
  |> angledLineOfYLength([58, 0.7], %) // ln-angledLineOfYLength-free should become angledLine
  |> angledLineOfYLength([myAng, 0.7], %) // ln-angledLineOfYLength-angle should become angledLine
  |> angledLineOfYLength([35, myVar], %) // ln-angledLineOfYLength-yRelative use legAngY
  |> angledLineOfYLength([305, myVar], %) // ln-angledLineOfYLength-yRelative with angle > 90 use binExp
show(part001)`
  it('It should transform the ast', () => {
    const ast = abstractSyntaxTree(lexer(example))
    const selectionRanges = example
      .split('\n')
      .filter((ln) => ln.includes('//'))
      .map((ln) => {
        const comment = ln.split('//')[1]
        const start = example.indexOf('//' + comment) - 7
        return [start, start]
      }) as [number, number][]

    const programMemory = executor(ast)
    const transformInfos = getTransformInfos(
      selectionRanges,
      ast,
      'equalLength'
    )

    const newAst = transformAstForSketchLines({
      ast,
      selectionRanges,
      transformInfos,
      programMemory,
    })?.modifiedAst
    const newCode = recast(newAst)
    // console.log(newCode)

    expect(newCode).toBe(`const myVar = 3
const myAng = 40
const part001 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  |> line({ to: [1.94, 3.82], tag: 'seg01' }, %) // ln-should-get-tag
  |> line([
    min(segLen('seg01', %), myVar),
    legLen(segLen('seg01', %), myVar)
  ], %) // ln-should use legLen for y
  |> line([
    min(segLen('seg01', %), myVar),
    -legLen(segLen('seg01', %), myVar)
  ], %) // ln-legLen but negative
  |> angledLine([248, segLen('seg01', %)], %) // ln-should become angledLine
  |> angledLine([myVar, segLen('seg01', %)], %) // ln-use segLen for secound arg
  |> angledLine([45, segLen('seg01', %)], %) // ln-segLen again
  |> angledLine([50, segLen('seg01', %)], %) // ln-should be transformed to angledLine
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
show(part001)`)
  })
})
