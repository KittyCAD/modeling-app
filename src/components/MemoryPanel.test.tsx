import { processMemory } from './MemoryPanel'
import { parser_wasm } from '../lang/abstractSyntaxTree'
import { enginelessExecutor } from '../lib/testHelpers'
import { initPromise } from '../lang/rust'

beforeAll(() => initPromise)

describe('processMemory', () => {
  it('should grab the values and remove and geo data', async () => {
    // Enable rotations #152
    const code = `
  const myVar = 5
  const myFn = (a) => {
    return a - 2
  }
  const otherVar = myFn(5)

  const theExtrude = startSketchAt([0, 0])
    |> lineTo([-2.4, myVar], %)
    |> lineTo([-0.76, otherVar], %)
    |> extrude(4, %)

  const theSketch = startSketchAt([0, 0])
    |> lineTo([-3.35, 0.17], %)
    |> lineTo([0.98, 5.16], %)
    |> lineTo([2.15, 4.32], %)
    // |> rx(90, %)
  show(theExtrude, theSketch)`
    const ast = parser_wasm(code)
    const programMemory = await enginelessExecutor(ast, {
      root: {},
      return: null,
    })
    const output = processMemory(programMemory)
    expect(output.myVar).toEqual(5)
    expect(output.otherVar).toEqual(3)
    expect(output).toEqual({
      myVar: 5,
      myFn: undefined,
      otherVar: 3,
      theExtrude: [],
      theSketch: [
        { type: 'toPoint', to: [-3.35, 0.17], from: [0, 0], name: '' },
        { type: 'toPoint', to: [0.98, 5.16], from: [-3.35, 0.17], name: '' },
        { type: 'toPoint', to: [2.15, 4.32], from: [0.98, 5.16], name: '' },
      ],
    })
  })
})
