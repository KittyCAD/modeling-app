import { assertParse, initPromise } from '../wasm'
import { enginelessExecutor } from '../../lib/testHelpers'

beforeAll(async () => {
  await initPromise
})

describe('testing angledLineThatIntersects', () => {
  it('angledLineThatIntersects should intersect with another line', async () => {
    const code = (offset: string) => `part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [2, 2], tag = $yo)
  |> line(endAbsolute = [3, 1])
  |> angledLineThatIntersects({
  angle: 180,
  intersectTag: yo,
  offset: ${offset},
}, %, $yo2)
intersect = segEndX(yo2)`
    const execState = await enginelessExecutor(assertParse(code('-1')))
    expect(execState.variables['intersect']?.value).toBe(1 + Math.sqrt(2))
    const noOffset = await enginelessExecutor(assertParse(code('0')))
    expect(noOffset.variables['intersect']?.value).toBeCloseTo(1)
  })
})
