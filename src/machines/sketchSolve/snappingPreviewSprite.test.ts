import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { Themes } from '@src/lib/theme'
import { GRID_TARGET } from '@src/machines/sketchSolve/snapping'
import {
  SKETCH_SOLVE_GRID_SNAPPING_PREVIEW_SPRITE,
  SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE,
  updateSnappingPreviewSprite,
} from '@src/machines/sketchSolve/snappingPreviewSprite'
import { Group, Sprite } from 'three'
import { describe, expect, it } from 'vitest'

describe('updateSnappingPreviewSprite', () => {
  it('shows a point marker instead of a constraint badge for grid snapping', () => {
    const sketchSolveGroup = new Group()
    const sceneInfra = {
      theme: Themes.Light,
      getClientSceneScaleFactor: () => 2,
    } as unknown as SceneInfra

    updateSnappingPreviewSprite({
      sketchSolveGroup,
      sceneInfra,
      snappingCandidate: {
        target: { type: GRID_TARGET },
        distance: 0.1,
        position: [12.5, -3.25],
      },
    })

    const gridMarker = sketchSolveGroup.getObjectByName(
      SKETCH_SOLVE_GRID_SNAPPING_PREVIEW_SPRITE
    )
    const constraintBadge = sketchSolveGroup.getObjectByName(
      SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE
    )

    expect(gridMarker).toBeInstanceOf(Sprite)
    expect(gridMarker?.visible).toBe(true)
    expect(gridMarker?.position.toArray()).toEqual([12.5, -3.25, 0])
    expect(constraintBadge?.visible).toBe(false)
  })
})
