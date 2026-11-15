import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SourceRange } from '@src/lang/wasm'
import {
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

export function nativeSketchDelta(range: SourceRange = [10, 20, 0]) {
  const sketch = (id: number): ApiObject => ({
    ...createPointApiObject({ id }),
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 9,
      segments: [id + 1, id + 2],
      constraints: [],
    },
  })
  const direct = createPointApiObject({ id: 1 })
  direct.source = { type: 'Simple', range, node_path: null }
  const derived = createPointApiObject({ id: 2 })
  derived.source = {
    type: 'BackTrace',
    ranges: [
      [[30, 40, 1], null],
      [[50, 60, 0], null],
    ],
  }
  const unrelated = createPointApiObject({ id: 11 })
  unrelated.source = direct.source
  return createSceneGraphDelta([
    sketch(0),
    direct,
    derived,
    sketch(10),
    unrelated,
  ])
}
