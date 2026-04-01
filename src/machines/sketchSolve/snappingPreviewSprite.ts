import type { Group } from 'three'
import { Sprite } from 'three'

import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { getResolvedTheme } from '@src/lib/theme'
import type { Themes } from '@src/lib/theme'
import { RENDER_ORDER } from '@src/machines/sketchSolve/renderOrder'
import { updateOriginSprite } from '@src/machines/sketchSolve/originSprite'
import {
  CONSTRAINT_BADGE_SIZE_PX,
  createConstraintBadgeSprite,
  getConstraintBadgeTexture,
} from '@src/machines/sketchSolve/constraints/constraintBadgeSprite'
import { type SnappingCandidate } from '@src/machines/sketchSolve/snapping'

export const SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE =
  'sketch-solve-snapping-preview-sprite'

const SNAPPING_PREVIEW_OFFSET_X_PX = -25
const SNAPPING_PREVIEW_OFFSET_Y_PX = 25

// Updates the badge icon during dragging a point / drawing new lines,
// when the dragged point is about to create a constraint on click.
// This badge helps showing what that constraint type is going to be.
export function updateSnappingPreviewSprite({
  sketchSolveGroup,
  sceneInfra,
  target,
}: {
  sketchSolveGroup: Group
  sceneInfra: SceneInfra
  target: SnappingCandidate | null
}) {
  const sprite = getSnappingPreviewSprite(
    sketchSolveGroup,
    getResolvedTheme(sceneInfra.theme)
  )
  const scale = sceneInfra.getClientSceneScaleFactor(sketchSolveGroup)

  updateOriginSprite(
    sketchSolveGroup,
    scale,
    sceneInfra.theme,
    target?.target.type === 'origin' ? 'hovered' : 'default'
  )

  if (!target) {
    sprite.visible = false
    return
  }

  sprite.position.set(
    target.position[0] + SNAPPING_PREVIEW_OFFSET_X_PX * scale,
    target.position[1] + SNAPPING_PREVIEW_OFFSET_Y_PX * scale,
    0
  )
  sprite.scale.setScalar(CONSTRAINT_BADGE_SIZE_PX * scale)
  sprite.visible = true
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
