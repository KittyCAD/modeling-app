import type { Group } from 'three'
import { Sprite } from 'three'

import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { getResolvedTheme } from '@src/lib/theme'
import type { Themes } from '@src/lib/theme'
import type { PointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'
import { RENDER_ORDER } from '@src/machines/sketchSolve/renderOrder'
import {
  CONSTRAINT_BADGE_SIZE_PX,
  createConstraintBadgeSprite,
  getConstraintBadgeTexture,
} from '@src/machines/sketchSolve/constraints/constraintBadgeSprite'

export const SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE =
  'sketch-solve-snapping-preview-sprite'

const SNAPPING_PREVIEW_OFFSET_X_PX = -25
const SNAPPING_PREVIEW_OFFSET_Y_PX = 25

export function updateSnappingPreviewSprite({
  sketchSolveGroup,
  sceneInfra,
  targetPoint,
}: {
  sketchSolveGroup: Group
  sceneInfra: SceneInfra
  targetPoint: PointSegment | null
}) {
  const sprite = getSnappingPreviewSprite(
    sketchSolveGroup,
    getResolvedTheme(sceneInfra.theme)
  )

  if (!targetPoint) {
    sprite.visible = false
    return
  }

  const scale = sceneInfra.getClientSceneScaleFactor(sketchSolveGroup)
  sprite.position.set(
    targetPoint.kind.segment.position.x.value +
      SNAPPING_PREVIEW_OFFSET_X_PX * scale,
    targetPoint.kind.segment.position.y.value +
      SNAPPING_PREVIEW_OFFSET_Y_PX * scale,
    0
  )
  sprite.scale.setScalar(CONSTRAINT_BADGE_SIZE_PX * scale)
  sprite.visible = true
}

export function hideSnappingPreviewSprite(sketchSolveGroup: Group) {
  const existingObject = sketchSolveGroup.getObjectByName(
    SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE
  )
  if (existingObject instanceof Sprite) {
    existingObject.visible = false
  }
}

function getSnappingPreviewSprite(
  sketchSolveGroup: Group,
  theme: Themes
): Sprite {
  const existingObject = sketchSolveGroup.getObjectByName(
    SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE
  )
  if (existingObject instanceof Sprite) {
    const texture = getConstraintBadgeTexture({
      badgeType: 'Coincident',
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
    badgeType: 'Coincident',
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
