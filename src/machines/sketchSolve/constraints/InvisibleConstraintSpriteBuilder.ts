import {
  Group,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { constraintIconPaths } from '@src/components/constraintIconPaths'
import { SKETCH_SELECTION_RGB } from '@src/lib/constants'
import { getResolvedTheme, Themes } from '@src/lib/theme'
import { clamp } from '@src/lib/utils'
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
  constraintHoverPopup: ConstraintHoverPopup | null
}

const INVISIBLE_CONSTRAINT_BADGE_SIZE_PX = 20

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
    sprite.renderOrder = 100
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

    const sprite = group.children.find((child) => child instanceof Sprite) as
      | Sprite
      | undefined

    if (!sprite) {
      group.visible = false
      return
    }

    const isSelected = selectedIds.includes(obj.id)
    const isHovered = hoveredId === obj.id
    const position = getInvisibleConstraintWorldPosition(
      obj,
      objects,
      sceneInfra,
      displayState,
      isSelected,
      isHovered
    )

    if (!position) {
      group.visible = false
      return
    }

    group.position.copy(position)

    const scale = sceneInfra.getClientSceneScaleFactor(group)
    sprite.scale.setScalar(INVISIBLE_CONSTRAINT_BADGE_SIZE_PX * scale)
    const theme = getResolvedTheme(sceneInfra.theme)

    const texture = this.getTexture(
      obj.kind.constraint.type,
      getConstraintBadgeState(obj.id, selectedIds, hoveredId),
      theme
    )

    sprite.material.map = texture
    sprite.material.needsUpdate = true
    sprite.userData.hitObjects = [
      {
        type: 'screenRect',
        center: [group.position.x, group.position.y, group.position.z],
        sizePx: [
          INVISIBLE_CONSTRAINT_BADGE_SIZE_PX,
          INVISIBLE_CONSTRAINT_BADGE_SIZE_PX,
        ],
      },
    ]

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

function getInvisibleConstraintWorldPosition(
  obj: InvisibleConstraintObject,
  objects: ApiObject[],
  sceneInfra: SceneInfra,
  displayState: InvisibleConstraintDisplayState,
  isSelected: boolean,
  isHovered: boolean
) {
  const naturalAnchor = getInvisibleConstraintAnchor(obj, objects)
  const naturalPosition = naturalAnchor
    ? offsetWorldPosition(naturalAnchor, sceneInfra, { x: -15, y: -15 })
    : null

  if (displayState.showNonVisualConstraints) {
    return naturalPosition
  }

  const { constraintHoverPopup } = displayState
  if (constraintHoverPopup !== null) {
    const hoverPreviewConstraintIds = findInvisibleConstraintsForSegment(
      objects[constraintHoverPopup.segmentId],
      objects
    )
    const hoverPreviewIndex = hoverPreviewConstraintIds.indexOf(obj.id)
    if (hoverPreviewIndex !== -1) {
      return getHoverPreviewWorldPosition(
        constraintHoverPopup.position,
        hoverPreviewIndex,
        hoverPreviewConstraintIds.length,
        sceneInfra
      )
    }
  }

  if (isSelected || isHovered) {
    return naturalPosition
  }

  return null
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
  const borderOpacity =
    badgeState === 'selected' ? 1 : badgeState === 'hovered' ? 0.8 : 0
  const borderStroke =
    borderOpacity === 0
      ? 'none'
      : `rgba(${SKETCH_SELECTION_RGB.join(', ')}, ${borderOpacity})`
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
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="2"
        fill="none"
        stroke="${borderStroke}"
        stroke-width="1"
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
