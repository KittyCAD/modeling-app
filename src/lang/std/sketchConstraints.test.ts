import {
  assertParse,
  Sketch,
  recast,
  initPromise,
  sketchFromKclValue,
  SourceRange,
  topLevelRange,
} from '../wasm'
import {
  ConstraintType,
  getTransformInfos,
  transformAstSketchLines,
} from './sketchcombos'
import { getSketchSegmentFromSourceRange } from './sketchConstraints'
import { enginelessExecutor } from '../../lib/testHelpers'
import { err } from 'lib/trap'
import { codeRefFromRange } from './artifactGraph'

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
    `  |> angledLine({ angle = 157, length = 1.69 }, %, $abc3)`,
    `  |> angledLineOfXLength({ angle = 217, length = 0.86 }, %, $abc4)`,
    `  |> angledLineOfYLength({ angle = 104, length = 1.58 }, %, $abc5)`,
    `  |> angledLineToX({ angle = 55, to = -2.89 }, %, $abc6)`,
    `  |> angledLineToY({ angle = 330, to = 2.53 }, %, $abc7)`,
    `  |> xLine(length = 1.47, tag = $abc8)`,
    `  |> yLine(length = 1.57, tag = $abc9)`,
    `  |> xLine(endAbsolute = 1.49, tag = $abc10)`,
    `  |> yLine(endAbsolute = 2.64, tag = $abc11)`,
    `  |> line(endAbsolute = [2.55, 3.58]) // lineTo`,
    `  |> line(end = [0.73, -0.75])`,
    `  |> angledLine([63, 1.38], %) // angledLine`,
    `  |> angledLineOfXLength([319, 1.15], %) // angledLineOfXLength`,
    `  |> angledLineOfYLength([50, 1.35], %) // angledLineOfYLength`,
    `  |> angledLineToX([291, 6.66], %) // angledLineToX`,
    `  |> angledLineToY([228, 2.14], %) // angledLineToY`,
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
      callToSwap: 'angledLine({ angle = 157, length = 1.69 }, %, $abc3)',
      constraintType: 'horizontal',
    })
    const expectedLine = 'xLine(length = -1.56, tag = $abc3)'
    console.log(newCode)
    expect(newCode).toContain(expectedLine)
    // new line should start at the same place as the old line
    expect(originalRange[0]).toBe(newCode.indexOf(expectedLine))
  })
  it('angledLine w/o tag converts to xLine', async () => {
    const { newCode, originalRange } = await testingSwapSketchFnCall({
      inputCode: bigExample,
      callToSwap: 'angledLine([63, 1.38], %)',
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
      callToSwap:
        'angledLineOfXLength({ angle = 217, length = 0.86 }, %, $abc4)',
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
      callToSwap: 'angledLineOfXLength([319, 1.15], %)',
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
      callToSwap:
        'angledLineOfYLength({ angle = 104, length = 1.58 }, %, $abc5)',
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
      callToSwap: 'angledLineOfYLength([50, 1.35], %)',
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
      callToSwap: 'angledLineToX({ angle = 55, to = -2.89 }, %, $abc6)',
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
      callToSwap: 'angledLineToX([291, 6.66], %)',
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
      callToSwap: 'angledLineToY({ angle = 330, to = 2.53 }, %, $abc7)',
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
      callToSwap: 'angledLineToY([228, 2.14], %)',
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
    `  |> angledLine([angledLineAngle, 1.64], %)`,
    `  |> angledLineOfXLength([329, angledLineOfXLengthX], %)`,
    `  |> angledLineOfYLength([222, angledLineOfYLengthY], %)`,
    `  |> angledLineToX([330, angledLineToXx], %)`,
    `  |> angledLineToY([217, angledLineToYy], %)`,
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
      callToSwap: 'angledLineOfXLength([329, angledLineOfXLengthX], %)',
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
      callToSwap: 'angledLineOfYLength([222, angledLineOfYLengthY], %)',
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
      callToSwap: 'angledLineToX([330, angledLineToXx], %)',
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
      callToSwap: 'angledLineToY([217, angledLineToYy], %)',
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
        callToSwap: 'angledLineToY([217, angledLineToYy], %)',
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
