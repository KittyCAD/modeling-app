import { parse, initPromise } from '../wasm'
import { enginelessExecutor } from '../../lib/testHelpers'

beforeAll(async () => {
  await initPromise
})

describe('testing angledLineThatIntersects', () => {
  it('angledLineThatIntersects should intersect with another line', async () => {
    const code = (offset: string) => `const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([2, 2], %, "yo")
  |> lineTo([3, 1], %)
  |> angledLineThatIntersects({
  angle: 180,
  intersectTag: 'yo',
  offset: ${offset},
}, %, "yo2")
const intersect = segEndX('yo2', part001)`
    const mem = await enginelessExecutor(parse(code('-1')))
    expect(mem.get('intersect')?.value).toBe(1 + Math.sqrt(2))
    const noOffset = await enginelessExecutor(parse(code('0')))
    expect(noOffset.get('intersect')?.value).toBeCloseTo(1)
  })
})
