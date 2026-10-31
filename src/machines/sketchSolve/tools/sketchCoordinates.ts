import type { Coords2d } from '@src/lang/util'
import { roundOff } from '@src/lib/utils'
import type { SnappingCandidate } from '@src/machines/sketchSolve/snapping'

// Quantize only free cursor input. Snapped and derived geometry must retain its
// precision through preview, solver edits, and KCL serialization.
export function resolveSketchPoint(
  cursor: Coords2d,
  candidate: Pick<SnappingCandidate, 'position'> | null
): Coords2d {
  return candidate?.position ?? [roundOff(cursor[0]), roundOff(cursor[1])]
}
