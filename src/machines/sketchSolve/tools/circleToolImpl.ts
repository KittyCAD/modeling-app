import * as circleOperations from '@src/machines/sketchSolve/tools/circleOperations'
import type { CircleGeometryInput } from '@src/machines/sketchSolve/tools/circleOperations'
import type { KclManager } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { SnapTarget } from '@src/machines/sketchSolve/snapping'
type LegacyCircleInput = Omit<
  CircleGeometryInput,
  'rustContext' | 'lengthUnit'
> & {
  rustContext: RustContext
  kclManager: KclManager
  centerSnapTarget?: SnapTarget
  startSnapTarget?: SnapTarget
  circleId?: number
}
function circleInput(input: LegacyCircleInput) {
  return {
    ...input,
    lengthUnit: input.kclManager.fileSettings.defaultLengthUnit,
    rustContext: {
      addSegment: input.rustContext.addSegment.bind(input.rustContext),
      editSegments: input.rustContext.editSegments.bind(input.rustContext),
      addConstraint: input.rustContext.addConstraint.bind(input.rustContext),
      prepareForSketchInsertion:
        input.rustContext.prepareForSketchInsertion.bind(input.rustContext),
      getSettings: () => jsAppSettings(input.rustContext.settingsActor),
    },
  }
}
export function createDraftCircle({
  input,
}: {
  input: Omit<LegacyCircleInput, 'startPoint'> | { error: string }
}) {
  return circleOperations.createDraftCircle({
    input:
      'error' in input
        ? input
        : circleInput({ ...input, startPoint: input.centerPoint }),
  })
}
export function updateDraftCircle(
  input: LegacyCircleInput & { circleId: number }
) {
  return circleOperations.updateDraftCircle({
    ...circleInput(input),
    circleId: input.circleId,
  })
}
export function commitCircle({
  input,
}: {
  input: (LegacyCircleInput & { circleId: number }) | { error: string }
}) {
  return circleOperations.commitCircle({
    input:
      'error' in input
        ? input
        : { ...circleInput(input), circleId: input.circleId },
  })
}
