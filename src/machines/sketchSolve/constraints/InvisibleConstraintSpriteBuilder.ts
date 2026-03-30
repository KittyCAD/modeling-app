import { Group, Sprite, Vector3 } from 'three'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { getResolvedTheme } from '@src/lib/theme'
import { clamp, isArray } from '@src/lib/utils'
import { CONSTRAINT_TYPE } from '@src/machines/sketchSolve/constraints/constraintUtils'
import { RENDER_ORDER } from '@src/machines/sketchSolve/renderOrder'
import {
  CONSTRAINT_BADGE_SIZE_PX,
  createConstraintBadgeSprite,
  getConstraintBadgeTexture,
  type ConstraintBadgeState,
} from '@src/machines/sketchSolve/constraints/constraintBadgeSprite'
import {
  findInvisibleConstraintClusterIds,
  type ConstraintHoverPopup,
  findInvisibleConstraintsForSegment,
  getInvisibleConstraintAnchor,
  isInvisibleConstraintObject,
  type InvisibleConstraintObject,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'

export type InvisibleConstraintDisplayState = {
  showNonVisualConstraints: boolean
  constraintHoverPopups: ConstraintHoverPopup[]
}

const CONSTRAINT_HOVER_POPUP_KEY = 'constraintHoverPopup'
const SELECTED_INVISIBLE_CONSTRAINT_POPUP_KEY =
  'selectedInvisibleConstraintPopup'

type InvisibleConstraintWorldPosition = {
  position: Vector3
  renderOrder: number
  popup?: ConstraintHoverPopup
}

type SelectedInvisibleConstraintPopup = ConstraintHoverPopup & {
  ownerConstraintId: number
}

export class InvisibleConstraintSpriteBuilder {
  public init(obj: InvisibleConstraintObject) {
    const group = new Group()
    group.name = obj.id.toString()
    group.userData = {
      type: CONSTRAINT_TYPE,
      constraintType: obj.kind.constraint.type,
      object_id: obj.id,
    }
    group.visible = false

    const sprite = createConstraintBadgeSprite()
    sprite.renderOrder = RENDER_ORDER.INVISIBLE_CONSTRAINT
    group.add(sprite)

    return group
  }

  public update(
    group: Group,
    obj: ApiObject,
    objects: ApiObject[],
    sceneInfra: SceneInfra,
    selectedIds: number[],
    hoveredId: number | null,
    displayState: InvisibleConstraintDisplayState
  ) {
    if (!isInvisibleConstraintObject(obj)) {
      group.visible = false
      return
    }

    const selectedPopup = getSelectedInvisibleConstraintPopup(group)
    if (
      selectedPopup &&
      !selectedIds.includes(selectedPopup.ownerConstraintId)
    ) {
      clearSelectedInvisibleConstraintPopup(group)
    }
    const isSelected = selectedIds.includes(obj.id)
    const isHovered = hoveredId === obj.id
    const positions = getInvisibleConstraintWorldPositions(
      group,
      obj,
      objects,
      sceneInfra,
      displayState,
      isSelected,
      isHovered
    )

    if (positions.length === 0) {
      group.visible = false
      return
    }

    const theme = getResolvedTheme(sceneInfra.theme)
    const texture = getConstraintBadgeTexture({
      badgeType: obj.kind.constraint.type,
      badgeState: getConstraintBadgeState(obj.id, selectedIds, hoveredId),
      theme,
    })
    const sprites = syncSprites(group, positions.length)
    const scale = sceneInfra.getClientSceneScaleFactor(group)
    group.position.set(0, 0, 0)

    sprites.forEach((sprite, index) => {
      const { position, renderOrder, popup } = positions[index]
      sprite.position.copy(position)
      sprite.scale.setScalar(CONSTRAINT_BADGE_SIZE_PX * scale)
      sprite.renderOrder = renderOrder
      if (sprite.material.map !== texture) {
        sprite.material.map = texture
        sprite.material.needsUpdate = true
      }
      if (popup) {
        sprite.userData[CONSTRAINT_HOVER_POPUP_KEY] = popup
      } else {
        delete sprite.userData[CONSTRAINT_HOVER_POPUP_KEY]
      }
      sprite.userData.hitObjects = [
        {
          type: 'screenRect',
          center: [position.x, position.y, position.z],
          sizePx: [CONSTRAINT_BADGE_SIZE_PX, CONSTRAINT_BADGE_SIZE_PX],
        },
      ]
    })

    group.visible = true
  }
}

function syncSprites(group: Group, count: number): Sprite[] {
  const sprites = group.children.filter(
    (child): child is Sprite => child instanceof Sprite
  )

  while (sprites.length < count) {
    const sprite = createConstraintBadgeSprite()
    sprite.renderOrder = RENDER_ORDER.INVISIBLE_CONSTRAINT
    group.add(sprite)
    sprites.push(sprite)
  }

  while (sprites.length > count) {
    const sprite = sprites.pop()
    if (sprite) {
      group.remove(sprite)
    }
  }

  return sprites
}

function getInvisibleConstraintWorldPositions(
  group: Group,
  obj: InvisibleConstraintObject,
  objects: ApiObject[],
  sceneInfra: SceneInfra,
  displayState: InvisibleConstraintDisplayState,
  isSelected: boolean,
  isHovered: boolean
): InvisibleConstraintWorldPosition[] {
  // Start from the anchor geometry-derived anchor, then offset it by 15px
  const naturalAnchor = getInvisibleConstraintAnchor(obj, objects)
  const naturalPosition = naturalAnchor
    ? offsetWorldPosition(group, naturalAnchor, sceneInfra, {
        x: -15,
        y: -15,
      })
    : null

  // Global toggle: show hidden constraints at their anchored position.
  if (displayState.showNonVisualConstraints) {
    const clusterConstraintIds = findInvisibleConstraintClusterIds(obj, objects)
    const clusterIndex = clusterConstraintIds.indexOf(obj.id)

    return naturalAnchor !== null && clusterIndex !== -1
      ? [
          {
            position: getConstraintRowWorldPosition(
              group,
              naturalAnchor,
              clusterIndex,
              clusterConstraintIds.length,
              sceneInfra,
              {
                rowStartXOffsetPx: -15 - CONSTRAINT_BADGE_SIZE_PX / 2,
                centerYOffsetPx: -15,
              }
            ),
            renderOrder: RENDER_ORDER.INVISIBLE_CONSTRAINT + clusterIndex,
          },
        ]
      : []
  }

  const selectedPopup = getSelectedInvisibleConstraintPopup(group)
  const previewPositions = displayState.constraintHoverPopups.flatMap(
    (popup, popupIndex) => {
      if (selectedPopup && popup.segmentId === selectedPopup.segmentId) {
        // Keep the pinned selected popup stable instead of replacing it with a new hover position.
        return []
      }

      return getConstraintHoverPopupPositions(
        group,
        popup,
        popupIndex,
        obj.id,
        objects,
        sceneInfra
      )
    }
  )
  const selectedPopupPositions = selectedPopup
    ? getConstraintHoverPopupPositions(
        group,
        selectedPopup,
        displayState.constraintHoverPopups.length,
        obj.id,
        objects,
        sceneInfra
      ).map((position) => ({
        ...position,
        renderOrder:
          RENDER_ORDER.INVISIBLE_CONSTRAINT +
          displayState.constraintHoverPopups.length +
          1,
      }))
    : []

  if (previewPositions.length > 0 || selectedPopupPositions.length > 0) {
    return [...previewPositions, ...selectedPopupPositions]
  }

  // Outside preview mode, keep directly selected or hovered constraints visible.
  if (isSelected || isHovered) {
    return naturalPosition
      ? [
          {
            position: naturalPosition,
            renderOrder: RENDER_ORDER.INVISIBLE_CONSTRAINT,
          },
        ]
      : []
  }

  return []
}

function getConstraintHoverPopupPositions(
  group: Group,
  popup: ConstraintHoverPopup,
  popupIndex: number,
  objId: number,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): InvisibleConstraintWorldPosition[] {
  // Hover previews ignore the anchor and lay related badges out near the cursor.
  const hoverPreviewConstraintIds = findInvisibleConstraintsForSegment(
    objects[popup.segmentId],
    objects
  )
  const hoverPreviewIndex = hoverPreviewConstraintIds.indexOf(objId)
  return hoverPreviewIndex === -1
    ? []
    : [
        {
          position: getConstraintRowWorldPosition(
            group,
            new Vector3(popup.position[0], popup.position[1], 0),
            hoverPreviewIndex,
            hoverPreviewConstraintIds.length,
            sceneInfra,
            {
              rowStartXOffsetPx: 12,
              centerYOffsetPx: -12,
            }
          ),
          renderOrder: RENDER_ORDER.INVISIBLE_CONSTRAINT + popupIndex + 1,
          popup,
        },
      ]
}

function getSelectedInvisibleConstraintPopup(
  group: Group
): SelectedInvisibleConstraintPopup | null {
  const popup = group.userData[SELECTED_INVISIBLE_CONSTRAINT_POPUP_KEY]
  return isSelectedInvisibleConstraintPopup(popup) ? popup : null
}

function clearSelectedInvisibleConstraintPopup(group: Group) {
  delete group.userData[SELECTED_INVISIBLE_CONSTRAINT_POPUP_KEY]
}

export function isConstraintHoverPopup(
  popup: unknown
): popup is ConstraintHoverPopup {
  return (
    typeof popup === 'object' &&
    popup !== null &&
    'segmentId' in popup &&
    typeof popup.segmentId === 'number' &&
    'position' in popup &&
    isArray(popup.position) &&
    popup.position.length === 2 &&
    popup.position.every((value) => typeof value === 'number')
  )
}

function isSelectedInvisibleConstraintPopup(
  popup: unknown
): popup is SelectedInvisibleConstraintPopup {
  return (
    isConstraintHoverPopup(popup) &&
    'ownerConstraintId' in popup &&
    typeof popup.ownerConstraintId === 'number'
  )
}

function offsetWorldPosition(
  group: Group,
  localPosition: Vector3,
  sceneInfra: SceneInfra,
  offsetPx: { x: number; y: number }
) {
  const [screenX, screenY, projectedZ] = projectWorldPositionToScreen(
    group,
    localPosition,
    sceneInfra
  )

  return unprojectScreenPosition(
    group,
    screenX + offsetPx.x,
    screenY + offsetPx.y,
    projectedZ,
    sceneInfra
  )
}

function getConstraintRowWorldPosition(
  group: Group,
  localAnchorPosition: Vector3,
  itemIndex: number,
  itemCount: number,
  sceneInfra: SceneInfra,
  {
    rowStartXOffsetPx,
    centerYOffsetPx,
  }: {
    rowStartXOffsetPx: number
    centerYOffsetPx: number
  }
) {
  const [baseScreenX, baseScreenY, projectedZ] = projectWorldPositionToScreen(
    group,
    localAnchorPosition,
    sceneInfra
  )
  const { clientWidth, clientHeight } = sceneInfra.renderer.domElement
  const badgeSize = CONSTRAINT_BADGE_SIZE_PX
  const badgeGap = 4
  const viewportPadding = 4
  const totalRowWidth =
    itemCount * badgeSize + Math.max(itemCount - 1, 0) * badgeGap
  const minStartX = viewportPadding
  const maxStartX = Math.max(
    minStartX,
    clientWidth - viewportPadding - totalRowWidth
  )
  const rowStartX = clamp(baseScreenX + rowStartXOffsetPx, minStartX, maxStartX)
  const centerX = rowStartX + itemIndex * (badgeSize + badgeGap) + badgeSize / 2
  const centerY = clamp(
    baseScreenY + centerYOffsetPx,
    viewportPadding + badgeSize / 2,
    clientHeight - viewportPadding - badgeSize / 2
  )

  return unprojectScreenPosition(
    group,
    centerX,
    centerY,
    projectedZ,
    sceneInfra
  )
}

function projectWorldPositionToScreen(
  group: Group,
  localPosition: Vector3,
  sceneInfra: SceneInfra
) {
  const worldPosition = localPosition.clone()
  group.localToWorld(worldPosition)
  const projected = worldPosition.project(sceneInfra.camControls.camera)
  const { clientWidth, clientHeight } = sceneInfra.renderer.domElement

  return [
    (projected.x * 0.5 + 0.5) * clientWidth,
    (-projected.y * 0.5 + 0.5) * clientHeight,
    projected.z,
  ] as const
}

function unprojectScreenPosition(
  group: Group,
  screenX: number,
  screenY: number,
  projectedZ: number,
  sceneInfra: SceneInfra
) {
  const { clientWidth, clientHeight } = sceneInfra.renderer.domElement

  const worldPosition = new Vector3(
    (screenX / clientWidth) * 2 - 1,
    -((screenY / clientHeight) * 2 - 1),
    projectedZ
  ).unproject(sceneInfra.camControls.camera)

  return group.worldToLocal(worldPosition)
}

function getConstraintBadgeState(
  objId: number,
  selectedIds: number[],
  hoveredId: number | null
): ConstraintBadgeState {
  if (selectedIds.includes(objId)) {
    return 'selected'
  }

  if (hoveredId === objId) {
    return 'hovered'
  }

  return 'default'
}
