import { parse, initPromise } from '../wasm'
import { enginelessExecutor } from '../../lib/testHelpers'

beforeAll(() => initPromise)

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
    const { root } = await enginelessExecutor(await parse(code('-1')))
    expect(root.intersect.value).toBe(1 + Math.sqrt(2))
    const { root: noOffset } = await enginelessExecutor(await parse(code('0')))
    expect(noOffset.intersect.value).toBeCloseTo(1)
  })
})
