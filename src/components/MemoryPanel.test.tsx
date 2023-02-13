import { processMemory } from './MemoryPanel'
import { abstractSyntaxTree } from '../lang/abstractSyntaxTree'
import { executor } from '../lang/executor'
import { syncLexer as lexer } from '../lang/tokeniser'
import { initPromise } from '../lang/rust'

beforeAll(async () => {
  await initPromise
})

describe('processMemory', () => {
  it('should grab the values and remove and geo data', () => {
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
    |> rx(90, %)
  show(theExtrude, theSketch)`
    const tokens = lexer(code)
    const ast = abstractSyntaxTree(tokens)
    const programMemory = executor(ast, {
      root: {
        log: {
          type: 'userVal',
          value: (a: any) => {
            console.log('raw log', a)
          },
          __meta: [],
        },
      },
      _sketch: [],
    })
    const output = processMemory(programMemory)
    expect(output.myVar).toEqual(5)
    expect(output.myFn).toEqual('__function__')
    expect(output.otherVar).toEqual(3)
    expect(output).toEqual({
      myVar: 5,
      myFn: '__function__',
      otherVar: 3,
      theExtrude: [
        {
          type: 'extrudePlane',
          position: [-1.2, 2.5, 0],
          rotation: [
            0.5984837231672995, -0.3765862890544571, 0.3765862890544572,
            0.5984837231672996,
          ],
        },
        {
          type: 'extrudePlane',
          position: [-1.58, 4, 0],
          rotation: [
            0.3024567786448806, 0.6391556125481195, -0.6391556125481194,
            0.30245677864488063,
          ],
        },
      ],
      theSketch: [
        { type: 'toPoint', to: [-3.35, 0.17], from: [0, 0] },
        { type: 'toPoint', to: [0.98, 5.16], from: [-3.35, 0.17] },
        { type: 'toPoint', to: [2.15, 4.32], from: [0.98, 5.16] },
      ],
    })
  })
})
