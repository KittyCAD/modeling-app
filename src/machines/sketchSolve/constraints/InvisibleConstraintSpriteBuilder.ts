import type { Texture } from 'three'
import {
  Group,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector3,
} from 'three'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { constraintIconPaths } from '@src/components/constraintIconPaths'
import { SKETCH_SELECTION_RGB } from '@src/lib/constants'
import { getResolvedTheme, Themes } from '@src/lib/theme'
import { clamp, isArray } from '@src/lib/utils'
import { CONSTRAINT_TYPE } from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
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

const INVISIBLE_CONSTRAINT_BADGE_SIZE_PX = 20
const INVISIBLE_CONSTRAINT_RENDER_ORDER = 100
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
  private readonly textureCache = new Map<string, Texture>()
  private readonly textureLoader = new TextureLoader()

  public init(obj: InvisibleConstraintObject) {
    const group = new Group()
    group.name = obj.id.toString()
    group.userData = {
      type: CONSTRAINT_TYPE,
      constraintType: obj.kind.constraint.type,
      object_id: obj.id,
    }
    group.visible = false

    const sprite = new Sprite(
      new SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        color: 0xffffff,
      })
    )
    sprite.renderOrder = INVISIBLE_CONSTRAINT_RENDER_ORDER
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
    const texture = this.getTexture(
      obj.kind.constraint.type,
      getConstraintBadgeState(obj.id, selectedIds, hoveredId),
      theme
    )
    const sprites = syncSprites(group, positions.length)
    const scale = sceneInfra.getClientSceneScaleFactor(group)
    group.position.set(0, 0, 0)

    sprites.forEach((sprite, index) => {
      const { position, renderOrder, popup } = positions[index]
      sprite.position.copy(position)
      sprite.scale.setScalar(INVISIBLE_CONSTRAINT_BADGE_SIZE_PX * scale)
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
          sizePx: [
            INVISIBLE_CONSTRAINT_BADGE_SIZE_PX,
            INVISIBLE_CONSTRAINT_BADGE_SIZE_PX,
          ],
        },
      ]
    })

    group.visible = true
  }

  private getTexture(
    objType: InvisibleConstraintObject['kind']['constraint']['type'],
    badgeState: ConstraintBadgeState,
    theme: Themes
  ) {
    const key = `${objType}:${badgeState}:${theme}`
    const cached = this.textureCache.get(key)
    if (cached) {
      return cached
    }

    const texture = this.textureLoader.load(
      createConstraintBadgeSvgDataUrl(objType, badgeState, theme)
    )
    texture.colorSpace = SRGBColorSpace
    this.textureCache.set(key, texture)
    return texture
  }
}

function syncSprites(group: Group, count: number): Sprite[] {
  const sprites = group.children.filter(
    (child): child is Sprite => child instanceof Sprite
  )

  while (sprites.length < count) {
    const sprite = new Sprite(
      new SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        color: 0xffffff,
      })
    )
    sprite.renderOrder = INVISIBLE_CONSTRAINT_RENDER_ORDER
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
    ? offsetWorldPosition(naturalAnchor, sceneInfra, { x: -15, y: -15 })
    : null

  // Global toggle: show hidden constraints at their anchored position.
  if (displayState.showNonVisualConstraints) {
    return naturalPosition
      ? [
          {
            position: naturalPosition,
            renderOrder: INVISIBLE_CONSTRAINT_RENDER_ORDER,
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
        selectedPopup,
        displayState.constraintHoverPopups.length,
        obj.id,
        objects,
        sceneInfra
      ).map((position) => ({
        ...position,
        renderOrder:
          INVISIBLE_CONSTRAINT_RENDER_ORDER +
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
            renderOrder: INVISIBLE_CONSTRAINT_RENDER_ORDER,
          },
        ]
      : []
  }

  return []
}

function getConstraintHoverPopupPositions(
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
          position: getHoverPreviewWorldPosition(
            popup.position,
            hoverPreviewIndex,
            hoverPreviewConstraintIds.length,
            sceneInfra
          ),
          renderOrder: INVISIBLE_CONSTRAINT_RENDER_ORDER + popupIndex + 1,
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
  worldPosition: Vector3,
  sceneInfra: SceneInfra,
  offsetPx: { x: number; y: number }
) {
  const [screenX, screenY, projectedZ] = projectWorldPositionToScreen(
    worldPosition,
    sceneInfra
  )

  return unprojectScreenPosition(
    screenX + offsetPx.x,
    screenY + offsetPx.y,
    projectedZ,
    sceneInfra
  )
}

function getHoverPreviewWorldPosition(
  constraintHoverPopupPosition: ConstraintHoverPopup['position'],
  hoverPreviewIndex: number,
  hoverPreviewCount: number,
  sceneInfra: SceneInfra
) {
  const previewPosition = new Vector3(
    constraintHoverPopupPosition[0],
    constraintHoverPopupPosition[1],
    0
  )
  const [baseScreenX, baseScreenY, projectedZ] = projectWorldPositionToScreen(
    previewPosition,
    sceneInfra
  )
  const { clientWidth, clientHeight } = sceneInfra.renderer.domElement
  const badgeSize = INVISIBLE_CONSTRAINT_BADGE_SIZE_PX
  const badgeGap = 4
  const viewportPadding = 4
  const totalRowWidth =
    hoverPreviewCount * badgeSize +
    Math.max(hoverPreviewCount - 1, 0) * badgeGap
  const minStartX = viewportPadding
  const maxStartX = Math.max(
    minStartX,
    clientWidth - viewportPadding - totalRowWidth
  )
  const rowStartX = clamp(baseScreenX + 12, minStartX, maxStartX)
  const centerX =
    rowStartX + hoverPreviewIndex * (badgeSize + badgeGap) + badgeSize / 2
  const centerY = clamp(
    baseScreenY - 12,
    viewportPadding + badgeSize / 2,
    clientHeight - viewportPadding - badgeSize / 2
  )

  return unprojectScreenPosition(centerX, centerY, projectedZ, sceneInfra)
}

function projectWorldPositionToScreen(
  worldPosition: Vector3,
  sceneInfra: SceneInfra
) {
  const projected = worldPosition.clone().project(sceneInfra.camControls.camera)
  const { clientWidth, clientHeight } = sceneInfra.renderer.domElement

  return [
    (projected.x * 0.5 + 0.5) * clientWidth,
    (-projected.y * 0.5 + 0.5) * clientHeight,
    projected.z,
  ] as const
}

function unprojectScreenPosition(
  screenX: number,
  screenY: number,
  projectedZ: number,
  sceneInfra: SceneInfra
) {
  const { clientWidth, clientHeight } = sceneInfra.renderer.domElement

  return new Vector3(
    (screenX / clientWidth) * 2 - 1,
    -((screenY / clientHeight) * 2 - 1),
    projectedZ
  ).unproject(sceneInfra.camControls.camera)
}

function createConstraintBadgeSvgDataUrl(
  objType: InvisibleConstraintObject['kind']['constraint']['type'],
  badgeState: ConstraintBadgeState,
  theme: Themes
) {
  const iconPath = getInvisibleConstraintSpriteIcon(objType)
  const dpr = window.devicePixelRatio || 1
  const rasterSize = INVISIBLE_CONSTRAINT_BADGE_SIZE_PX * dpr
  const hasBorder = badgeState !== 'default'
  const borderStroke = hasBorder
    ? `rgba(${SKETCH_SELECTION_RGB.join(', ')}, ${
        badgeState === 'hovered' ? 0.8 : 1
      })`
    : 'none'
  const borderWidth = hasBorder ? 1 : 0
  const rectInset = hasBorder ? 0.5 : 0
  const badgeFill = theme === Themes.Dark ? '#FAFAFA' : '#1E1E1E'
  const iconFill = theme === Themes.Dark ? '#000000' : '#FFFFFF'
  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="${rasterSize}"
      height="${rasterSize}"
      viewBox="0 0 ${INVISIBLE_CONSTRAINT_BADGE_SIZE_PX} ${INVISIBLE_CONSTRAINT_BADGE_SIZE_PX}"
      fill="none"
    >
      <rect
        x="${rectInset}"
        y="${rectInset}"
        width="${INVISIBLE_CONSTRAINT_BADGE_SIZE_PX - rectInset * 2}"
        height="${INVISIBLE_CONSTRAINT_BADGE_SIZE_PX - rectInset * 2}"
        rx="2"
        fill="${badgeFill}"
        stroke="${borderStroke}"
        stroke-width="${borderWidth}"
      />
      <path d="${iconPath}" fill="${iconFill}" />
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

type ConstraintBadgeState = 'default' | 'hovered' | 'selected'

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

function getInvisibleConstraintSpriteIcon(
  objType: InvisibleConstraintObject['kind']['constraint']['type']
) {
  switch (objType) {
    case 'Coincident':
      return constraintIconPaths.coincident
    case 'Horizontal':
      return constraintIconPaths.horizontal
    case 'Vertical':
      return constraintIconPaths.vertical
    case 'LinesEqualLength':
      return constraintIconPaths.equal
    case 'Parallel':
      return constraintIconPaths.parallel
    case 'Perpendicular':
      return constraintIconPaths.perpendicular
    case 'Tangent':
      return constraintIconPaths.tangent
  }
}
