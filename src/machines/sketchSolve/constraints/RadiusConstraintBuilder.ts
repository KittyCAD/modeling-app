import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { DISTANCE_CONSTRAINT_BODY } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { getAngleDiff } from '@src/lib/utils'
import { getPolarAngle2d } from '@src/lib/utils2d'
import { createArcPositions } from '@src/machines/sketchSolve/arcPositions'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  createDimensionLine,
  updateDimensionLine,
} from '@src/machines/sketchSolve/constraints/DimensionLine'
import {
  type DiameterConstraint,
  type RadiusConstraint,
  isArcLikeSegment,
  isArcSegment,
  isDiameterConstraint,
  isPointSegment,
  isRadiusConstraint,
  pointToVec3,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { type Group, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'

const EXTENSION_ARC_ROLE = 'radius-constraint-extension-arc'

export class RadiusConstraintBuilder {
  private readonly resources: ConstraintResources

  constructor(resources: ConstraintResources) {
    this.resources = resources
  }

  public init(obj: RadiusConstraint | DiameterConstraint) {
    const group = createDimensionLine(obj, this.resources)
    createExtensionArcLines(group, this.resources)
    return group
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
        updateExtensionArcs(group, arc, objects, center, start, end, isDiameter)
      }
    }
  }
}

function createExtensionArcLines(group: Group, resources: ConstraintResources) {
  for (let index = 0; index < 2; index++) {
    const geometry = new LineGeometry()
    geometry.setPositions([0, 0, 0, 0, 0, 0])

    const line = new Line2(geometry, resources.materials.default.line)
    line.userData.type = DISTANCE_CONSTRAINT_BODY
    line.userData.role = EXTENSION_ARC_ROLE
    line.visible = false
    group.add(line)
  }
}

function updateExtensionArcs(
  group: Group,
  arc: ApiObject,
  objects: ApiObject[],
  center: Vector3,
  dimensionStart: Vector3,
  dimensionEnd: Vector3,
  isDiameter: boolean
) {
  const extensionArcs = group.children.filter(
    (child) =>
      child instanceof Line2 && child.userData.role === EXTENSION_ARC_ROLE
  ) as Line2[]
  const [startExtensionArc, endExtensionArc] = extensionArcs
  if (!startExtensionArc || !endExtensionArc) {
    console.error('Missing radius constraint extension arc lines')
    return
  }

  if (!isArcSegment(arc)) {
    hideExtensionArcs(extensionArcs)
    return
  }

  const arcStartObject = objects[arc.kind.segment.start]
  const arcEndObject = objects[arc.kind.segment.end]
  if (!isPointSegment(arcStartObject) || !isPointSegment(arcEndObject)) {
    hideExtensionArcs(extensionArcs)
    return
  }

  const arcStart = pointToVec3(arcStartObject)
  const arcEnd = pointToVec3(arcEndObject)
  const radius = arcStart.distanceTo(center)
  if (radius === 0) {
    hideExtensionArcs(extensionArcs)
    return
  }

  const startAngle = getPolarAngle2d(
    [center.x, center.y],
    [arcStart.x, arcStart.y]
  )
  const endAngle = getPolarAngle2d([center.x, center.y], [arcEnd.x, arcEnd.y])
  updateExtensionArc(
    startExtensionArc,
    center,
    radius,
    startAngle,
    endAngle,
    dimensionStart
  )
  if (isDiameter) {
    updateExtensionArc(
      endExtensionArc,
      center,
      radius,
      startAngle,
      endAngle,
      dimensionEnd
    )
  } else {
    hideExtensionArc(endExtensionArc)
  }
}

function hideExtensionArcs(extensionArcs: Line2[]) {
  for (const extensionArc of extensionArcs) {
    hideExtensionArc(extensionArc)
  }
}

function hideExtensionArc(extensionArc: Line2) {
  extensionArc.visible = false
  delete extensionArc.userData.hitObjects
}

// Draws the shortest extension arc from the arc sweep towards target unless it's already on the arc.
function updateExtensionArc(
  extensionArc: Line2,
  center: Vector3,
  radius: number,
  arcStartAngle: number,
  arcEndAngle: number,
  target: Vector3
) {
  const targetAngle = getPolarAngle2d(
    [center.x, center.y],
    [target.x, target.y]
  )
  const arcSweep = getAngleDiff(arcStartAngle, arcEndAngle, true)
  const targetOffset = getAngleDiff(arcStartAngle, targetAngle, true)
  if (targetOffset <= arcSweep + 1e-8) {
    // target is already on the arc sweep from start to end -> no need to draw an extension
    hideExtensionArc(extensionArc)
    return
  }

  const fromEndSweep = getAngleDiff(arcEndAngle, targetAngle, true)
  const toStartSweep = getAngleDiff(targetAngle, arcStartAngle, true)
  const extensionStartAngle =
    fromEndSweep <= toStartSweep ? arcEndAngle : targetAngle
  const extensionEndAngle =
    fromEndSweep <= toStartSweep ? targetAngle : arcStartAngle

  extensionArc.visible = true
  extensionArc.userData.hitObjects = 'auto'
  extensionArc.geometry.setPositions(
    createArcPositions({
      center: [center.x, center.y],
      radius,
      startAngle: extensionStartAngle,
      endAngle: extensionEndAngle,
      ccw: true,
    })
  )
  extensionArc.geometry.computeBoundingSphere()
  extensionArc.computeLineDistances()
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
