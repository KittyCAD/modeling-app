import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { getSketchSegmentFromSourceRange } from '@src/lang/std/sketchConstraints'
import type { ConstraintType } from '@src/lang/std/sketchcombos'
import {
  getTransformInfos,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import { topLevelRange } from '@src/lang/util'
import type { Sketch, SourceRange } from '@src/lang/wasm'
import {
  assertParse,
  initPromise,
  recast,
  sketchFromKclValue,
} from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'

beforeAll(async () => {
  await initPromise
})

// testing helper function
async function testingSwapSketchFnCall({
  inputCode,
  callToSwap,
  constraintType,
}: {
  inputCode: string
  callToSwap: string
  constraintType: ConstraintType
}): Promise<{
  newCode: string
  originalRange: SourceRange
}> {
  const startIndex = inputCode.indexOf(callToSwap)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  const range = topLevelRange(startIndex, startIndex + callToSwap.length)
  const ast = assertParse(inputCode)

  const execState = await enginelessExecutor(ast)
  const selections = {
    graphSelections: [
      {
        codeRef: codeRefFromRange(range, ast),
      },
    ],
    otherSelections: [],
  }

  const transformInfos = getTransformInfos(selections, ast, constraintType)

  if (!transformInfos)
    return Promise.reject(new Error('transformInfos undefined'))
  const ast2 = transformAstSketchLines({
    ast,
    memVars: execState.variables,
    selectionRanges: selections,
    transformInfos,
    referenceSegName: '',
  })
  if (err(ast2)) return Promise.reject(ast2)

  const newCode = recast(ast2.modifiedAst)
  if (err(newCode)) return Promise.reject(newCode)

  return {
    newCode,
    originalRange: range,
  }
}

describe('testing swapping out sketch calls with xLine/xLineTo', () => {
  const bigExampleArr = [
    `part001 = startSketchOn(XY)`,
    `  |> startProfileAt([0, 0], %)`,
    `  |> line(endAbsolute = [1, 1], tag = $abc1)`,
    `  |> line(end = [-2.04, -0.7], tag = $abc2)`,
    `  |> angledLine(angle = 157, length = 1.69, tag = $abc3)`,
    `  |> angledLine(angle = 217, lengthX = 0.86, tag = $abc4)`,
    `  |> angledLine(angle = 104, lengthY = 1.58, tag = $abc5)`,
    `  |> angledLine(angle = 55, endAbsoluteX = -2.89, tag = $abc6)`,
    `  |> angledLine(angle = 330, endAbsoluteY = 2.53, tag = $abc7)`,
    `  |> xLine(length = 1.47, tag = $abc8)`,
    `  |> yLine(length = 1.57, tag = $abc9)`,
    `  |> xLine(endAbsolute = 1.49, tag = $abc10)`,
    `  |> yLine(endAbsolute = 2.64, tag = $abc11)`,
    `  |> line(endAbsolute = [2.55, 3.58]) // lineTo`,
    `  |> line(end = [0.73, -0.75])`,
    `  |> angledLine(angle = 63, length = 1.38) // angledLine`,
    `  |> angledLine(angle = 319, lengthX = 1.15) // angledLineOfXLength`,
    `  |> angledLine(angle = 50, lengthY = 1.35) // angledLineOfYLength`,
    `  |> angledLine(angle = 291, endAbsoluteX = 6.66) // angledLineToX`,
    `  |> angledLine(angle = 228, endAbsoluteY = 2.14) // angledLineToY`,
    `  |> xLine(length = -1.33)`,
    `  |> yLine(length = -1.07)`,
    `  |> xLine(endAbsolute = 3.27)`,
    `  |> yLine(endAbsolute = 2.14)`,
  ]
  const bigExample = bigExampleArr.join('\n')
  it('line with tag converts to xLine', async () => {
    const callToSwap = 'line(end = [-2.04, -0.7], tag = $abc2)'
    const expectedLine = 'xLine(length = -2.04, tag = $abc2)'
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap,
      constraintType: 'horizontal',
    })
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('line w/o tag converts to xLine', async () => {
    const callToSwap = 'line(end = [0.73, -0.75])'
    const expectedLine = 'xLine(length = 0.73)'
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap,
      constraintType: 'horizontal',
    })
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('lineTo with tag converts to xLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'line(endAbsolute = [1, 1], tag = $abc1)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(endAbsolute = 1, tag = $abc1)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('lineTo w/o tag converts to xLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'line(endAbsolute = [2.55, 3.58])',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(endAbsolute = 2.55) // lineTo'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLine with tag converts to xLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 157, length = 1.69, tag = $abc3)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(length = -1.56, tag = $abc3)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLine w/o tag converts to xLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 63, length = 1.38)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(length = 0.63) // angledLine'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfXLength with tag converts to xLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 217, lengthX = 0.86, tag = $abc4)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(length = -0.86, tag = $abc4)'
    // hmm "-0.86" is correct since the angle is 104, but need to make sure this is compatible `-myVar`
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfXLength w/o tag converts to xLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 319, lengthX = 1.15)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(length = 1.15) // angledLineOfXLength'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfYLength with tag converts to yLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 104, lengthY = 1.58, tag = $abc5)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(length = 1.58, tag = $abc5)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfYLength w/o tag converts to yLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 50, lengthY = 1.35)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(length = 1.35) // angledLineOfYLength'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToX with tag converts to xLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 55, endAbsoluteX = -2.89, tag = $abc6)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(endAbsolute = -2.89, tag = $abc6)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToX w/o tag converts to xLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 291, endAbsoluteX = 6.66)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(endAbsolute = 6.66) // angledLineToX'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToY with tag converts to yLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 330, endAbsoluteY = 2.53, tag = $abc7)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(endAbsolute = 2.53, tag = $abc7)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToY w/o tag converts to yLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine(angle = 228, endAbsoluteY = 2.14)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(endAbsolute = 2.14) // angledLineToY'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
})

describe('testing swapping out sketch calls with xLine/xLineTo while keeping variable/identifiers intact', () => {
  // Enable rotations #152
  const variablesExampleArr = [
    `lineX = -1`,
    `lineToX = -1.3`,
    `angledLineAngle = 207`,
    `angledLineOfXLengthX = 0.8`,
    `angledLineOfYLengthY = 0.89`,
    `angledLineToXx = -1.86`,
    `angledLineToYy = -0.76`,
    `part001 = startSketchOn(XY)`,
    `  |> startProfileAt([0, 0], %)`,
    // `  |> rx(90, %)`,
    `  |> line(endAbsolute = [1, 1])`,
    `  |> line(end = [lineX, 2.13])`,
    `  |> line(endAbsolute = [lineToX, 2.85])`,
    `  |> angledLine(angle = angledLineAngle, length = 1.64)`,
    `  |> angledLine(angle = 329, lengthX = angledLineOfXLengthX)`,
    `  |> angledLine(angle = 222, lengthY = angledLineOfYLengthY)`,
    `  |> angledLine(angle = 330, endAbsoluteX = angledLineToXx)`,
    `  |> angledLine(angle = 217, endAbsoluteY = angledLineToYy)`,
    `  |> line(end = [0.89, -0.1])`,
  ]
  const varExample = variablesExampleArr.join('\n')
  it('line keeps variable when converted to xLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'line(end = [lineX, 2.13])',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(length = lineX)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('lineTo keeps variable when converted to xLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'line(endAbsolute = [lineToX, 2.85])',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(endAbsolute = lineToX)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfXLength keeps variable when converted to xLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLine(angle = 329, lengthX = angledLineOfXLengthX)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(length = angledLineOfXLengthX)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineOfYLength keeps variable when converted to yLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLine(angle = 222, lengthY = angledLineOfYLengthY)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(length = -angledLineOfYLengthY)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToX keeps variable when converted to xLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLine(angle = 330, endAbsoluteX = angledLineToXx)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(endAbsolute = angledLineToXx)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLineToY keeps variable when converted to yLineTo', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: varExample,
      callToSwap: 'angledLine(angle = 217, endAbsoluteY = angledLineToYy)',
      constraintType: 'vertical',
    })
    const expectedLine = 'yLine(endAbsolute = angledLineToYy)'
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })

  it('trying to convert angledLineToY to xLineTo should not work because of the variable', async () => {
    const illegalConvert = () =>
      testingSwapSketchFnCall({
        inputCode: varExample,
        callToSwap: 'angledLine(angle = 217, endAbsoluteY = angledLineToYy)',
        constraintType: 'horizontal',
      })
    await expect(illegalConvert).rejects.toThrowError('no callback helper')
  })
})

describe('testing getSketchSegmentIndexFromSourceRange', () => {
  const code = `
part001 = startSketchOn(XY)
  |> startProfileAt([0, 0.04], %) // segment-in-start
  |> line(end = [0, 0.4])
  |> xLine(length = 3.48)
  |> line(end = [2.14, 1.35]) // normal-segment
  |> xLine(length = 3.54)`
  it('normal case works', async () => {
    const execState = await enginelessExecutor(assertParse(code))
    const index = code.indexOf('// normal-segment') - 7
    const sg = sketchFromKclValue(
      execState.variables['part001'],
      'part001'
    ) as Sketch
    const _segment = getSketchSegmentFromSourceRange(
      sg,
      topLevelRange(index, index)
    )
    if (err(_segment)) throw _segment
    const { __geoMeta, ...segment } = _segment.segment
    expect(segment).toEqual({
      type: 'ToPoint',
      to: [5.62, 1.79],
      from: [3.48, 0.44],
      units: { type: 'Mm' },
      tag: null,
    })
  })
  it('verify it works when the segment is in the `start` property', async () => {
    const execState = await enginelessExecutor(assertParse(code))
    const index = code.indexOf('// segment-in-start') - 7
    const _segment = getSketchSegmentFromSourceRange(
      sketchFromKclValue(execState.variables['part001'], 'part001') as Sketch,
      topLevelRange(index, index)
    )
    if (err(_segment)) throw _segment
    const { __geoMeta, ...segment } = _segment.segment
    expect(segment).toEqual({
      to: [0, 0.04],
      from: [0, 0.04],
      units: { type: 'Mm' },
      tag: null,
      type: 'Base',
    })
  })
})
