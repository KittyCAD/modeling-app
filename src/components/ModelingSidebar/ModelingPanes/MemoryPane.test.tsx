import { processMemory } from './MemoryPane'
import { enginelessExecutor } from '../../../lib/testHelpers'
import { assertParse, initPromise, ProgramMemory } from '../../../lang/wasm'

beforeAll(async () => {
  await initPromise
})

describe('processMemory', () => {
  it('should grab the values and remove and geo data', async () => {
    // Enable rotations #152
    const code = `
  const myVar = 5
  fn myFn = (a) => {
    return a - 2
  }
  const otherVar = myFn(5)

  const theExtrude = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> lineTo([-2.4, myVar], %)
    |> lineTo([-0.76, otherVar], %)
    |> extrude(4, %)

  const theSketch = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> lineTo([-3.35, 0.17], %)
    |> lineTo([0.98, 5.16], %)
    |> lineTo([2.15, 4.32], %)
    // |> rx(90, %)`
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast, ProgramMemory.empty())
    const output = processMemory(execState.memory)
    expect(output.myVar).toEqual(5)
    expect(output.otherVar).toEqual(3)
    expect(output).toEqual({
      myVar: 5,
      myFn: '__function(a)__',
      otherVar: 3,
      theExtrude: [
        {
          type: 'extrudePlane',
          tag: null,
          id: expect.any(String),
          faceId: expect.any(String),
          sourceRange: [170, 194, 0],
        },
        {
          type: 'extrudePlane',
          tag: null,
          id: expect.any(String),
          faceId: expect.any(String),
          sourceRange: [202, 230, 0],
        },
      ],
      theSketch: [
        { type: 'ToPoint', to: [-3.35, 0.17], from: [0, 0], tag: null },
        { type: 'ToPoint', to: [0.98, 5.16], from: [-3.35, 0.17], tag: null },
        { type: 'ToPoint', to: [2.15, 4.32], from: [0.98, 5.16], tag: null },
      ],
    })
  })
})
