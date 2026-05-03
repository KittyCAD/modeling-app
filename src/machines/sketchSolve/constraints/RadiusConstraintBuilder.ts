import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  isArcLikeSegment,
  isDiameterConstraint,
  isPointSegment,
  isRadiusConstraint,
  pointToVec3,
  type DiameterConstraint,
  type RadiusConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { type Group, Vector3 } from 'three'
import {
  createDimensionLine,
  updateDimensionLine,
} from '@src/machines/sketchSolve/constraints/DimensionLine'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

export class RadiusConstraintBuilder {
  private readonly resources: ConstraintResources

  constructor(resources: ConstraintResources) {
    this.resources = resources
  }

  public init(obj: RadiusConstraint | DiameterConstraint) {
    return createDimensionLine(obj, this.resources)
  }

  public update(
    group: Group,
    obj: RadiusConstraint | DiameterConstraint,
    objects: ApiObject[],
    scale: number,
    sceneInfra: SceneInfra,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    const arc = objects[obj.kind.constraint.arc]
    if (isArcLikeSegment(arc)) {
      const centerObject = objects[arc.kind.segment.center]
      const startObject = objects[arc.kind.segment.start]

      if (isPointSegment(centerObject) && isPointSegment(startObject)) {
        const arcStart = pointToVec3(startObject)
        const center = pointToVec3(centerObject)
        const constraintLabelPosition = obj.kind.constraint.labelPosition
        const labelPosition = constraintLabelPosition
          ? new Vector3(
              constraintLabelPosition.x.value,
              constraintLabelPosition.y.value,
              0
            )
          : undefined
        const isDiameter = isDiameterConstraint(obj)
        const { start, end } = getCircularDimensionLine(
          arcStart,
          center,
          isDiameter,
          labelPosition
        )

        this.resources.updateConstraintGroup(
          group,
          obj.id,
          selectedIds,
          hoveredId
        )
        updateDimensionLine(
          start,
          end,
          group,
          obj,
          scale,
          sceneInfra,
          isRadiusConstraint(obj)
            ? obj.kind.constraint.radius
            : obj.kind.constraint.diameter,
          isDiameter,
          labelPosition
        )
      }
    }
  }
}

function getCircularDimensionLine(
  arcStart: Vector3,
  center: Vector3,
  isDiameter: boolean,
  labelPosition?: Vector3
) {
  const defaultStart = arcStart
  const defaultEnd = isDiameter
    ? center.clone().sub(arcStart.clone().sub(center))
    : center

  if (!labelPosition) {
    return { start: defaultStart, end: defaultEnd }
  }

  const radius = arcStart.distanceTo(center)
  const labelDirection = labelPosition.clone().sub(center)
  if (radius === 0 || labelDirection.lengthSq() === 0) {
    return { start: defaultStart, end: defaultEnd }
  }

  labelDirection.normalize()

  if (!isDiameter) {
    return {
      start: center.clone().add(labelDirection.clone().multiplyScalar(radius)),
      end: center,
    }
  }

  return {
    start: center.clone().sub(labelDirection.clone().multiplyScalar(radius)),
    end: center.clone().add(labelDirection.clone().multiplyScalar(radius)),
  }
}
