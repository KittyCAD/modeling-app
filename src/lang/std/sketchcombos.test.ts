import { abstractSyntaxTree, Value } from '../abstractSyntaxTree'
import { lexer } from '../tokeniser'
import { getConstraintType } from './sketchcombos'
import { initPromise } from '../rust'
import { TooTip } from '../../useStore'

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
