import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  isDiameterConstraint,
  isPointSegment,
  isRadiusConstraint,
  pointToVec3,
  type DiameterConstraint,
  type RadiusConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { Group } from 'three'
import {
  createDimensionLine,
  updateDimensionLine,
} from '@src/machines/sketchSolve/constraints/DimensionLine'

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
    if (arc?.kind.type === 'Segment' && arc.kind.segment.type === 'Arc') {
      const centerObject = objects[arc.kind.segment.center]
      const startObject = objects[arc.kind.segment.start]

      if (isPointSegment(centerObject) && isPointSegment(startObject)) {
        const start = pointToVec3(startObject)
        const center = pointToVec3(centerObject)
        const s3 = isRadiusConstraint(obj)
          ? center
          : center.sub(start.clone().sub(center))

        updateDimensionLine(
          start,
          s3,
          group,
          obj,
          scale,
          sceneInfra,
          selectedIds,
          hoveredId,
          isRadiusConstraint(obj)
            ? obj.kind.constraint.radius
            : obj.kind.constraint.diameter,
          this.resources,
          isDiameterConstraint(obj)
        )
      }
    }
  }
}
