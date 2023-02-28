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

describe('transformAst', () => {
  const example = `const myVar = 3 // ln1
const part001 = startSketchAt([0, 0]) // ln2
  |> lineTo([1, 1], %) // ln3
  |> line({ to: [1.94, 3.82], tag: 'seg01' }, %) // ln4
  |> line([myVar, -1], %) // ln5
  |> line([-0.62, -1.54], %) // ln6
show(part001) // ln7`
  it('should transform ast', () => {
    const ast = abstractSyntaxTree(lexer(example))
    const selectionRanges: Ranges = [4, 5, 6].map((ln) => {
      const start = example.indexOf('// ln' + ln) - 7
      return [start, start]
    })
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

    expect(newCode).toBe(`const myVar = 3 // ln1
const part001 = startSketchAt([0, 0]) // ln2
  |> lineTo([1, 1], %) // ln3
  |> line({ to: [1.94, 3.82], tag: 'seg01' }, %) // ln4
  |> line([
  min(segLen('seg01', %), myVar),
  legLen(segLen('seg01', %), myVar)
], %) // ln5
  |> angledLine([248, segLen('seg01', %)], %) // ln6
show(part001) // ln7`)
  })
})
