import { abstractSyntaxTree } from '../abstractSyntaxTree'
import { enginelessExecutor } from '../../lib/testHelpers'
import { lexer } from '../tokeniser'
import { initPromise } from '../rust'

beforeAll(() => initPromise)

describe('testing angledLineThatIntersects', () => {
  it('angledLineThatIntersects should intersect with another line', async () => {
    const code = (offset: string) => `const part001 = startSketchAt([0, 0])
  |> lineTo({to:[2, 2], tag: "yo"}, %)
  |> lineTo([3, 1], %)
  |> angledLineThatIntersects({
  angle: 180,
  intersectTag: 'yo',
  offset: ${offset},
  tag: "yo2"
}, %)
const intersect = segEndX('yo2', part001)
show(part001)`
    const { root } = await enginelessExecutor(
      abstractSyntaxTree(lexer(code('-1')))
    )
    expect(root.intersect.value).toBe(1 + Math.sqrt(2))
    const { root: noOffset } = await enginelessExecutor(
      abstractSyntaxTree(lexer(code('0')))
    )
    expect(noOffset.intersect.value).toBeCloseTo(1)
  })
})
