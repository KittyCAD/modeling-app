import { Group } from 'three'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import {
  allowSnapping,
  getSnappingCandidates,
  isPointSnapTarget,
  type SnappingCandidate,
} from '@src/machines/sketchSolve/snapping'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import { updateSnappingPreviewSprite } from '@src/machines/sketchSolve/snappingPreviewSprite'

type ToolSelf = {
  _parent?: {
    getSnapshot?: () => {
      context?: {
        sketchExecOutcome?: {
          sceneGraphDelta?: {
            new_graph?: {
              objects?: any[]
            }
          }
        }
      }
    }
    send?: (event: {
      type: 'update hovered id'
      data: { hoveredId: SketchSolveSelectionId | null }
    }) => void
  }
}

function sendHoveredId(
  self: ToolSelf,
  hoveredId: SketchSolveSelectionId | null
) {
  self._parent?.send?.({
    type: 'update hovered id',
    data: {
      hoveredId,
    },
  })
}

export function sendHoveredSnappingCandidate(
  self: ToolSelf,
  snappingCandidate: SnappingCandidate | null
) {
  let hoveredId: SketchSolveSelectionId | null = null
  if (snappingCandidate?.target.type === ORIGIN_TARGET) {
    hoveredId = ORIGIN_TARGET
  } else if (isPointSnapTarget(snappingCandidate?.target)) {
    hoveredId = snappingCandidate.target.pointId
  }
  sendHoveredId(self, hoveredId)
}

export function getBestSnappingCandidate({
  self,
  sceneInfra,
  sketchId,
  mousePosition,
  mouseEvent,
  excludedPointIds = [],
  getExcludedPointIds,
}: {
  self: ToolSelf
  sceneInfra: SceneInfra
  sketchId: number
  mousePosition: Coords2d
  mouseEvent: MouseEvent
  excludedPointIds?: Iterable<number>
  getExcludedPointIds?: (
    currentSketchObjects: ApiObject[]
  ) => Iterable<number> | undefined
}): SnappingCandidate | null {
  if (!allowSnapping(mouseEvent)) {
    return null
  }

  const snapshot = self._parent?.getSnapshot?.()
  const objects =
    snapshot?.context?.sketchExecOutcome?.sceneGraphDelta?.new_graph?.objects
  if (!objects) {
    return null
  }

  const currentSketchObjects = getCurrentSketchObjectsById(objects, sketchId)
  const excludedPointIdSet = new Set(excludedPointIds)

  for (const pointId of getExcludedPointIds?.(currentSketchObjects) ?? []) {
    excludedPointIdSet.add(pointId)
  }

  return (
    getSnappingCandidates(mousePosition, currentSketchObjects, sceneInfra).find(
      (candidate) =>
        !isPointSnapTarget(candidate.target) ||
        !excludedPointIdSet.has(candidate.target.pointId)
    ) ?? null
  )
}

export function updateToolSnappingPreview({
  sceneInfra,
  target,
}: {
  sceneInfra: SceneInfra
  target: SnappingCandidate | null
}) {
  const sketchSolveGroup = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (!(sketchSolveGroup instanceof Group)) {
    return
  }

  updateSnappingPreviewSprite({
    sketchSolveGroup,
    sceneInfra,
    snappingCandidate: target,
  })
}

export function clearToolSnappingState({
  self,
  sceneInfra,
}: {
  self: ToolSelf
  sceneInfra: SceneInfra
}) {
  sendHoveredId(self, null)
  updateToolSnappingPreview({
    sceneInfra,
    target: null,
  })
}
