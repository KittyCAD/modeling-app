import { Group, OrthographicCamera } from 'three'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { GridSnapOptions } from '@src/clientSideScene/gridUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import {
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import type {
  SketchSolveContext,
  SketchSolveMachineEvent,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  type SnappingCandidate,
  allowSnapping,
  getObjectIdForSnapTarget,
  getSnappingCandidates,
} from '@src/machines/sketchSolve/snapping'
import { updateSnappingPreviewSprite } from '@src/machines/sketchSolve/snappingPreviewSprite'

type ToolSelf = {
  _parent?: {
    getSnapshot?: () => {
      context?: {
        rustContext?: Pick<SketchSolveContext['rustContext'], 'settingsActor'>
        sketchExecOutcome?: Partial<
          NonNullable<SketchSolveContext['sketchExecOutcome']>
        >
      }
    }
    send?: (
      event: Extract<SketchSolveMachineEvent, { type: 'update hovered id' }>
    ) => void
  }
}

export function getGridSnapOptions(
  self: ToolSelf,
  sceneInfra: SceneInfra
): GridSnapOptions | undefined {
  const modelingSettings = self._parent
    ?.getSnapshot?.()
    .context?.rustContext?.settingsActor?.getSnapshot?.().context?.modeling
  if (!modelingSettings?.snapToGrid?.current) {
    return undefined
  }
  const camera = sceneInfra.camControls.camera
  if (!(camera instanceof OrthographicCamera)) {
    return undefined
  }

  return {
    fixedSizeGrid: modelingSettings.fixedSizeGrid.current,
    majorGridSpacing: modelingSettings.majorGridSpacing.current,
    minorGridsPerMajor: modelingSettings.minorGridsPerMajor.current,
    snapsPerMinor: modelingSettings.snapsPerMinor.current,
    pixelsPerBaseUnit: sceneInfra.getPixelsPerBaseUnit(camera),
  }
}

type CandidateFilterArgs = {
  candidate: SnappingCandidate
  currentSketchObjects: ApiObject[]
  excludedPointIdSet: Set<number>
  excludedSegmentIdSet: Set<number>
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
  } else {
    hoveredId = getObjectIdForSnapTarget(snappingCandidate?.target)
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
  isCandidateAllowed,
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
  isCandidateAllowed?: (args: CandidateFilterArgs) => boolean
}): SnappingCandidate | null {
  if (!allowSnapping(mouseEvent)) {
    return null
  }

  const snapshot = self._parent?.getSnapshot?.()
  const gridSnapOptions = getGridSnapOptions(self, sceneInfra)
  const objects =
    snapshot?.context?.sketchExecOutcome?.sceneGraphDelta?.new_graph?.objects
  if (!objects && !gridSnapOptions) {
    return null
  }

  const currentSketchObjects = objects
    ? getCurrentSketchObjectsById(objects, sketchId)
    : []
  const excludedPointIdSet = new Set(excludedPointIds)
  const excludedSegmentIdSet = new Set<number>()

  for (const pointId of getExcludedPointIds?.(currentSketchObjects) ?? []) {
    excludedPointIdSet.add(pointId)
  }

  for (const pointId of excludedPointIdSet) {
    const point = currentSketchObjects[pointId]
    if (isPointSegment(point) && point.kind.segment.owner !== null) {
      excludedSegmentIdSet.add(point.kind.segment.owner)
    }
  }

  const defaultIsCandidateAllowed = (candidate: SnappingCandidate) => {
    if (candidate.target.type === 'point') {
      return !excludedPointIdSet.has(candidate.target.id)
    }

    const snapTargetSegmentId = getObjectIdForSnapTarget(candidate.target)
    if (snapTargetSegmentId === null) {
      return true
    }

    const snapTargetSegment = currentSketchObjects[snapTargetSegmentId]
    const snapTargetOwnerId =
      isLineSegment(snapTargetSegment) || isPointSegment(snapTargetSegment)
        ? snapTargetSegment.kind.segment.owner
        : null

    return (
      !excludedSegmentIdSet.has(snapTargetSegmentId) &&
      (snapTargetOwnerId == null ||
        !excludedSegmentIdSet.has(snapTargetOwnerId))
    )
  }

  return (
    getSnappingCandidates(
      mousePosition,
      currentSketchObjects,
      sceneInfra,
      gridSnapOptions
    ).find((candidate) => {
      return (
        isCandidateAllowed?.({
          candidate,
          currentSketchObjects,
          excludedPointIdSet,
          excludedSegmentIdSet,
        }) ?? defaultIsCandidateAllowed(candidate)
      )
    }) ?? null
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
