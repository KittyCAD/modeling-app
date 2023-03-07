import { abstractSyntaxTree } from '../abstractSyntaxTree'
import { executor } from '../executor'
import { lexer } from '../tokeniser'
import {
  ConstraintType,
  getTransformInfos,
  transformAstSketchLines,
} from './sketchcombos'
import { recast } from '../recast'
import { initPromise } from '../rust'

beforeAll(() => initPromise)

// testing helper function
function testingSwapSketchFnCall({
  inputCode,
  callToSwap,
  constraintType,
}: {
  inputCode: string
  callToSwap: string
  constraintType: ConstraintType
}): {
  newCode: string
  originalRange: [number, number]
} {
  const startIndex = inputCode.indexOf(callToSwap)
  const range: [number, number] = [startIndex, startIndex + callToSwap.length]
  const tokens = lexer(inputCode)
  const ast = abstractSyntaxTree(tokens)
  const programMemory = executor(ast)
  const transformInfos = getTransformInfos([range], ast, constraintType)

  if (!transformInfos) throw new Error('nope')
  const { modifiedAst } = transformAstSketchLines({
    ast,
    programMemory,
    selectionRanges: [range],
    transformInfos,
    referenceSegName: '',
  })
  return {
    newCode: recast(modifiedAst),
    originalRange: range,
  }
}

describe('testing swaping out sketch calls with xLine/xLineTo', () => {
  const bigExampleArr = [
    `const part001 = startSketchAt([0, 0])`,
    `  |> lineTo({ to: [1, 1], tag: 'abc1' }, %)`,
    `  |> line({ to: [-2.04, -0.7], tag: 'abc2' }, %)`,
    `  |> angledLine({`,
    `  angle: 157,`,
    `  length: 1.69,`,
    `  tag: 'abc3'`,
    `}, %)`,
    `  |> angledLineOfXLength({`,
    `  angle: 217,`,
    `  length: 0.86,`,
    `  tag: 'abc4'`,
    `}, %)`,
    `  |> angledLineOfYLength({`,
    `  angle: 104,`,
    `  length: 1.58,`,
    `  tag: 'abc5'`,
    `}, %)`,
    `  |> angledLineToX({ angle: 55, to: -2.89, tag: 'abc6' }, %)`,
    `  |> angledLineToY({ angle: 330, to: 2.53, tag: 'abc7' }, %)`,
    `  |> xLine({ length: 1.47, tag: 'abc8' }, %)`,
    `  |> yLine({ length: 1.57, tag: 'abc9' }, %)`,
    `  |> xLineTo({ to: 1.49, tag: 'abc10' }, %)`,
    `  |> yLineTo({ to: 2.64, tag: 'abc11' }, %)`,
    `  |> lineTo([2.55, 3.58], %) // lineTo`,
    `  |> line([0.73, -0.75], %)`,
    `  |> angledLine([63, 1.38], %) // angledLine`,
    `  |> angledLineOfXLength([319, 1.15], %) // angledLineOfXLength`,
    `  |> angledLineOfYLength([50, 1.35], %) // angledLineOfYLength`,
    `  |> angledLineToX([291, 6.66], %) // angledLineToX`,
    `  |> angledLineToY([228, 2.14], %) // angledLineToY`,
    `  |> xLine(-1.33, %)`,
    `  |> yLine(-1.07, %)`,
    `  |> xLineTo(3.27, %)`,
    `  |> yLineTo(2.14, %)`,
    `show(part001)`,
  ]
  const bigExample = bigExampleArr.join('\n')
  it('line with tag converts to xLine', () => {
    const callToSwap = "line({ to: [-2.04, -0.7], tag: 'abc2' }, %)"
    const expectedLine = "xLine({ length: -2.04, tag: 'abc2' }, %)"
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap,
      constraintType: 'horizontal',
    })
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('line w/o tag converts to xLine', () => {
    const callToSwap = 'line([0.73, -0.75], %)'
    const expectedLine = 'xLine(0.73, %)'
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap,
      constraintType: 'horizontal',
    })
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('lineTo with tag converts to xLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: "lineTo({ to: [1, 1], tag: 'abc1' }, %)",
      constraintType: 'horizontal',
    })
    const expectedLine = "xLineTo({ to: 1, tag: 'abc1' }, %)"
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('lineTo w/o tag converts to xLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'lineTo([2.55, 3.58], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLineTo(2.55, %) // lineTo'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLine with tag converts to xLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: [
        `angledLine({`,
        `  angle: 157,`,
        `  length: 1.69,`,
        `  tag: 'abc3'`,
        `}, %)`,
      ].join('\n'),
      constraintType: 'horizontal',
    })
    const expectedLine = "xLine({ length: -1.56, tag: 'abc3' }, %)"
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLine w/o tag converts to xLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine([63, 1.38], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(0.63, %) // angledLine'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfXLength with tag converts to xLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: [
        `angledLineOfXLength({`,
        `  angle: 217,`,
        `  length: 0.86,`,
        `  tag: 'abc4'`,
        `}, %)`,
      ].join('\n'),
      constraintType: 'horizontal',
    })
    const expectedLine = "xLine({ length: -0.86, tag: 'abc4' }, %)"
    // hmm "-0.86" is correct since the angle is 104, but need to make sure this is compatiable `-myVar`
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfXLength w/o tag converts to xLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLineOfXLength([319, 1.15], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(1.15, %) // angledLineOfXLength'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfYLength with tag converts to yLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: [
        `angledLineOfYLength({`,
        `  angle: 104,`,
        `  length: 1.58,`,
        `  tag: 'abc5'`,
        `}, %)`,
      ].join('\n'),
      constraintType: 'vertical',
    })
    const expectedLine = "yLine({ length: 1.58, tag: 'abc5' }, %)"
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfYLength w/o tag converts to yLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLineOfYLength([50, 1.35], %)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(1.35, %) // angledLineOfYLength'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToX with tag converts to xLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: "angledLineToX({ angle: 55, to: -2.89, tag: 'abc6' }, %)",
      constraintType: 'horizontal',
    })
    const expectedLine = "xLineTo({ to: -2.89, tag: 'abc6' }, %)"
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToX w/o tag converts to xLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLineToX([291, 6.66], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLineTo(6.66, %) // angledLineToX'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToY with tag converts to yLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: "angledLineToY({ angle: 330, to: 2.53, tag: 'abc7' }, %)",
      constraintType: 'vertical',
    })
    const expectedLine = "yLineTo({ to: 2.53, tag: 'abc7' }, %)"
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToY w/o tag converts to yLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLineToY([228, 2.14], %)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLineTo(2.14, %) // angledLineToY'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
})

describe('testing swaping out sketch calls with xLine/xLineTo while keeping variable/identifiers intact', () => {
  const variablesExampleArr = [
    `const lineX = -1`,
    `const lineToX = -1.3`,
    `const angledLineAngle = 207`,
    `const angledLineOfXLengthX = 0.8`,
    `const angledLineOfYLengthY = 0.89`,
    `const angledLineToXx = -1.86`,
    `const angledLineToYy = -0.76`,
    `const part001 = startSketchAt([0, 0])`,
    `  |> rx(90, %)`,
    `  |> lineTo([1, 1], %)`,
    `  |> line([lineX, 2.13], %)`,
    `  |> lineTo([lineToX, 2.85], %)`,
    `  |> angledLine([angledLineAngle, 1.64], %)`,
    `  |> angledLineOfXLength([329, angledLineOfXLengthX], %)`,
    `  |> angledLineOfYLength([222, angledLineOfYLengthY], %)`,
    `  |> angledLineToX([330, angledLineToXx], %)`,
    `  |> angledLineToY([217, angledLineToYy], %)`,
    `  |> line([0.89, -0.1], %)`,
    `show(part001)`,
  ]
  const varExample = variablesExampleArr.join('\n')
  it('line keeps variable when converted to xLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'line([lineX, 2.13], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(lineX, %)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('lineTo keeps variable when converted to xLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'lineTo([lineToX, 2.85], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLineTo(lineToX, %)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfXLength keeps variable when converted to xLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLineOfXLength([329, angledLineOfXLengthX], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(angledLineOfXLengthX, %)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfYLength keeps variable when converted to yLine', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLineOfYLength([222, angledLineOfYLengthY], %)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(-angledLineOfYLengthY, %)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToX keeps variable when converted to xLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLineToX([330, angledLineToXx], %)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLineTo(angledLineToXx, %)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToY keeps variable when converted to yLineTo', () => {
    const { newCode, originalRange } = testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLineToY([217, angledLineToYy], %)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLineTo(angledLineToYy, %)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })

  it('trying to convert angledLineToY to xLineTo should not work because of the variable', () => {
    const illegalConvert = () =>
      testingSwapSketchFnCall({
        inputCode: varExample,
        callToSwap: 'angledLineToY([217, angledLineToYy], %)',
        constraintType: 'horizontal',
      })
    expect(illegalConvert).toThrowError()
  })
})
