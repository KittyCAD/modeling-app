import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import { Group, type Object3D, type Vector2, type Vector3 } from 'three'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import {
  findClosestApiObjects,
  getSketchHoverDistance,
} from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { distance2d } from '@src/lib/utils2d'
import {
  isConstraint,
  isPointSegment,
  isLineSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { isInvisibleConstraintObject } from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
  type SelectionCoordinates,
} from '@src/machines/sketchSolve/sketchSolveSelection'

export type ClosestSelectionTarget = {
  distance: number
  selectionId: SketchSolveSelectionId
  apiObject: ApiObject | null
}

export function getClosestSelectionTarget(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): ClosestSelectionTarget | null {
  const closestObject = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  )[0]

  const selectionCandidates: ClosestSelectionTarget[] = []
  if (closestObject) {
    selectionCandidates.push({
      distance: closestObject.distance,
      selectionId: closestObject.apiObject.id,
      apiObject: closestObject.apiObject,
    })
  }

  const sketchSolveGroupObject =
    sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSolveGroup =
    sketchSolveGroupObject instanceof Group ? sketchSolveGroupObject : null
  const hoverDistance = getSketchHoverDistance(
    sceneInfra.getClientSceneScaleFactor(sketchSolveGroup)
  )
  const originDistance = distance2d(mousePosition, [0, 0])

  if (originDistance < hoverDistance) {
    selectionCandidates.push({
      distance: originDistance,
      selectionId: ORIGIN_TARGET,
      apiObject: null,
    })
  }

  selectionCandidates.sort((a, b) => {
    const priorityDelta = getSelectionPriority(a) - getSelectionPriority(b)
    if (priorityDelta !== 0) {
      return priorityDelta
    }
    return a.distance - b.distance
  })
  return selectionCandidates[0] ?? null
}

// Priorities are similar to snapping/getSnappingCandidates:
// - point like objects (point segment, origin) should take precedence
// However:
// - axes cannot be selected, but they can be snapped to
// - only points can be snapped to, other segment types cannot (for now)
function getSelectionPriority(selectionTarget: ClosestSelectionTarget) {
  if (isInvisibleConstraintObject(selectionTarget.apiObject)) {
    return 0
  }
  if (isPointSegment(selectionTarget.apiObject)) {
    return 1
  }
  if (selectionTarget.selectionId === 'origin') {
    return 2
  }

  return 3
}

export function createSketchClickCallback({
  getApiObjects,
  sceneInfra,
  onUpdateSelectedIds,
  onEditConstraint,
  onPinInvisibleConstraint,
}: {
  getApiObjects: () => ApiObject[]
  sceneInfra: SceneInfra
  onUpdateSelectedIds: (data: {
    selectedIds: Array<SketchSolveSelectionId>
    duringAreaSelectIds: Array<number>
    replaceExistingSelection?: boolean
    selectionCoordinates?: SelectionCoordinates
  }) => void
  onEditConstraint?: (constraintId: number) => void
  onPinInvisibleConstraint?: (
    id: number,
    position: Coords2d,
    objects: ApiObject[]
  ) => void
}): (arg: {
  selected?: Object3D
  mouseEvent: MouseEvent
  intersectionPoint?: { twoD: Vector2; threeD: Vector3 }
  intersects: Array<unknown>
}) => Promise<void> {
  return async ({ mouseEvent, intersectionPoint }) => {
    let closestSelection: ClosestSelectionTarget | null = null
    let mousePosition: Coords2d | undefined

    if (intersectionPoint) {
      mousePosition = [intersectionPoint.twoD.x, intersectionPoint.twoD.y]

      closestSelection = getClosestSelectionTarget(
        mousePosition,
        getApiObjects(),
        sceneInfra
      )
    }

    const selectedApiObject = closestSelection?.apiObject ?? undefined

    if (
      onEditConstraint &&
      mouseEvent.detail === 2 &&
      isConstraint(selectedApiObject) &&
      !isInvisibleConstraintObject(selectedApiObject)
    ) {
      // Double clicking on Constraint
      onEditConstraint(selectedApiObject.id)
    } else {
      const shouldReplaceSelection = isConstraint(selectedApiObject)
      if (
        mousePosition &&
        selectedApiObject &&
        isInvisibleConstraintObject(selectedApiObject)
      ) {
        onPinInvisibleConstraint?.(
          selectedApiObject.id,
          mousePosition,
          getApiObjects()
        )
      }
      const selectionCoordinates =
        closestSelection &&
        typeof closestSelection.selectionId === 'number' &&
        isLineSegment(selectedApiObject) &&
        mousePosition
          ? { [closestSelection.selectionId]: mousePosition }
          : undefined
      onUpdateSelectedIds({
        selectedIds: closestSelection ? [closestSelection.selectionId] : [],
        duringAreaSelectIds: [],
        ...(shouldReplaceSelection ? { replaceExistingSelection: true } : {}),
        ...(selectionCoordinates ? { selectionCoordinates } : {}),
      })
    }
  }
}
