import {
  changeSketchArguments,
  toolTipModification,
  addTagForSketchOnFace,
  getYComponent,
  getXComponent,
} from './sketch'
import { lexer } from '../tokeniser'
import {
  abstractSyntaxTree,
  getNodePathFromSourceRange,
} from '../abstractSyntaxTree'
import { recast } from '../recast'
import { executor } from '../executor'
import { initPromise } from '../rust'

beforeAll(async () => {
  await initPromise
})

const eachQuad: [number, [number, number]][] = [
  [-315, [1, 1]],
  [-225, [-1, 1]],
  [-135, [-1, -1]],
  [-45, [1, -1]],
  [45, [1, 1]],
  [135, [-1, 1]],
  [225, [-1, -1]],
  [315, [1, -1]],
  [405, [1, 1]],
  [495, [-1, 1]],
  [585, [-1, -1]],
  [675, [1, -1]],
]

describe('testing getYComponent', () => {
  it('should return the vertical component of a vector correctly when given angles in each quadrant (and with angles < 0, or > 360)', () => {
    const expected: [number, number][] = []
    const results: [number, number][] = []
    eachQuad.forEach(([angle, expectedResult]) => {
      results.push(
        getYComponent(angle, 1).map((a) => Math.round(a)) as [number, number]
      )
      expected.push(expectedResult)
    })
    expect(results).toEqual(expected)
  })
  it('return extreme values on the extremes', () => {
    let result: [number, number]
    result = getYComponent(0, 1)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)

    result = getYComponent(90, 1)
    expect(result[0]).toBe(1)
    expect(result[1]).toBeGreaterThan(100000)

    result = getYComponent(180, 1)
    expect(result[0]).toBe(-1)
    expect(result[1]).toBeCloseTo(0)

    result = getYComponent(270, 1)
    expect(result[0]).toBe(-1)
    expect(result[1]).toBeLessThan(100000)
  })
})

describe('testing getXComponent', () => {
  it('should return the horizontal component of a vector correctly when given angles in each quadrant (and with angles < 0, or > 360)', () => {
    const expected: [number, number][] = []
    const results: [number, number][] = []
    eachQuad.forEach(([angle, expectedResult]) => {
      results.push(
        getXComponent(angle, 1).map((a) => Math.round(a)) as [number, number]
      )
      expected.push(expectedResult)
    })
    expect(results).toEqual(expected)
  })
  it('return extreme values on the extremes', () => {
    let result: [number, number]
    result = getXComponent(0, 1)
    expect(result[0]).toBeGreaterThan(100000)
    expect(result[1]).toBe(1)

    result = getXComponent(90, 1)
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBe(1)

    result = getXComponent(180, 1)
    expect(result[0]).toBeLessThan(100000)
    expect(result[1]).toBe(1)

    result = getXComponent(270, 1)
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBe(-1)
  })
})

describe('testing changeSketchArguments', () => {
  const lineToChange = 'lineTo([-1.59, -1.54], %)'
  const lineAfterChange = 'lineTo([2, 3], %)'
  test('changeSketchArguments', () => {
    const genCode = (line: string) => `
const mySketch001 = startSketchAt([0, 0])
    |> ${line}
    |> lineTo([0.46, -5.82], %)
    |> rx(45, %)
show(mySketch001)`
    const code = genCode(lineToChange)
    const expectedCode = genCode(lineAfterChange)
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = executor(ast)
    const sourceStart = code.indexOf(lineToChange)
    const { modifiedAst } = changeSketchArguments(
      ast,
      programMemory,
      [sourceStart, sourceStart + lineToChange.length],
      [2, 3],
      {
        mode: 'sketch',
        sketchMode: 'sketchEdit',
        isTooltip: true,
        rotation: [0, 0, 0, 1],
        position: [0, 0, 0],
        pathToNode: ['body', 0, 'declarations', '0', 'init'],
      },
      [0, 0]
    )
    expect(recast(modifiedAst)).toBe(expectedCode)
  })
})

describe('testing toolTipModification', () => {
  const lineToChange = 'lineTo([-1.59, -1.54], %)'
  const lineAfterChange = 'lineTo([2, 3], %)'
  test('toolTipModification', () => {
    const code = `
const mySketch001 = startSketchAt([0, 0])
  |> rx(45, %)
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
show(mySketch001)`
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = executor(ast)
    const sourceStart = code.indexOf(lineToChange)
    const { modifiedAst } = toolTipModification(ast, programMemory, [2, 3], {
      mode: 'sketch',
      sketchMode: 'lineTo',
      isTooltip: true,
      rotation: [0, 0, 0, 1],
      position: [0, 0, 0],
      pathToNode: ['body', 0, 'declarations', '0', 'init'],
    })
    const expectedCode = `
const mySketch001 = startSketchAt([0, 0])
  |> rx(45, %)
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  |> lineTo([2, 3], %)
show(mySketch001)`
    expect(recast(modifiedAst)).toBe(expectedCode)
  })
})

describe('testing addTagForSketchOnFace', () => {
  it('needs to be in it', () => {
    const originalLine = 'lineTo([-1.59, -1.54], %)'
    const genCode = (line: string) => `
  const mySketch001 = startSketchAt([0, 0])
    |> rx(45, %)
    |> ${line}
    |> lineTo([0.46, -5.82], %)
  show(mySketch001)`
    const code = genCode(originalLine)
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = executor(ast)
    const sourceStart = code.indexOf(originalLine)
    const sourceRange: [number, number] = [
      sourceStart,
      sourceStart + originalLine.length,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
    const { modifiedAst } = addTagForSketchOnFace(
      {
        previousProgramMemory: programMemory,
        pathToNode,
        node: ast,
      },
      'lineTo'
    )
    const expectedCode = genCode(
      "lineTo({ to: [-1.59, -1.54], tag: 'seg01' }, %)"
    )
    expect(recast(modifiedAst)).toBe(expectedCode)
  })
})
