import { processMemory } from './MemoryPane'
import { enginelessExecutor } from '../../../lib/testHelpers'
import { assertParse, initPromise } from '../../../lang/wasm'

beforeAll(async () => {
  await initPromise
})

describe('processMemory', () => {
  it('should grab the values and remove and geo data', async () => {
    // Enable rotations #152
    const code = `
  myVar = 5
  fn myFn = (a) => {
    return a - 2
  }
  otherVar = myFn(5)

  theExtrude = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line(endAbsolute = [-2.4, myVar])
    |> line(endAbsolute = [-0.76, otherVar])
    |> extrude(length = 4)

  theSketch = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line(endAbsolute = [-3.35, 0.17])
    |> line(endAbsolute = [0.98, 5.16])
    |> line(endAbsolute = [2.15, 4.32])
    // |> rx(90, %)`
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const output = processMemory(execState.variables)
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
          sourceRange: [expect.any(Number), expect.any(Number), 0],
        },
        {
          type: 'extrudePlane',
          tag: null,
          id: expect.any(String),
          faceId: expect.any(String),
          sourceRange: [expect.any(Number), expect.any(Number), 0],
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
