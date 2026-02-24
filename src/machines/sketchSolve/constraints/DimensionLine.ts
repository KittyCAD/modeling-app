import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { CanvasTexture, Group, Mesh, Sprite, SpriteMaterial } from 'three'
import { CONSTRAINT_TYPE } from '@src/machines/sketchSolve/constraints'
import type { SpriteLabel } from '@src/machines/sketchSolve/constraints/dimensionUtils'
import { getEndPoints } from '@src/machines/sketchSolve/constraints/dimensionUtils'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import type { DimensionLineResources } from '@src/machines/sketchSolve/constraints/DimensionLineResources'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import {
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_ARROW,
  DISTANCE_CONSTRAINT_LABEL,
  DISTANCE_CONSTRAINT_HIT_AREA,
} from '@src/clientSideScene/sceneConstants'

export const LABEL_CANVAS_HEIGHT = 32

export function createDimensionLine(
  obj: ApiObject,
  objects: ApiObject[],
  resources: DimensionLineResources
): Group | null {
  if (obj.kind.type !== 'Constraint') return null

  if (getEndPoints(obj, objects)) {
    const constraint = obj.kind.constraint
    const group = new Group()
    group.name = obj.id.toString()
    group.userData = {
      type: CONSTRAINT_TYPE,
      constraintType: constraint.type,
      object_id: obj.id,
    }

    const materials = resources.materials

    const lineGeom1 = new LineGeometry()
    lineGeom1.setPositions([0, 0, 0, 100, 100, 0])
    const line1 = new Line2(lineGeom1, materials.default.line)
    line1.userData.type = DISTANCE_CONSTRAINT_BODY
    group.add(line1)

    const lineGeom2 = new LineGeometry()
    lineGeom2.setPositions([0, 0, 0, 100, 100, 0])
    const line2 = new Line2(lineGeom2, materials.default.line)
    line2.userData.type = DISTANCE_CONSTRAINT_BODY
    group.add(line2)

    // Arrow tip is at origin, so position directly at start/end
    const arrow1 = new Mesh(resources.arrowGeometry, materials.default.arrow)
    arrow1.userData.type = DISTANCE_CONSTRAINT_ARROW
    group.add(arrow1)

    const arrow2 = new Mesh(resources.arrowGeometry, materials.default.arrow)
    arrow2.userData.type = DISTANCE_CONSTRAINT_ARROW
    group.add(arrow2)

    // Label sprite with canvas texture (sized dynamically in updateLabel)
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = LABEL_CANVAS_HEIGHT
    const texture = new CanvasTexture(canvas)
    const spriteMaterial = new SpriteMaterial({
      map: texture,
      transparent: true,
    })
    const label = new Sprite(spriteMaterial) as SpriteLabel
    label.userData.type = DISTANCE_CONSTRAINT_LABEL
    group.add(label)

    // Hit areas for click detection (invisible but raycasted)

    const line1HitArea = new Mesh(resources.planeGeometry, materials.hitArea)
    line1HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
    line1HitArea.userData.subtype = DISTANCE_CONSTRAINT_BODY
    group.add(line1HitArea)

    const line2HitArea = new Mesh(resources.planeGeometry, materials.hitArea)
    line2HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
    line2HitArea.userData.subtype = DISTANCE_CONSTRAINT_BODY
    group.add(line2HitArea)

    const labelHitArea = new Mesh(resources.planeGeometry, materials.hitArea)
    labelHitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
    labelHitArea.userData.subtype = DISTANCE_CONSTRAINT_LABEL
    group.add(labelHitArea)

    return group
  }

  return null
}
