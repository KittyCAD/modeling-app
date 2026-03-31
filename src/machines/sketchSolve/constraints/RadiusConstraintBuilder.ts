import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  exprToNumber,
  isArcSegment,
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
      const startObject = objects[arc.kind.segment.start]
      const center = isArcSegment(arc)
        ? (() => {
            const centerObject = objects[arc.kind.segment.center]
            return isPointSegment(centerObject)
              ? pointToVec3(centerObject)
              : null
          })()
        : arc.kind.segment.ctor.type === 'Circle'
          ? (() => {
              const centerX = exprToNumber(arc.kind.segment.ctor.center.x)
              const centerY = exprToNumber(arc.kind.segment.ctor.center.y)
              return centerX !== null && centerY !== null
                ? new Vector3(centerX, centerY, 0)
                : null
            })()
          : null

      if (center && isPointSegment(startObject)) {
        const start = pointToVec3(startObject)
        const lineEnd = isRadiusConstraint(obj)
          ? center
          : center.sub(start.clone().sub(center))

        this.resources.updateConstraintGroup(
          group,
          obj.id,
          selectedIds,
          hoveredId
        )
        updateDimensionLine(
          start,
          lineEnd,
          group,
          obj,
          scale,
          sceneInfra,
          isRadiusConstraint(obj)
            ? obj.kind.constraint.radius
            : obj.kind.constraint.diameter,
          isDiameterConstraint(obj)
        )
      }
    }
  }
}
