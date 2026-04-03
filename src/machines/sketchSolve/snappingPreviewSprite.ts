import type { Group } from 'three'
import { Sprite, Vector2, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SELECTION_COLOR } from '@src/lib/constants'
import { getResolvedTheme } from '@src/lib/theme'
import type { Themes } from '@src/lib/theme'
import { setupConstructionLineDashShader } from '@src/machines/sketchSolve/constructionDashShader'
import { RENDER_ORDER } from '@src/machines/sketchSolve/renderOrder'
import { updateOriginSprite } from '@src/machines/sketchSolve/originSprite'
import {
  CONSTRAINT_BADGE_SIZE_PX,
  createConstraintBadgeSprite,
  getConstraintBadgeTexture,
} from '@src/machines/sketchSolve/constraints/constraintBadgeSprite'
import {
  X_AXIS_TARGET,
  Y_AXIS_TARGET,
  type SnapTarget,
  type SnappingCandidate,
} from '@src/machines/sketchSolve/snapping'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { ConstraintIconName } from '@src/components/constraintIconPaths'

export const SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE =
  'sketch-solve-snapping-preview-sprite'
export const SKETCH_SOLVE_SNAPPING_PREVIEW_LINE =
  'sketch-solve-snapping-preview-line'

// Updates the badge icon during dragging a point / drawing new lines,
// when the dragged point is about to create a constraint on click.
// This badge helps showing what that constraint type is going to be.
export function updateSnappingPreviewSprite({
  sketchSolveGroup,
  sceneInfra,
  snappingCandidate,
}: {
  sketchSolveGroup: Group
  sceneInfra: SceneInfra
  snappingCandidate: SnappingCandidate | null
}) {
  const sprite = getSnappingPreviewSprite(
    sketchSolveGroup,
    getResolvedTheme(sceneInfra.theme),
    getBadgeTypeForSnappingTarget(snappingCandidate?.target)
  )
  const scale = sceneInfra.getClientSceneScaleFactor(sketchSolveGroup)
  const previewLine = getSnappingPreviewLine(sketchSolveGroup)
  const axisSnapTarget = isAxisSnapTarget(snappingCandidate?.target)
    ? snappingCandidate
    : null

  updateOriginSprite(
    sketchSolveGroup,
    scale,
    sceneInfra.theme,
    snappingCandidate?.target.type === ORIGIN_TARGET ? 'hovered' : 'default'
  )

  previewLine.visible = !!axisSnapTarget
  if (axisSnapTarget) {
    updateSnappingPreviewLine(previewLine, axisSnapTarget.position, sceneInfra)
  }

  if (!snappingCandidate) {
    sprite.visible = false
    return
  }

  sprite.position.set(
    snappingCandidate.position[0] - 25 * scale,
    snappingCandidate.position[1] + 25 * scale,
    0
  )
  sprite.scale.setScalar(CONSTRAINT_BADGE_SIZE_PX * scale)
  sprite.visible = true
}

function getSnappingPreviewSprite(
  sketchSolveGroup: Group,
  theme: Themes,
  badgeType: ConstraintIconName
): Sprite {
  const existingObject = sketchSolveGroup.getObjectByName(
    SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE
  )
  if (existingObject instanceof Sprite) {
    const texture = getConstraintBadgeTexture({
      badgeType,
      badgeState: 'hovered',
      theme,
    })
    if (existingObject.material.map !== texture) {
      existingObject.material.map = texture
      existingObject.material.needsUpdate = true
    }
    return existingObject
  }

  const sprite = createConstraintBadgeSprite()
  sprite.material.map = getConstraintBadgeTexture({
    badgeType,
    badgeState: 'hovered',
    theme,
  })
  sprite.name = SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE
  sprite.renderOrder = RENDER_ORDER.INVISIBLE_CONSTRAINT
  sprite.layers.set(SKETCH_LAYER)
  sprite.visible = false
  sketchSolveGroup.add(sprite)
  return sprite
}

function getSnappingPreviewLine(sketchSolveGroup: Group): Line2 {
  const existingObject = sketchSolveGroup.getObjectByName(
    SKETCH_SOLVE_SNAPPING_PREVIEW_LINE
  )
  if (existingObject instanceof Line2) {
    return existingObject
  }

  const geometry = new LineGeometry()
  geometry.setPositions([0, 0, 0, 0, 0, 0])

  const material = new LineMaterial({
    color: SKETCH_SELECTION_COLOR,
    linewidth: 1 * window.devicePixelRatio,
    dashed: true,
    dashSize: 8,
    gapSize: 6,
    worldUnits: false,
    depthTest: false,
    depthWrite: false,
    resolution: new Vector2(window.innerWidth, window.innerHeight),
  })

  const segmentStart = new Vector3(0, 0, 0)
  const segmentEnd = new Vector3(0, 0, 0)
  setupConstructionLineDashShader(material, segmentStart, segmentEnd)

  const line = new Line2(geometry, material)
  line.name = SKETCH_SOLVE_SNAPPING_PREVIEW_LINE
  line.renderOrder = RENDER_ORDER.INVISIBLE_CONSTRAINT - 1
  line.layers.set(SKETCH_LAYER)
  line.visible = false
  line.userData.segmentStart = segmentStart
  line.userData.segmentEnd = segmentEnd

  sketchSolveGroup.add(line)
  return line
}

function updateSnappingPreviewLine(
  line: Line2,
  position: SnappingCandidate['position'],
  sceneInfra: SceneInfra
) {
  const { segmentStart, segmentEnd } = line.userData as {
    segmentStart: Vector3
    segmentEnd: Vector3
  }

  segmentStart.set(0, 0, 0)
  segmentEnd.set(position[0], position[1], 0)
  const rendererSize = sceneInfra.renderer.getSize(new Vector2())

  line.geometry.setPositions([0, 0, 0, position[0], position[1], 0])
  line.geometry.computeBoundingSphere()
  line.computeLineDistances()
  line.material.resolution.set(rendererSize.x, rendererSize.y)
}

function isAxisSnapTarget(
  target: SnapTarget | null | undefined
): target is Extract<
  SnapTarget,
  { type: typeof X_AXIS_TARGET } | { type: typeof Y_AXIS_TARGET }
> {
  return target?.type === X_AXIS_TARGET || target?.type === Y_AXIS_TARGET
}

function getBadgeTypeForSnappingTarget(
  target: SnapTarget | null | undefined
): ConstraintIconName {
  switch (target?.type) {
    case X_AXIS_TARGET:
      return 'VerticalDistance'
    case Y_AXIS_TARGET:
      return 'HorizontalDistance'
    default:
      return 'Coincident'
  }
}
